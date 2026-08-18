// Wind: point readout for home + a particle-flow field over the map (Open-Meteo).
import { compass } from './geo.js';

const KMH_TO_MS = 1 / 3.6;

export async function fetchHomeWind(home) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${home.lat.toFixed(4)}&longitude=${home.lon.toFixed(4)}` +
    `&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kmh`;
  const res = await fetch(u);
  if (!res.ok) throw new Error('open-meteo ' + res.status);
  const j = await res.json();
  const c = j.current;
  return {
    speed: c.wind_speed_10m,
    gusts: c.wind_gusts_10m,
    dir: c.wind_direction_10m,
    dirText: compass(c.wind_direction_10m),
  };
}

// 5x5 grid of wind vectors over ~±1.3° around home
export async function fetchWindField(home) {
  const N = 5;
  const dLat = 1.3, dLon = 1.6;
  const lats = [], lons = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      lats.push((home.lat - dLat + (2 * dLat * i) / (N - 1)).toFixed(3));
      lons.push((home.lon - dLon + (2 * dLon * j) / (N - 1)).toFixed(3));
    }
  }
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
    `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;
  const res = await fetch(u);
  if (!res.ok) throw new Error('open-meteo field ' + res.status);
  const arr = await res.json();
  const cells = (Array.isArray(arr) ? arr : [arr]).map((r) => {
    const sp = r.current.wind_speed_10m * KMH_TO_MS;
    const dir = r.current.wind_direction_10m * Math.PI / 180;
    // meteorological direction = where wind comes FROM
    return { u: -sp * Math.sin(dir), v: -sp * Math.cos(dir) };
  });
  return {
    n: N,
    lat0: home.lat - dLat, lat1: home.lat + dLat,
    lon0: home.lon - dLon, lon1: home.lon + dLon,
    cells, // row-major, i = lat index (south->north order as built), j = lon index
  };
}

function sampleField(field, lat, lon) {
  const { n, lat0, lat1, lon0, lon1, cells } = field;
  const fi = Math.min(Math.max((lat - lat0) / (lat1 - lat0), 0), 1) * (n - 1);
  const fj = Math.min(Math.max((lon - lon0) / (lon1 - lon0), 0), 1) * (n - 1);
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const i1 = Math.min(i0 + 1, n - 1), j1 = Math.min(j0 + 1, n - 1);
  const ti = fi - i0, tj = fj - j0;
  const g = (i, j) => cells[i * n + j];
  const c00 = g(i0, j0), c01 = g(i0, j1), c10 = g(i1, j0), c11 = g(i1, j1);
  return {
    u: (c00.u * (1 - tj) + c01.u * tj) * (1 - ti) + (c10.u * (1 - tj) + c11.u * tj) * ti,
    v: (c00.v * (1 - tj) + c01.v * tj) * (1 - ti) + (c10.v * (1 - tj) + c11.v * tj) * ti,
  };
}

const SPEED_EXAGGERATION = 0.00028; // deg per (m/s · frame) — tuned for visibility

export class WindParticles {
  constructor(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.field = null;
    this.enabled = true;
    this.particles = [];
    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    this._resize();
    map.on('move', () => this._clear());
    requestAnimationFrame(() => this._frame());
  }

  setField(field) {
    this.field = field;
    this._spawnAll();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this._clear();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.dpr = dpr;
    this._clear();
  }

  _clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _spawnAll() {
    const b = this.map.getBounds();
    this.particles = [];
    for (let i = 0; i < 380; i++) this.particles.push(this._spawn(b));
  }

  _spawn(b) {
    return {
      lat: b.getSouth() + Math.random() * (b.getNorth() - b.getSouth()),
      lon: b.getWest() + Math.random() * (b.getEast() - b.getWest()),
      life: 60 + Math.random() * 240, // frames
      px: null, py: null,
    };
  }

  _frame() {
    if (this.canvas.width !== this.canvas.clientWidth * (window.devicePixelRatio || 1)) {
      this._resize();
    }
    if (this.enabled && this.field && this.particles.length) {
      const ctx = this.ctx;
      const dpr = this.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // fade previous trails
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
      ctx.globalCompositeOperation = 'source-over';

      const b = this.map.getBounds();
      ctx.strokeStyle = 'rgba(160, 190, 235, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const p of this.particles) {
        const w = sampleField(this.field, p.lat, p.lon);
        const cosLat = Math.max(0.2, Math.cos(p.lat * Math.PI / 180));
        p.lat += w.v * SPEED_EXAGGERATION;
        p.lon += w.u * SPEED_EXAGGERATION / cosLat;
        p.life--;
        const pt = this.map.project([p.lon, p.lat]);
        if (p.px !== null) {
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(pt.x, pt.y);
        }
        p.px = pt.x; p.py = pt.y;
        const out = p.lat < b.getSouth() || p.lat > b.getNorth() ||
          p.lon < b.getWest() || p.lon > b.getEast();
        if (p.life <= 0 || out) Object.assign(p, this._spawn(b));
      }
      ctx.stroke();
    }
    requestAnimationFrame(() => this._frame());
  }
}
