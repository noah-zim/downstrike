// Find the most active storms on Earth from the live strike buffer.
// Strikes from the last 10 minutes are gridded into 1°×1° cells; each cell is
// scored by its 3×3 neighborhood (storms straddle cell borders), then the top
// distinct peaks are returned, strongest first.
export function findLiveStorms(strikes, now = Date.now()) {
  const cutoff = now - 10 * 60 * 1000;
  const cells = new Map();
  for (const s of strikes) {
    if (s.t < cutoff) continue;
    const i = Math.floor(s.lat), j = Math.floor(s.lon);
    const key = i + ':' + j;
    let c = cells.get(key);
    if (!c) { c = { i, j, count: 0, sumLat: 0, sumLon: 0 }; cells.set(key, c); }
    c.count++;
    c.sumLat += s.lat;
    c.sumLon += s.lon;
  }

  const scored = [];
  for (const c of cells.values()) {
    let score = 0, sumLat = 0, sumLon = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const n = cells.get((c.i + di) + ':' + (c.j + dj));
        if (n) { score += n.count; sumLat += n.sumLat; sumLon += n.sumLon; }
      }
    }
    scored.push({ lat: sumLat / score, lon: sumLon / score, count: score });
  }
  scored.sort((a, b) => b.count - a.count);

  // keep the strongest peaks, at least ~2.5° apart so each is a distinct storm
  const storms = [];
  for (const s of scored) {
    if (s.count < 10) continue;
    if (storms.some((p) => Math.abs(p.lat - s.lat) < 2.5 && Math.abs(p.lon - s.lon) < 2.5)) continue;
    storms.push(s);
    if (storms.length >= 8) break;
  }
  return storms;
}
