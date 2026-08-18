import { LightningFeed } from './lightning.js';
import { Overlay } from './overlay.js';
import { WindParticles, fetchHomeWind, fetchWindField } from './wind.js';
import { Radar } from './radar.js';
import { armAudio, thunder } from './audio.js';
import { distKm, bearingDeg, compass, destPoint } from './geo.js';
import { findLiveStorms } from './storm.js';
import * as ui from './ui.js';

const CARTO_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const RASTER_FALLBACK = {
  version: 8,
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
  },
  layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
};

const store = {
  home: ui.loadHome(),
  strikes: [], // { lat, lon, t, tArr, dist, bearing }
  wind: null,
};
const settings = ui.loadSettings();

async function pickStyle() {
  try {
    const res = await fetch(CARTO_STYLE, { method: 'HEAD' });
    if (res.ok) return CARTO_STYLE;
  } catch (e) {}
  return RASTER_FALLBACK;
}

function homeView(home) {
  const n = destPoint(home.lat, home.lon, 0, 55);
  const s = destPoint(home.lat, home.lon, 180, 55);
  const e = destPoint(home.lat, home.lon, 90, 55);
  const w = destPoint(home.lat, home.lon, 270, 55);
  return [[w.lon, s.lat], [e.lon, n.lat]];
}

async function boot() {
  const style = await pickStyle();
  const center = store.home ? [store.home.lon, store.home.lat] : [-95, 40];
  const map = new maplibregl.Map({
    container: 'map',
    style,
    center,
    zoom: store.home ? 8.4 : 3.6,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));
  window._map = map; // debug handle
  map.on('error', (e) => console.error('map error:', e.error && e.error.message));
  if (store.home) map.fitBounds(homeView(store.home), { animate: false, padding: 20 });

  const overlay = new Overlay(document.getElementById('strike-canvas'), map, store);
  const particles = new WindParticles(document.getElementById('wind-canvas'), map);
  particles.setEnabled(settings.wind);
  const radar = new Radar(map);
  map.on('load', () => {
    if (settings.radar) radar.setEnabled(true).catch(() => {});
  });

  // ---- audio needs one user gesture ----
  const arm = () => { armAudio(); document.removeEventListener('pointerdown', arm); };
  document.addEventListener('pointerdown', arm);

  // ---- lightning feed ----
  let lastBoom = 0;
  const feed = new LightningFeed({
    onStatus: ui.setConnStatus,
    onStrike: (s) => {
      if (store.home) {
        s.dist = distKm(store.home.lat, store.home.lon, s.lat, s.lon);
        s.bearing = bearingDeg(store.home.lat, store.home.lon, s.lat, s.lon);
      } else {
        s.dist = null; s.bearing = 0;
      }
      store.strikes.push(s);
      if (store.strikes.length > 50000) store.strikes.splice(0, 10000);

      if (s.dist != null && s.dist <= settings.alertKm) {
        ui.showBanner(`⚡ ${s.dist.toFixed(1)} km ${compass(s.bearing)} of home`);
        if (settings.sound && Date.now() - lastBoom > 8000) {
          lastBoom = Date.now();
          thunder(s.dist);
        }
      } else if (settings.sound && Date.now() - lastBoom > 8000) {
        // spectator thunder: when viewing a storm away from home (or with no
        // home set), strikes near the map center are audible too
        const c = map.getCenter();
        const away = !store.home ||
          distKm(c.lat, c.lng, store.home.lat, store.home.lon) > 30;
        if (away) {
          const dc = distKm(c.lat, c.lng, s.lat, s.lon);
          if (dc <= 50) { // audible range: close = crack, far = faint rumble
            lastBoom = Date.now();
            thunder(dc);
          }
        }
      }
    },
  });
  feed.start();

  // ---- periodic pruning ----
  setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    let firstKeep = 0;
    while (firstKeep < store.strikes.length && store.strikes[firstKeep].t < cutoff) firstKeep++;
    if (firstKeep > 0) store.strikes.splice(0, firstKeep);
  }, 30 * 1000);

  // ---- readouts ----
  setInterval(() => {
    const now = Date.now();
    let closest = null;
    let rate = 0;
    for (const s of store.strikes) {
      if (s.dist == null) continue;
      if (!closest || s.dist < closest.dist) closest = s;
      if (now - s.tArr <= 60 * 1000 && s.dist <= 100) rate++;
    }
    ui.updateReadouts({ closest, rate, wind: store.wind });
  }, 1000);

  // ---- wind data ----
  async function refreshWind() {
    if (!store.home) return;
    try { store.wind = await fetchHomeWind(store.home); } catch (e) {}
    try { particles.setField(await fetchWindField(store.home)); } catch (e) {}
  }
  refreshWind();
  setInterval(() => {
    if (store.home) fetchHomeWind(store.home).then((w) => { store.wind = w; }).catch(() => {});
  }, 10 * 60 * 1000);
  setInterval(() => {
    if (store.home) fetchWindField(store.home).then((f) => particles.setField(f)).catch(() => {});
  }, 30 * 60 * 1000);

  // ---- home selection ----
  const onHome = (home) => {
    store.home = home;
    for (const s of store.strikes) {
      s.dist = distKm(home.lat, home.lon, s.lat, s.lon);
      s.bearing = bearingDeg(home.lat, home.lon, s.lat, s.lon);
    }
    map.fitBounds(homeView(home), { padding: 20 });
    refreshWind();
  };

  // ⌂: fly back home when away; open address settings when already home
  const onHomeClick = () => {
    if (!store.home) { ui.openSetup(onHome); return; }
    const c = map.getCenter();
    if (distKm(c.lat, c.lng, store.home.lat, store.home.lon) > 30) {
      map.flyTo({ center: [store.home.lon, store.home.lat], zoom: 8.4, speed: 1.6 });
      refreshWind();
    } else {
      ui.openSetup(onHome);
    }
  };

  // ⚡ STORM: cycle through the most active storms on Earth, skipping
  // whichever one is already on screen. Same zoom as the home view so the
  // thunder rings read at their proper scale.
  let stormIdx = 0;
  const onStorm = () => {
    const storms = findLiveStorms(store.strikes);
    if (!storms.length) { ui.flashButton('btn-storm', 'NO DATA YET'); return; }
    const c = map.getCenter();
    for (let k = 0; k < storms.length; k++) {
      const cand = storms[stormIdx % storms.length];
      stormIdx++;
      if (distKm(c.lat, c.lng, cand.lat, cand.lon) > 100) {
        map.flyTo({ center: [cand.lon, cand.lat], zoom: 8.4, speed: 1.7 });
        fetchWindField({ lat: cand.lat, lon: cand.lon })
          .then((f) => particles.setField(f)).catch(() => {});
        return;
      }
    }
    ui.flashButton('btn-storm', 'STORM IS HERE'); // the only active storm is on screen
  };

  ui.wireControls(settings, {
    onRadar: (on) => radar.setEnabled(on).catch(() => {}),
    onWind: (on) => particles.setEnabled(on),
    onSound: (on) => { if (on) { armAudio(); thunder(6); } }, // preview incl. the close boom
    onHomeClick,
    onStorm,
  });

  if (!store.home) ui.openSetup(onHome);
}

boot();
