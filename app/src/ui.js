// HUD readouts, controls, setup modal, alert banner.
import { compass } from './geo.js';
import { getPosition } from './native.js';

const $ = (id) => document.getElementById(id);

// storage keys ("fulmen" fallbacks migrate saves from before the app was renamed)
function stored(key) {
  return localStorage.getItem('downstrike.' + key) || localStorage.getItem('fulmen.' + key);
}

export function loadSettings() {
  try {
    return Object.assign(
      { alertKm: 20, sound: true, wind: true, radar: false },
      JSON.parse(stored('settings') || '{}')
    );
  } catch (e) {
    return { alertKm: 20, sound: true, wind: true, radar: false };
  }
}

export function saveSettings(s) {
  localStorage.setItem('downstrike.settings', JSON.stringify(s));
}

export function loadHome() {
  try {
    const h = JSON.parse(stored('home') || 'null');
    if (h && typeof h.lat === 'number' && typeof h.lon === 'number') return h;
  } catch (e) {}
  return null;
}

export function saveHome(h) {
  localStorage.setItem('downstrike.home', JSON.stringify(h));
}

export function setConnStatus({ connected, text }) {
  $('conn-dot').className = 'dot ' + (connected ? 'ok' : 'bad');
  $('conn-text').textContent = text;
}

export function updateReadouts({ closest, rate, wind }) {
  if (closest) {
    $('closest').innerHTML =
      `${closest.dist.toFixed(1)} <span class="unit">km ${compass(closest.bearing)}</span>`;
    $('s-closest').textContent = `${closest.dist.toFixed(1)} km ${compass(closest.bearing)}`;
  } else {
    $('closest').textContent = '—';
    $('s-closest').textContent = '—';
  }
  $('rate').textContent = String(rate);
  $('s-rate').textContent = `${rate}/min`;
  if (wind) {
    $('wind').innerHTML =
      `${Math.round(wind.speed)} <span class="unit">km/h ${wind.dirText}</span><br>` +
      `<span class="unit">gusts ${Math.round(wind.gusts)} km/h</span>`;
    $('s-wind').textContent = `${Math.round(wind.speed)} km/h`;
  }
}

let toastTimer = null;
export function showToast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function updateAlertsButton(state) {
  $('row-alerts').classList.remove('hidden');
  $('sw-alerts').classList.toggle('on', state === 'on');
  if (state === 'denied') {
    showToast('Notifications are off — enable them in iOS Settings.');
  } else if (state === 'error') {
    showToast("Couldn't set up alerts — try again.");
  }
}

function setStripRain(text) {
  const show = !!text;
  $('s-rain-sep').classList.toggle('hidden', !show);
  $('s-rain-ico').classList.toggle('hidden', !show);
  $('s-rain').classList.toggle('hidden', !show);
  if (show) $('s-rain').textContent = text;
}

// Minute-by-minute rain for the next hour (from the iOS shell's WeatherKit).
export function updateNowcast(data) {
  const minutes = (data && data.minutes) || [];
  if (!minutes.length) return;
  $('nowcast').classList.remove('hidden');
  const canvas = $('nowcast-chart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const n = Math.min(60, minutes.length);
  const w = canvas.width / 60;
  let firstRain = -1;
  for (let i = 0; i < n; i++) {
    const m = minutes[i];
    const chance = m.p || 0;
    const intensity = m.i || 0;
    if (firstRain < 0 && chance >= 0.3 && intensity > 0.05) firstRain = i;
    const h = Math.max(chance >= 0.3 ? 3 : 1, Math.min(1, intensity / 6) * canvas.height);
    ctx.fillStyle = chance >= 0.3
      ? `rgba(110, 168, 254, ${0.35 + 0.65 * chance})`
      : 'rgba(138, 147, 165, 0.25)';
    ctx.fillRect(i * w, canvas.height - h, w - 1, h);
  }
  const text = $('nowcast-text');
  if (firstRain === 0) {
    text.textContent = 'Raining now';
    setStripRain('now');
  } else if (firstRain > 0) {
    text.textContent = `Rain in ~${firstRain} min`;
    setStripRain(`${firstRain} min`);
  } else {
    text.textContent = 'No rain next hour';
    setStripRain(null);
  }
}

let bannerTimer = null;
export function showBanner(text) {
  $('banner-text').textContent = text;
  $('banner').classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $('banner').classList.add('hidden'), 60 * 1000);
}

