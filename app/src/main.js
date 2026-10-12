import { LightningFeed } from './lightning.js';
import { Overlay } from './overlay.js';
import { WindParticles, fetchHomeWind, fetchWindField } from './wind.js';
import { Radar } from './radar.js';
import { armAudio, thunder } from './audio.js';
import { distKm, bearingDeg, compass, destPoint } from './geo.js';
import { findLiveStorms } from './storm.js';
import { isApp, setAlerts, queryAlertsState } from './native.js';
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
    const res = await fetch(CARTO_STYLE, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    if (res.ok) return CARTO_STYLE;
  } catch (e) {}
  return RASTER_FALLBACK;
}

// ?at=lat,lon[,zoom] — open the map on a spot (shareable storm links; the
// promo clip renderer). Home is untouched; ⌂ still flies back to it.
function parseAt(v) {
  if (!v) return null;
  const [lat, lon, zoom] = v.split(',').map(Number);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon, zoom: zoom >= 1 && zoom <= 16 ? zoom : 8.4 };
}

function homeView(home) {
  const n = destPoint(home.lat, home.lon, 0, 55);
  const s = destPoint(home.lat, home.lon, 180, 55);
  const e = destPoint(home.lat, home.lon, 90, 55);
  const w = destPoint(home.lat, home.lon, 270, 55);
  return [[w.lon, s.lat], [e.lon, n.lat]];
}

