// Canvas renderer for strikes, thunder rings, home rings and the approach glow.
import { destPoint, bearingDeg, distKm } from './geo.js';

const SOUND_KMS = 0.343; // speed of sound, km/s
const RING_MAX_KM = 50;  // audible-ish limit; rings die here
const FADE_MS = 30 * 60 * 1000;

// age (ms) -> [r,g,b]
const COLOR_STOPS = [
  [0, [255, 255, 255]],
  [2 * 60000, [255, 224, 130]],
  [8 * 60000, [255, 152, 0]],
  [16 * 60000, [229, 57, 53]],
  [30 * 60000, [110, 20, 20]],
];

function strikeColor(age) {
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    if (age <= COLOR_STOPS[i][0]) {
      const [a0, c0] = COLOR_STOPS[i - 1];
      const [a1, c1] = COLOR_STOPS[i];
      const f = (age - a0) / (a1 - a0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1][1];
}

export class Overlay {
  constructor(canvas, map, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.store = store; // { strikes: [], home: {lat, lon} }
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
    requestAnimationFrame(() => this._frame());
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.dpr = dpr;
  }

  _frame() {
    if (this.canvas.width !== this.canvas.clientWidth * (window.devicePixelRatio || 1)) {
      this._resize();
    }
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

    const home = this.store.home;
    if (home) this._drawHomeRings(ctx, home);
    this._drawListeningPoint(ctx, home);
    this._drawStrikes(ctx);
    requestAnimationFrame(() => this._frame());
  }

  _project(lat, lon) {
    return this.map.project([lon, lat]);
  }

  // pixel radius of a circle of `km` around home at current zoom
  _pxRadius(home, km) {
    const c = this._project(home.lat, home.lon);
    const e = destPoint(home.lat, home.lon, 90, km);
    const p = this._project(e.lat, e.lon);
    return Math.hypot(p.x - c.x, p.y - c.y);
  }

  _drawHomeRings(ctx, home) {
    const c = this._project(home.lat, home.lon);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (c.x < -w || c.x > 2 * w || c.y < -h || c.y > 2 * h) return;

    for (const km of [10, 25, 50]) {
      const r = this._pxRadius(home, km);
      if (r < 8) continue;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 213, 79, 0.16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 213, 79, 0.45)';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${km} km`, c.x, c.y - r - 4);
    }

    this._drawApproachGlow(ctx, home, c);

    // home marker
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd54f';
    ctx.shadowColor = '#ffd54f';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 8.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 213, 79, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Glow arc on the 50 km ring pointing toward recent activity.
  _drawApproachGlow(ctx, home, c) {
    const now = Date.now();
    let vx = 0, vy = 0, weight = 0;
    for (const s of this.store.strikes) {
      const age = now - s.t;
      if (age > 10 * 60000) continue;
      if (s.dist == null || s.dist > 120) continue;
      const w = (1 / (5 + s.dist)) * (1 - age / (10 * 60000));
      const b = s.bearing * Math.PI / 180;
      vx += Math.sin(b) * w;
      vy += -Math.cos(b) * w;
      weight += w;
    }
    if (weight < 0.01) return;
    const mag = Math.hypot(vx, vy) / weight; // 0..1 concentration
    const bearing = Math.atan2(vx, -vy);     // radians, from north
    const alpha = Math.min(0.85, weight * 3) * (0.3 + 0.7 * mag);

    const r = this._pxRadius(home, RING_MAX_KM);
    if (r < 12) return;
    const centerAngle = bearing - Math.PI / 2; // canvas arc angle
    const span = Math.PI * (0.5 - 0.25 * mag); // tighter arc when concentrated
    const grad = ctx.createRadialGradient(c.x, c.y, r * 0.86, c.x, c.y, r * 1.1);
    grad.addColorStop(0, 'rgba(255, 171, 0, 0)');
    grad.addColorStop(0.55, `rgba(255, 171, 0, ${alpha * 0.55})`);
    grad.addColorStop(1, 'rgba(255, 171, 0, 0)');
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, centerAngle - span, centerAngle + span);
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.min(22, Math.max(6, r * 0.05));
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // When viewing a storm away from home, the "ears" sit at the map center:
  // a faint crosshair plus the 50 km audible ring. A thunder ring crossing
  // the crosshair is the moment its sound plays.
  _drawListeningPoint(ctx, home) {
    const c = this.map.getCenter();
    if (home && distKm(c.lat, c.lng, home.lat, home.lon) <= 30) return;
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 600);

    // audible-range ring
    const r = this._pxRadius({ lat: c.lat, lon: c.lng }, 50);
    if (r > 40) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180, 210, 255, ${0.28 * pulse})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(180, 210, 255, ${0.4 * pulse})`;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('thunder audible · 50 km', cx, cy - r - 5);
    }

    // crosshair
    ctx.strokeStyle = `rgba(180, 210, 255, ${0.55 * pulse})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * 5, cy + dy * 5);
      ctx.lineTo(cx + dx * 12, cy + dy * 12);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180, 210, 255, ${0.7 * pulse})`;
    ctx.fill();
  }

  _drawStrikes(ctx) {
    const now = Date.now();
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const pad = 60;
    let rings = 0;

    // oldest first so fresh strikes draw on top
    const strikes = this.store.strikes;
    for (let i = 0; i < strikes.length; i++) {
      const s = strikes[i];
      const age = now - s.t;
      if (age > FADE_MS) continue;
      const p = this._project(s.lat, s.lon);
      if (p.x < -pad || p.x > w + pad || p.y < -pad || p.y > h + pad) continue;

      // thunder ring: expands at the speed of sound from any on-screen strike
      if (rings < 40) {
        const ringKm = SOUND_KMS * (age / 1000);
        if (ringKm > 0.2 && ringKm < RING_MAX_KM) {
          const rPx = this._pxRadius({ lat: s.lat, lon: s.lon }, ringKm);
          if (rPx > 2) {
            const a = (1 - ringKm / RING_MAX_KM) * 0.4;
            ctx.beginPath();
            ctx.arc(p.x, p.y, rPx, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(180, 210, 255, ${a})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            rings++;
          }
        }
      }

      // arrival flash (keyed to when we received it, not strike time)
      const arrAge = now - s.tArr;
      if (arrAge < 1200) {
        const f = 1 - arrAge / 1200;
        const fr = 6 + 26 * f;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, fr);
        g.addColorStop(0, `rgba(255, 255, 255, ${0.95 * f})`);
        g.addColorStop(0.4, `rgba(255, 240, 180, ${0.55 * f})`);
        g.addColorStop(1, 'rgba(255, 240, 180, 0)');
        ctx.beginPath();
        ctx.arc(p.x, p.y, fr, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }

      // aged dot
      const [r, g2, b] = strikeColor(age);
      const fadeTail = age > FADE_MS * 0.8 ? 1 - (age - FADE_MS * 0.8) / (FADE_MS * 0.2) : 1;
      const alpha = (0.92 - 0.4 * (age / FADE_MS)) * fadeTail;
      const size = 4.6 - 2.2 * (age / FADE_MS);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g2}, ${b}, ${alpha})`;
      if (age < 2 * 60000) {
        ctx.shadowColor = `rgba(${r}, ${g2}, ${b}, 0.9)`;
        ctx.shadowBlur = 8;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
