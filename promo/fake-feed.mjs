// A stand-in for the Blitzortung WebSocket, for offline runs and tests:
// `node capture.mjs --fake-feed`. It speaks the same protocol the app expects
// (plain JSON passes through the app's LZW decoder unchanged) and plays a few
// synthetic, drifting storms with 9 minutes of backlog so trails show at once.

const DEFAULT_STORMS = [
  // a strong line just west of Houston, drifting east-northeast
  { lat: 29.78, lon: -95.62, rate: 7, cells: 4, spreadKm: 22, sigmaKm: 5, vel: [6, 28] },
  // a mid-size storm over the Brazilian interior, no big city
  { lat: -13.2, lon: -55.4, rate: 9, cells: 5, spreadKm: 35, sigmaKm: 7, vel: [-4, 12] },
  // a small one near São Paulo
  { lat: -23.4, lon: -46.9, rate: 2.5, cells: 2, spreadKm: 12, sigmaKm: 4, vel: [2, 10] },
];

function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeStorm(def, t0) {
  const cells = Array.from({ length: def.cells }, () => ({
    dn: gauss() * def.spreadKm, de: gauss() * def.spreadKm, w: 0.5 + Math.random(),
  }));
  const wSum = cells.reduce((a, c) => a + c.w, 0);
  return {
    ...def,
    strikeAt(t) { // t: ms epoch
      const hrs = (t - t0) / 3600e3;
      let r = Math.random() * wSum, c = cells[0];
      for (const cell of cells) { r -= cell.w; if (r <= 0) { c = cell; break; } }
      const n = c.dn + def.vel[0] * hrs + gauss() * def.sigmaKm;
      const e = c.de + def.vel[1] * hrs + gauss() * def.sigmaKm;
      return {
        lat: def.lat + n / 111,
        lon: def.lon + e / (111 * Math.cos(def.lat * Math.PI / 180)),
        time: t * 1e6, // ns, like Blitzortung
      };
    },
  };
}

export async function attachFakeFeed(context, { storms = DEFAULT_STORMS, backlogMin = 9, log = () => {} } = {}) {
  const t0 = Date.now();
  const live = storms.map((d) => makeStorm(d, t0));
  const timers = [];
  await context.routeWebSocket(/blitzortung\.org/, (ws) => {
    ws.onMessage(() => { // the app sends {"a":111}; then strikes flow
      const now = Date.now();
      let sent = 0;
      for (const s of live) {
        const n = Math.round(s.rate * backlogMin * 60);
        for (let i = 0; i < n; i++) {
          const t = now - backlogMin * 60e3 + (i / n) * backlogMin * 60e3;
          ws.send(JSON.stringify(s.strikeAt(t)));
          sent++;
        }
      }
      log(`fake feed: sent ${sent} backlog strikes`);
      const iv = setInterval(() => {
        const t = Date.now();
        for (const s of live) {
          const k = s.rate * 0.1;
          const count = Math.floor(k) + (Math.random() < k % 1 ? 1 : 0);
          for (let i = 0; i < count; i++) {
            ws.send(JSON.stringify(s.strikeAt(t - 4000 - Math.random() * 6000))); // 4–10 s latency
          }
        }
      }, 100);
      iv.unref();
      timers.push(iv);
    });
  });
  return () => timers.forEach(clearInterval);
}