async function boot() {
  // ?storm: embed mode for the landing page — no setup modal, start on a wide
  // world view, then fly to the most active storm on Earth once one is found.
  const params = new URLSearchParams(location.search);
  const embedStorm = params.has('storm');
  const at = parseAt(params.get('at'));
  // ?broadcast: the headless clip renderer in promo/ (never linked). Chrome
  // hidden, silent, and strikes replayed on a fixed delay so a stepped clock
  // can film them in order.
  const broadcast = params.has('broadcast');
  if (embedStorm || broadcast) settings.sound = false; // never autoplay thunder in embeds
  if (broadcast) document.body.classList.add('broadcast');
  const style = await pickStyle();
  const center = at ? [at.lon, at.lat]
    : store.home ? [store.home.lon, store.home.lat]
    : embedStorm ? [-40, 22] : [-95, 40];
  const map = new maplibregl.Map({
    container: 'map',
    style,
    center,
    zoom: at ? at.zoom : store.home ? 8.4 : embedStorm ? 1.7 : 3.6,
    attributionControl: { compact: true },
  });
  if (window.innerWidth > 700) { // phones pinch-zoom; the widget collides with the icon row
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  }
  new ResizeObserver(() => map.resize()).observe(document.getElementById('map'));
  window._map = map; // debug handle
  map.on('error', (e) => console.error('map error:', e.error && e.error.message));
  if (store.home && !at) map.fitBounds(homeView(store.home), { animate: false, padding: 20 });

  const overlay = new Overlay(document.getElementById('strike-canvas'), map, store);
  const particles = new WindParticles(document.getElementById('wind-canvas'), map);
  particles.setEnabled(settings.wind);
  if (at) fetchWindField(at).then((f) => particles.setField(f)).catch(() => {});
  const radar = new Radar(map);
  map.on('load', () => {
    if (settings.radar) radar.setEnabled(true).catch(() => {});
  });

  // ---- audio needs a user gesture, and iOS suspends the context whenever
  // the app backgrounds or another app takes audio — re-arm on every tap and
  // on return to foreground so thunder recovers without a restart ----
  document.addEventListener('pointerdown', armAudio);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) armAudio();
  });
  window.addEventListener('pageshow', () => armAudio());

  // ---- lightning feed ----
  let lastBoom = 0;
  const maxStrikes = broadcast ? 400000 : 25000; // the renderer holds the whole globe
  const ingest = (s) => {
    if (store.home) {
      s.dist = distKm(store.home.lat, store.home.lon, s.lat, s.lon);
      s.bearing = bearingDeg(store.home.lat, store.home.lon, s.lat, s.lon);
    } else {
      s.dist = null; s.bearing = 0;
    }
    store.strikes.push(s);
    if (store.strikes.length > maxStrikes) store.strikes.splice(0, maxStrikes / 5);

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
  };

  // broadcast: hold each strike until a fixed delay after it flashed. Playback
  // then stays in strike order even while the renderer's clock is paused and
  // live strikes keep arriving in real time.
  const delayMs = Math.max(0, Number(params.get('delay')) || 12000); // ~feed latency
  const queue = [];
  const enqueue = (s) => {
    s.tArr = Math.max(s.tArr, s.t + delayMs);
    let i = queue.length;
    while (i > 0 && queue[i - 1].tArr > s.tArr) i--;
    queue.splice(i, 0, s);
  };
  if (broadcast) {
    setInterval(() => {
      const now = Date.now();
      let n = 0;
      while (n < queue.length && queue[n].tArr <= now) n++;
      if (n) for (const s of queue.splice(0, n)) ingest(s);
    }, 16);
  }

  const feed = new LightningFeed({
    onStatus: ui.setConnStatus,
    onStrike: broadcast ? enqueue : ingest,
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
      if (now - s.tArr <= 60 * 1000 &&
          (store.home ? (s.dist != null && s.dist <= 100) : true)) {
        rate++; // no home set (embed view): show the global strike rate instead
      }
      if (s.dist == null) continue;
      if (!closest || s.dist < closest.dist) closest = s;
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
    if (!storms.length) { ui.showToast('No storm data yet — give it a minute'); return; }
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
    ui.showToast('The storm is already on your screen'); // no other active storm on Earth
  };

  // embed mode: auto-fly to the biggest storm as soon as enough strikes have
  // streamed in to locate one — unless the visitor has started exploring
  if (embedStorm && !store.home) {
    let exploring = false;
    map.on('dragstart', () => { exploring = true; });
    map.on('wheel', () => { exploring = true; });
    const tryFly = setInterval(() => {
      if (exploring) { clearInterval(tryFly); return; }
      const storms = findLiveStorms(store.strikes);
      if (!storms.length) return;
      clearInterval(tryFly);
      const s = storms[0];
      map.flyTo({ center: [s.lon, s.lat], zoom: 8.4, speed: 0.9 });
      fetchWindField({ lat: s.lat, lon: s.lon })
        .then((f) => particles.setField(f)).catch(() => {});
    }, 2500);
  }

  // ---- push storm alerts + WeatherKit nowcast (iOS app only) ----
  let alertsOn = false;
  window._alertsStatus = (state) => {
    alertsOn = state === 'on' || state === 'still-on';
    ui.updateAlertsButton(state);
  };
  window._nowcast = (data) => ui.updateNowcast(data);

  ui.wireControls(settings, {
    onRadar: (on) => radar.setEnabled(on).catch(() => {}),
    onWind: (on) => particles.setEnabled(on),
    onSound: (on) => { if (on) { armAudio(); thunder(6); } }, // preview incl. the close boom
    onHomeClick,
    onHome,
    onStorm,
    onAlertsToggle: isApp ? () => setAlerts(!alertsOn) : null,
  });

  if (isApp) {
    queryAlertsState(); // reveals the alerts toggle in settings
    // WeatherKit powers the app's rain nowcast — Apple Weather attribution
    // must be clearly visible on the main screen
    document.getElementById('wk-map-attrib').classList.remove('hidden');
  }

  if (broadcast) {
    // handle for promo/capture.mjs: it picks the storm, frames it and films it
    window._downstrike = {
      map, store, particles, findLiveStorms, fetchWindField,
      pending: () => queue.length,
      stopFeed: () => feed.stop(),
    };
  }

  if (!store.home && !embedStorm && !at && !broadcast) ui.openSetup(onHome);
}

boot();