export function wireControls(settings, handlers) {
  const sync = () => {
    $('btn-radar').classList.toggle('on', settings.radar);
    $('btn-wind').classList.toggle('on', settings.wind);
    $('sw-sound').classList.toggle('on', settings.sound);
    $('alert-km').value = settings.alertKm;
    $('alert-km-label').textContent = `${settings.alertKm} km`;
  };
  sync();
  $('btn-radar').onclick = () => {
    settings.radar = !settings.radar; saveSettings(settings); sync();
    handlers.onRadar(settings.radar);
  };
  $('btn-wind').onclick = () => {
    settings.wind = !settings.wind; saveSettings(settings); sync();
    handlers.onWind(settings.wind);
  };
  $('sw-sound').onclick = () => {
    settings.sound = !settings.sound; saveSettings(settings); sync();
    if (handlers.onSound) handlers.onSound(settings.sound);
  };
  $('alert-km').oninput = (e) => {
    settings.alertKm = Number(e.target.value); saveSettings(settings); sync();
  };
  $('btn-home').onclick = () => handlers.onHomeClick();
  $('btn-storm').onclick = () => handlers.onStorm();
  if (handlers.onAlertsToggle) {
    $('sw-alerts').onclick = () => handlers.onAlertsToggle();
  }

  // strip tap: expand/collapse the detail cards (remembered per browser)
  const setHud = (open) => {
    $('hud').classList.toggle('open', open);
    $('strip').classList.toggle('open', open);
    try { localStorage.setItem('downstrike.hudOpen', open ? '1' : '0'); } catch (e) {}
  };
  $('strip').onclick = () => setHud(!$('hud').classList.contains('open'));
  let hudOpen = false;
  try { hudOpen = localStorage.getItem('downstrike.hudOpen') === '1'; } catch (e) {}
  setHud(hudOpen);

  // settings sheet
  const openSheet = (open) => {
    $('sheet').classList.toggle('open', open);
    $('sheet-scrim').classList.toggle('open', open);
  };
  $('btn-settings').onclick = () => openSheet(true);
  $('sheet-scrim').onclick = () => openSheet(false);
  $('sheet-home').onclick = () => { openSheet(false); openSetup(handlers.onHome); };
}

export function openSetup(onPick) {
  const modal = $('setup');
  modal.classList.remove('hidden');
  const input = $('addr');
  const results = $('addr-results');
  const hint = $('setup-hint');
  input.value = '';
  results.innerHTML = '';
  hint.textContent = '';
  input.focus();

  const search = async () => {
    const q = input.value.trim();
    if (!q) return;
    hint.textContent = 'Searching…';
    results.innerHTML = '';
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=' +
        encodeURIComponent(q);
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const list = await res.json();
      hint.textContent = list.length ? 'Pick your place:' : 'No matches — try adding a city or region.';
      for (const r of list) {
        const li = document.createElement('li');
        li.textContent = r.display_name;
        li.onclick = () => {
          const home = {
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            label: r.display_name.split(',').slice(0, 2).join(','),
          };
          saveHome(home);
          modal.classList.add('hidden');
          onPick(home);
        };
        results.appendChild(li);
      }
    } catch (e) {
      hint.textContent = 'Search failed — check your connection and try again.';
    }
  };
  $('addr-form').onsubmit = (e) => { e.preventDefault(); search(); };

  const locBtn = $('use-location');
  locBtn.disabled = false;
  locBtn.onclick = async () => {
    locBtn.disabled = true;
    locBtn.textContent = '📍 Finding you…';
    try {
      const pos = await getPosition();
      let label = 'My location';
      try {
        const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2' +
          `&lat=${pos.lat.toFixed(5)}&lon=${pos.lon.toFixed(5)}`,
          { headers: { 'Accept-Language': 'en' } });
        const j = await res.json();
        if (j.display_name) label = j.display_name.split(',').slice(0, 2).join(',');
      } catch (e) {}
      const home = { lat: pos.lat, lon: pos.lon, label };
      saveHome(home);
      modal.classList.add('hidden');
      onPick(home);
    } catch (e) {
      hint.textContent = "Couldn't get your location — check permissions, or search instead.";
    } finally {
      locBtn.disabled = false;
      locBtn.textContent = '📍 Use my location';
    }
  };
}
