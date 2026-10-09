// Which storm is worth filming, and what to call it. Pure functions, no I/O.
import { CITIES } from './cities.mjs';
import { distKm, bearingDeg, compass } from '../app/src/geo.js';

export function nearestCity(lat, lon) {
  let best = null;
  for (const c of CITIES) {
    const d = distKm(lat, lon, c.lat, c.lon);
    if (!best || d < best.d) best = { city: c, d };
  }
  best.dir = compass(bearingDeg(best.city.lat, best.city.lon, lat, lon));
  return best;
}

// How much a storm's place matters: a big city right under it counts most,
// one 150 km away barely counts, open country or ocean counts a little.
export function placeWeight(lat, lon, cfg = {}) {
  const { city, d } = nearestCity(lat, lon);
  const boost = (cfg.regionBoost && cfg.regionBoost[city.cc]) || 1;
  if (d > 150) return { weight: 0.35, city: null, d };
  const size = 1 + 0.6 * Math.log10(Math.max(city.pop, 0.1) / 0.1); // 0.1M→1, 1M→1.6, 10M→2.2
  const reach = d <= 60 ? 1 : 1 - (d - 60) / 180;                    // fades out to 0.5 at 150 km
  return { weight: Math.max(0.35, size * reach * boost), city, d };
}

export function scoreStorm(storm, cfg) {
  const { weight } = placeWeight(storm.lat, storm.lon, cfg);
  return Math.round(storm.count * weight);
}

// history: [{ at: ISO, lat, lon }] of clips already made.
// Returns { storm, score, fallback } or null (with the reason logged by the caller).
export function pickStorm(storms, { history = [], cfg, now = Date.now(), force = false }) {
  const recent = history.filter((h) => now - Date.parse(h.at) < 24 * 3600e3);
  if (!force && recent.length >= cfg.maxClipsPerDay) return { skip: `already ${recent.length} clips in 24 h` };

  const fresh = (s) => !history.some((h) =>
    now - Date.parse(h.at) < cfg.cooldownHours * 3600e3 &&
    distKm(h.lat, h.lon, s.lat, s.lon) < cfg.cooldownKm);

  const ranked = storms
    .map((s) => ({ storm: s, score: scoreStorm(s, cfg), fresh: fresh(s) }))
    .sort((a, b) => b.score - a.score);
  const eligible = ranked.filter((r) => r.fresh || force);
  if (!eligible.length) return { skip: 'no fresh storms', ranked };

  const top = eligible[0];
  if (force || top.score >= cfg.minScore) return { ...top, ranked };
  // "somewhere it is always storming": one clip a day even on quiet days
  if (cfg.dailyFallback && !recent.length && top.storm.count >= cfg.fallbackMinStrikes) {
    return { ...top, fallback: true, ranked };
  }
  return { skip: `best score ${top.score} < ${cfg.minScore}`, ranked };
}

// Names from outside (an OpenStreetMap reverse geocode, which anyone can edit)
// end up in the frame, the issue and the caption: keep letters and plain punctuation only.
export const safeName = (s) => String(s).replace(/[^\p{L}\p{M}\p{N} ,.'’()°-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);

// Words for the frame and the caption. `region` comes from a reverse geocode
// when no metro is close (e.g. "Mato Grosso, Brazil"), else null.
export function describePlace(lat, lon, region = null) {
  if (region) region = safeName(region) || null;
  const { city, d, dir } = nearestCity(lat, lon);
  const cityLabel = `${city.name}, ${city.region}`;
  if (d <= 40) {
    return { title: `Lightning over ${city.name}`, sub: cityLabel, city, d, tagCity: city.name };
  }
  if (d <= 150) {
    const km = Math.round(d / 5) * 5;
    return { title: `Lightning near ${city.name}`, sub: `${km} km ${dir} of ${cityLabel}`, city, d, tagCity: city.name };
  }
  const coords = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`;
  if (region) return { title: `Lightning over ${region.split(',')[0]}`, sub: region, city: null, d, coords };
  return { title: 'Lightning far from any city', sub: coords, city: null, d, coords };
}
