#!/usr/bin/env node
// Films a live storm on the real Downstrike map and writes a ready-to-post Reel.
//
//   node capture.mjs --out out                 watch the live feed, pick the best storm
//   node capture.mjs --out out --at 29.8,-95.4  film a spot you choose
//   node capture.mjs --out out --fake-feed --warmup 0.5   offline test run
//
// How it works: headless Chromium opens app/?broadcast (chrome hidden, silent)
// and listens to the Blitzortung feed for a while so storm trails build up.
// Then it freezes the page clock and steps it one frame at a time, taking a
// screenshot per frame, so the video is smooth no matter how slow the machine.
// Thunder is rendered offline with the app's own synth, each clap placed at the
// moment that strike's sound ring reaches the crosshair. ffmpeg muxes the result.
//
// Output: clip.mp4 (1080×1920, H.264/AAC), cover.jpg, caption.txt, meta.json.
// Exit 0 with meta.skipped when nothing is worth filming; exit 2 if the feed is dead.

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickStorm, describePlace, nearestCity } from './pick.mjs';
import { OVERLAY_CSS, overlayHtml } from './overlay.mjs';
import { nwsAlerts, safetyLevel, writeCaption } from './caption.mjs';
import { attachFakeFeed } from './fake-feed.mjs';
import { selectClaps, AUDIO_FILTER } from './sound.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const UA = 'Downstrike-promo/1.0 (+https://downstrike.app)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function parseArgs(argv) {
  const a = { out: 'out', state: path.join(HERE, '.state', 'history.json') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--out') a.out = next();
    else if (k === '--at') a.at = next();
    else if (k === '--force') a.force = true;
    else if (k === '--fake-feed') a.fakeFeed = true;
    else if (k === '--warmup') a.warmup = Number(next());
    else if (k === '--seconds') a.seconds = Number(next());
    else if (k === '--state') a.state = next();
    else if (k === '--no-caption') a.noCaption = true;
    else throw new Error(`unknown argument ${k}`);
  }
  if (a.at) {
    const [lat, lon] = a.at.split(',').map(Number);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error(`bad --at "${a.at}" (want lat,lon)`);
    a.at = { lat, lon };
  }
  return a;
}

// ---- a tiny static server for app/ only, so the run films this commit's app ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve(root) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://local');
    let p = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
    if (!p.startsWith(path.join(root, 'app') + path.sep)) { res.writeHead(403); res.end(); return; }
    if (p.endsWith(path.sep)) p = path.join(p, 'index.html');
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => { server.closeAllConnections(); server.close(); },
  })));
}

async function getJson(url, ms = 8000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// State/region name for storms far from any listed metro ("Mato Grosso, Brazil").
async function regionName(lat, lon) {
  try {
    const j = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);
    const a = j.address || {};
    const parts = [a.state || a.region, a.country].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  } catch (e) { return null; }
}

// Local wall-clock time at the storm, e.g. "Oct 8, 7:42 PM CDT".
async function localWhen(lat, lon, at) {
  let tz = 'UTC', abbr = 'UTC';
  try {
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&timezone=auto&forecast_days=1&current=temperature_2m`);
    tz = j.timezone || tz;
    abbr = j.timezone_abbreviation || abbr;
  } catch (e) {}
  const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(at);
  const day = fmt({ month: 'short', day: 'numeric' });
  const time = fmt({ hour: 'numeric', minute: '2-digit' });
  const zone = /^[A-Z]{2,5}$/.test(abbr) ? abbr : fmt({ timeZoneName: 'short' }).split(' ').pop();
  return { when: `${day}, ${time} ${zone}`, tz };
}

// ---- in-page helpers (run inside the browser) ----

// Center on the densest part of the storm and measure it.
function refineInPage({ lat, lon }) {
  const { store } = window._downstrike;
  const now = Date.now();
  const toKm = (a, b) => {
    const dLat = (b.lat - a.lat) * 111.2;
    const dLon = (b.lon - a.lon) * 111.2 * Math.cos(a.lat * Math.PI / 180);
    return Math.hypot(dLat, dLon);
  };
  const recent = store.strikes.filter((s) => s.t > now - 10 * 60e3 && toKm({ lat, lon }, s) < 90);
  const cells = new Map();
  for (const s of recent) {
    const k = Math.floor(s.lat * 10) + ':' + Math.floor(s.lon * 10);
    cells.set(k, (cells.get(k) || 0) + 1);
  }
  let best = null;
  for (const k of cells.keys()) {
    const [i, j] = k.split(':').map(Number);
    let n = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += cells.get((i + a) + ':' + (j + b)) || 0;
    if (!best || n > best.n) best = { n, lat: (i + 0.5) / 10, lon: (j + 0.5) / 10 };
  }
  let c = best ? { lat: best.lat, lon: best.lon } : { lat, lon };
  const core = recent.filter((s) => toKm(c, s) < 25);
  if (core.length) {
    c = { lat: core.reduce((a, s) => a + s.lat, 0) / core.length, lon: core.reduce((a, s) => a + s.lon, 0) / core.length };
  }
  const near = store.strikes.filter((s) => toKm(c, s) < 50);
  return {
    lat: c.lat, lon: c.lon,
    strikes10: near.filter((s) => s.t > now - 10 * 60e3).length,
    perMin: near.filter((s) => s.t > now - 60e3).length,
  };
}

// Fresh flashes on screen at fake time ft (for picking the cover frame).
function flashesInPage({ ft, lat, lon }) {
  let n = 0;
  for (const s of window._downstrike.store.strikes) {
    if (s.tArr > ft - 350 && s.tArr <= ft &&
        Math.abs(s.lat - lat) < 0.45 && Math.abs(s.lon - lon) < 0.45) n++;
  }
  return n;
}

// Every strike whose sound ring reaches the crosshair during the clip, with
// the moment it arrives. Node then picks which ones get a clap (sound.mjs).
function thunderEventsInPage({ T0, durMs, lat, lon }) {
  const SOUND_KMS = 0.343;
  const toKm = (a, b) => {
    const dLat = (b.lat - a.lat) * 111.2;
    const dLon = (b.lon - a.lon) * 111.2 * Math.cos(a.lat * Math.PI / 180);
    return Math.hypot(dLat, dLon);
  };
  const events = [];
  let busy = 0;
  for (const s of window._downstrike.store.strikes) {
    const d = toKm({ lat, lon }, s);
    if (d < 100 && s.t > T0 - 10 * 60e3) busy++;
    if (d > 50) continue;
    // seconds into the clip: when its ring reaches the crosshair, never
    // before its flash is on screen (thunder always follows the flash)
    const at = (Math.max(s.t + (d / SOUND_KMS) * 1000, s.tArr) - T0) / 1000;
    if (at > -0.2 && at < durMs / 1000 - 0.5) events.push({ at: Math.max(0, at), d });
  }
  return { events, busy };
}

// Offline render with the app's own thunder synth, over a faint low rumble
// bed that scales with how busy the storm is. Returns base64 16-bit WAV.
async function renderThunderInPage({ claps, busy, durMs }) {
  const { synthThunder } = await import('/app/src/audio.js');
  const sr = 48000;
  const len = Math.ceil(sr * durMs / 1000);
  const ac = new OfflineAudioContext(2, len, sr);
  const bed = ac.createBuffer(2, len, sr);
  const level = 0.004 + 0.012 * Math.min(1, busy / 800);
  for (let ch = 0; ch < 2; ch++) {
    const data = bed.getChannelData(ch);
    let brown = 0;
    const phase = Math.random() * 6.28;
    for (let i = 0; i < len; i++) {
      brown = brown * 0.995 + (Math.random() * 2 - 1) * 0.06;
      const t = i / sr;
      const swell = 0.6 + 0.4 * Math.sin(phase + t * 0.45) * Math.sin(t * 0.17 + ch);
      const edge = Math.min(1, t / 0.8, (durMs / 1000 - t) / 0.8);
      data[i] = brown * swell * edge * level * 6;
    }
  }
  const bedSrc = ac.createBufferSource();
  bedSrc.buffer = bed;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 160;
  bedSrc.connect(lp).connect(ac.destination);
  bedSrc.start(0);
  for (const c of claps) synthThunder(ac, ac.destination, c.d, c.at);

  const buf = await ac.startRendering();
  const chans = [buf.getChannelData(0), buf.getChannelData(1)];
  let peak = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  const gain = peak > 0 ? 0.89 / peak : 1; // -1 dBFS; the ffmpeg chain sets loudness
  const out = new DataView(new ArrayBuffer(44 + len * 4));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + len * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true);
  out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, len * 4, true);
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const v = Math.max(-1, Math.min(1, chans[ch][i] * gain));
      out.setInt16(44 + i * 4 + ch * 2, v * 32767, true);
    }
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function runFfmpeg(args, { input } = {}) {
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  return { ff, done };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['clip.mp4', 'cover.jpg', 'caption.txt', 'meta.json', 'video.mp4', 'audio.wav']) fs.rmSync(path.join(out, f), { force: true });
  if (spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('ffmpeg not found');

  const seconds = args.seconds || cfg.clipSeconds;
  const fps = cfg.fps;
  const history = fs.existsSync(args.state) ? JSON.parse(fs.readFileSync(args.state, 'utf8')) : [];

  const server = await serve(ROOT);
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    // only what Chromium needs; no API keys in the browser's environment
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', FONTCONFIG_FILE: path.join(HERE, 'fonts.conf') },
  });
  let stopFake = null;
  try {
    const context = await browser.newContext({
      viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, locale: 'en-US', colorScheme: 'dark',
    });
    await context.route(/gc\.zgo\.at/, (r) => r.abort()); // never count the robot as a visitor
    if (args.fakeFeed) {
      await context.route((u) => !u.href.startsWith(server.url), (r) => r.abort()); // fully offline
      stopFake = await attachFakeFeed(context, { log });
    }
    const page = await context.newPage();
    page.on('pageerror', (e) => log('page error:', e.message));

    await page.goto(`${server.url}/app/?broadcast&delay=${cfg.replayDelayMs}`);
    await page.waitForFunction(() => window._downstrike, null, { timeout: 30000 });

    // ---- warm up: let 10–30 minutes of trails accumulate ----
    const warmMs = (args.warmup ?? cfg.warmupMinutes) * 60e3;
    const t0 = Date.now();
    log(`listening to the live feed for ${(warmMs / 60e3).toFixed(1)} min`);
    while (Date.now() - t0 < warmMs) {
      await sleep(Math.min(60e3, warmMs - (Date.now() - t0)));
      const s = await page.evaluate(() => ({ n: window._downstrike.store.strikes.length, conn: document.getElementById('conn-text').textContent }));
      log(`  ${s.n} strikes so far (${s.conn})`);
    }
    const total = await page.evaluate(() => window._downstrike.store.strikes.length);
    if (total < 50) {
      log(`feed looks dead: ${total} strikes after warm-up`);
      process.exitCode = 2;
      return;
    }

    // ---- pick ----
    let target;
    if (args.at) {
      target = { ...args.at, count: null };
      log(`filming the requested spot ${args.at.lat}, ${args.at.lon}`);
    } else {
      const storms = await page.evaluate(() => window._downstrike.findLiveStorms(window._downstrike.store.strikes));
      const pick = pickStorm(storms, { history, cfg, force: args.force });
      for (const r of pick.ranked || []) {
        const { city, d } = nearestCity(r.storm.lat, r.storm.lon);
        log(`  storm ${r.storm.lat.toFixed(2)},${r.storm.lon.toFixed(2)} · ${r.storm.count} strikes/10 min · ${Math.round(d)} km from ${city.name} · score ${r.score}${r.fresh ? '' : ' (cooldown)'}`);
      }
      if (pick.skip) {
        log(`nothing to film: ${pick.skip}`);
        fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify({ skipped: pick.skip }, null, 2));
        return;
      }
      target = pick.storm;
      log(`picked ${target.lat.toFixed(2)}, ${target.lon.toFixed(2)} (score ${pick.score}${pick.fallback ? ', daily fallback' : ''})`);
    }

    const spot = await page.evaluate(refineInPage, { lat: target.lat, lon: target.lon });
    // zoom so the app's 50 km "thunder audible" ring is the same size on every
    // clip, sitting just under the headline whatever the latitude
    const zoom = +Math.log2(78271.517 * Math.cos(spot.lat * Math.PI / 180) * cfg.ringRadiusPx / 50000).toFixed(2);
    const filmedAt = new Date();
    const near = nearestCity(spot.lat, spot.lon);
    const region = near.d > 150 && !args.fakeFeed ? await regionName(spot.lat, spot.lon) : null;
    const place = describePlace(spot.lat, spot.lon, region);
    const { when, tz } = args.fakeFeed ? { when: 'test run', tz: 'UTC' } : await localWhen(spot.lat, spot.lon, filmedAt);
    log(`${place.title} · ${place.sub} · ${spot.strikes10} strikes in 10 min · ${when}`);

    // ---- frame the shot ----
    await page.evaluate(({ lat, lon, zoom }) => {
      const d = window._downstrike;
      d.map.jumpTo({ center: [lon, lat], zoom });
      d.fetchWindField({ lat, lon }).then((f) => d.particles.setField(f)).catch(() => {});
    }, { lat: spot.lat, lon: spot.lon, zoom });
    const tilesBy = Date.now() + (args.fakeFeed ? 4000 : 30000);
    while (Date.now() < tilesBy) {
      if (await page.evaluate(() => window._downstrike.map.loaded() && window._downstrike.map.areTilesLoaded())) break;
      await sleep(500);
    }
    await sleep(3000); // wind field + a few frames of particles
    await page.addStyleTag({ content: OVERLAY_CSS });
    await page.evaluate((html) => {
      const el = document.createElement('div');
      el.id = 'promo';
      el.innerHTML = html;
      document.body.appendChild(el);
    }, overlayHtml({ title: place.title, sub: place.sub, strikes10: spot.strikes10, when }));
    await page.evaluate(() => document.fonts.ready.then(() => true));

    // ---- film: freeze time, then step it one frame at a time ----
    await context.clock.install();
    const T0 = (await page.evaluate(() => Date.now())) + 50;
    await context.clock.pauseAt(T0);
    await sleep(400); // the release loop catches up to the frozen clock
    const frames = Math.round(seconds * fps);
    const videoPath = path.join(out, 'video.mp4');
    const enc = runFfmpeg(['-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0',
      '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-g', String(fps * 2),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-r', String(fps), '-an', videoPath], { input: true });
    const write = (buf) => new Promise((resolve, reject) => enc.ff.stdin.write(buf, (e) => (e ? reject(e) : resolve())));
    let cover = { n: -1, buf: null, ms: 0 };
    const started = Date.now();
    let elapsed = 0;
    let feedOn = true;
    for (let i = 0; i < frames; i++) {
      // once every strike the clip can show has arrived, hang up on the feed:
      // less load on the volunteers' servers and on this machine
      if (feedOn && Date.now() - started > seconds * 1000 + 25000) {
        await page.evaluate(() => window._downstrike.stopFeed());
        feedOn = false;
      }
      const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
      await write(buf);
      const n = await page.evaluate(flashesInPage, { ft: T0 + elapsed, lat: spot.lat, lon: spot.lon });
      if (n > cover.n && i > fps / 2 && i < frames - fps / 2) cover = { n, buf, ms: Math.round(elapsed) };
      const step = Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps);
      await context.clock.runFor(step);
      elapsed += step;
      if (i % fps === fps - 1) log(`  filmed ${(i + 1) / fps}s of ${seconds}s (${((Date.now() - started) / 1000).toFixed(0)}s real)`);
    }
    enc.ff.stdin.end();
    await enc.done;

    // ---- sound ----
    const heard = await page.evaluate(thunderEventsInPage, { T0, durMs: seconds * 1000, lat: spot.lat, lon: spot.lon });
    const claps = selectClaps(heard.events);
    const wav = await page.evaluate(renderThunderInPage, { claps, busy: heard.busy, durMs: seconds * 1000 });
    const audioPath = path.join(out, 'audio.wav');
    fs.writeFileSync(audioPath, Buffer.from(wav, 'base64'));
    log(`thunder: ${claps.length} claps (${claps.filter((c) => c.d < 8).length} close) from ${heard.events.length} strikes whose sound arrives during the clip`);

    const mux = runFfmpeg(['-i', videoPath, '-i', audioPath, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
      '-af', AUDIO_FILTER, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-shortest',
      '-movflags', '+faststart', '-use_editlist', '0', // Meta's Reels spec: moov first, no edit lists
      path.join(out, 'clip.mp4')]);
    await mux.done;
    fs.writeFileSync(path.join(out, 'cover.jpg'), cover.buf || (await page.screenshot({ type: 'jpeg', quality: 92 })));
    fs.rmSync(videoPath, { force: true });
    fs.rmSync(audioPath, { force: true });

    // ---- words ----
    const alerts = args.fakeFeed ? [] : await nwsAlerts(spot.lat, spot.lon);
    const meta = {
      filmedAt: filmedAt.toISOString(), when, tz,
      lat: +spot.lat.toFixed(4), lon: +spot.lon.toFixed(4), zoom,
      place: { title: place.title, sub: place.sub, city: place.city ? { name: place.city.name, region: place.city.region, cc: place.city.cc } : null },
      stats: { strikes10: spot.strikes10, perMin: spot.perMin },
      alerts, safety: safetyLevel(alerts),
      thumbOffsetMs: cover.ms, claps: claps.length, seconds,
      shareUrl: `https://downstrike.app/app/?at=${spot.lat.toFixed(3)},${spot.lon.toFixed(3)},8.4`,
      fake: !!args.fakeFeed,
    };
    if (alerts.length) log(`NWS alerts here: ${alerts.map((a) => a.event).join(', ')} (safety ${meta.safety})`);
    const { caption, source } = args.noCaption ? { caption: '', source: 'none' } : await writeCaption(meta, cfg, { log });
    meta.captionSource = source;
    fs.writeFileSync(path.join(out, 'caption.txt'), caption);
    fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 2));

    if (!args.fakeFeed) {
      fs.mkdirSync(path.dirname(args.state), { recursive: true });
      const keep = history.filter((h) => Date.now() - Date.parse(h.at) < 7 * 86400e3);
      keep.push({ at: meta.filmedAt, lat: meta.lat, lon: meta.lon, title: place.title });
      fs.writeFileSync(args.state, JSON.stringify(keep, null, 2));
    }
    log(`done: ${path.join(out, 'clip.mp4')} (${(fs.statSync(path.join(out, 'clip.mp4')).size / 1e6).toFixed(1)} MB), caption by ${source}`);
  } finally {
    if (stopFake) stopFake();
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
