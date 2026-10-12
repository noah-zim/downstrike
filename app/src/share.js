// "Share this storm": exports what's on screen as a branded picture or a short
// vertical clip, then hands it to the system share sheet (download + copied
// link where there is none). The link opens the same view (?at=) and is tagged
// utm_source=share so GoatCounter shows these visits as their own referrer.
//
// The export is drawn from the live layers, not a screenshot: the MapLibre
// canvas (read inside its 'render' event, while the WebGL buffer is still
// intact), the wind canvas, then the strikes redrawn as vectors at export
// resolution. Home rings and the listening crosshair are left out, so a shared
// picture never marks anyone's home.
import { distKm } from './geo.js';
import { startAudioTap, stopAudioTap } from './audio.js';

const SITE = 'https://downstrike.app/app/';
const CLIP_SECONDS = 15;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif';
const BOLT = 'M11.2 2L4.6 11h4.2l-1.4 7L14.4 8.6h-4.1L11.2 2z';
const AMBER = '#ffd54f';
const MUTED = '#8a93a5';
const TEXT = '#e8eaf0';

const $ = (id) => document.getElementById(id);

// H.264 in MP4 only: it's what X, Instagram, TikTok and Messages all take.
// Browsers that can only record WebM (Firefox, open-source Chromium) get the
// picture alone. Plain "video/mp4" is trusted only on Safari, where it means
// H.264 + AAC; elsewhere it can mean VP9-in-MP4, which X rejects.
export function clipType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const ok = (t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } };
  const candidates = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1.42E01F',
    'video/mp4;codecs=avc1',
  ];
  for (const t of candidates) if (ok(t)) return t;
  if (/Apple/.test(navigator.vendor) && ok('video/mp4')) return 'video/mp4';
  return null;
}

// The share link: same spot and zoom. Near home it's rounded to 0.1° (~10 km)
// so the link doesn't pinpoint the sharer's house.
export function shareLink(map, home, medium) {
  const c = map.getCenter().wrap();
  const nearHome = home && distKm(c.lat, c.lng, home.lat, home.lon) < 25;
  const d = nearHome ? 1 : 2;
  const z = Math.min(16, Math.max(1, map.getZoom()));
  return `${SITE}?at=${c.lat.toFixed(d)},${c.lng.toFixed(d)},${z.toFixed(1)}` +
    `&utm_source=share&utm_medium=${medium}`;
}

// State/country under the view, for the title. Region level only.
const placeCache = new Map();
async function placeName(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  let name = null;
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5' +
      `&email=noah.iterates%40gmail.com&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`,
      { headers: { 'Accept-Language': 'en' }, signal: AbortSignal.timeout(3000) });
    const a = (await res.json()).address || {};
    const region = a.state || a.region || a.province || a.archipelago;
    if (a.country_code === 'us') name = region || null;
    else name = [region, a.country].filter(Boolean).join(', ') || null;
  } catch (e) {}
  placeCache.set(key, name);
  return name;
}

// The part of the screen that gets exported (CSS px), and the output scale.
function frameFor(aspect) {
  const el = $('map');
  const W = el.clientWidth, H = el.clientHeight;
  let w = W, h = H;
  if (W / H > aspect) w = H * aspect; else h = W / aspect;
  const long = Math.max(w, h), short = Math.min(w, h);
  const dpr = window.devicePixelRatio || 1;
  // ≤1080×1920; at least 2× so text and strikes stay crisp on 1× screens
  const s = Math.min(1920 / long, 1080 / short, Math.max(dpr, 2));
  const even = (v) => 2 * Math.round(v / 2); // video encoders want even sizes
  return { W, H, x: (W - w) / 2, y: (H - h) / 2, w, h, s, outW: even(w * s), outH: even(h * s) };
}

// Map + wind + strikes for one frame. Call only inside the map's 'render'.
function drawScene(ctx, f, map, overlay) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, f.outW, f.outH);
  for (const src of [map.getCanvas(), $('wind-canvas')]) {
    const k = src.width / f.W; // canvas px per CSS px
    if (k > 0) ctx.drawImage(src, f.x * k, f.y * k, f.w * k, f.h * k, 0, 0, f.outW, f.outH);
  }
  const sx = f.outW / f.w, sy = f.outH / f.h;
  ctx.setTransform(sx, 0, 0, sy, -f.x * sx, -f.y * sy);
  overlay.draw(ctx, f.W, f.H, { home: false, listening: false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function onNextRender(map, fn) {
  return new Promise((resolve) => {
    map.once('render', () => resolve(fn()));
    map.triggerRepaint();
  });
}

// Strikes from the last 10 minutes inside the exported frame.
function strikesInFrame(map, store, f) {
  const since = Date.now() - 10 * 60000;
  let n = 0;
  for (const s of store.strikes) {
    if (s.t < since) continue;
    const p = map.project([s.lon, s.lat]);
    if (p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h) n++;
  }
  return n;
}

// The branded frame: wordmark, title, count, credits. Drawn once per export.
function brandLayer(f, { title, when, count, radar }) {
  const c = document.createElement('canvas');
  c.width = f.outW; c.height = f.outH;
  const ctx = c.getContext('2d');
  const W = f.outW, H = f.outH;
  const u = Math.min(W, H) / 540; // design unit: a 540 px-wide phone frame
  const portrait = H > W;

  let g = ctx.createLinearGradient(0, 0, 0, 250 * u);
  g.addColorStop(0, 'rgba(10,12,16,0.9)');
  g.addColorStop(0.6, 'rgba(10,12,16,0.6)');
  g.addColorStop(1, 'rgba(10,12,16,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 250 * u);
  g = ctx.createLinearGradient(0, H - 110 * u, 0, H);
  g.addColorStop(0, 'rgba(10,12,16,0)');
  g.addColorStop(1, 'rgba(10,12,16,0.88)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 110 * u, W, 110 * u);

  const left = 26 * u;
  const maxW = W - 2 * left;
  let y = (portrait ? 64 : 34) * u; // vertical: clear of the platforms' top bar
  ctx.textBaseline = 'alphabetic';

  // wordmark
  ctx.save();
  ctx.translate(left, y - 15 * u);
  ctx.scale(0.95 * u, 0.95 * u);
  ctx.shadowColor = 'rgba(255,171,0,0.6)';
  ctx.shadowBlur = 8 * u;
  ctx.fillStyle = AMBER;
  ctx.fill(new Path2D(BOLT));
  ctx.restore();
  ctx.font = `700 ${16 * u}px ${FONT}`;
  ctx.fillStyle = TEXT;
  const brandX = left + 22 * u;
  ctx.fillText('Downstrike', brandX, y);
  const bw = ctx.measureText('Downstrike').width;
  ctx.font = `500 ${13 * u}px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText('downstrike.app', brandX + bw + 8 * u, y);

  // title, shrunk to fit
  y += 44 * u;
  let size = 30 * u;
  ctx.font = `700 ${size}px ${FONT}`;
  while (ctx.measureText(title).width > maxW && size > 18 * u) {
    size -= u;
    ctx.font = `700 ${size}px ${FONT}`;
  }
  ctx.fillStyle = TEXT;
  ctx.fillText(title, left, y);

  y += 24 * u;
  ctx.font = `400 ${14 * u}px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(when, left, y);

  if (count > 0) {
    y += 38 * u;
    const n = count.toLocaleString('en-US');
    ctx.font = `700 ${26 * u}px ${FONT}`;
    ctx.fillStyle = AMBER;
    ctx.shadowColor = 'rgba(255,171,0,0.35)';
    ctx.shadowBlur = 14 * u;
    ctx.fillText(n, left, y);
    ctx.shadowBlur = 0;
    const nw = ctx.measureText(n).width;
    ctx.font = `400 ${14.5 * u}px ${FONT}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(`${count === 1 ? 'strike' : 'strikes'} in the last 10 minutes`, left + nw + 9 * u, y);
  }

  // credits: Blitzortung's licence needs the source named in the frame
  ctx.font = `500 ${10.5 * u}px ${FONT}`;
  ctx.fillStyle = 'rgba(200,206,218,0.9)';
  const bottom = H - (portrait ? 30 : 18) * u;
  ctx.fillText('Lightning: Blitzortung.org (CC BY-SA)', left, bottom - 15 * u);
  ctx.fillStyle = 'rgba(138,147,165,0.95)';
  ctx.fillText(`Map © CARTO © OpenStreetMap${radar ? ' · Radar: RainViewer' : ''}`, left, bottom);
  return c;
}

function countEvent(path) {
  try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path, event: true }); } catch (e) {}
}

export function createShare({ map, overlay, store, settings, toast }) {
  const sheet = $('share-sheet'), scrim = $('share-scrim');
  const preview = $('share-preview'), go = $('share-go'), clipBtn = $('share-clip');
  const pill = $('rec-pill'), pillTime = $('rec-time');
  const mime = clipType();

  let current = null;  // { file, medium, url } ready to share
  let meta = null;     // { title, place } for the open share
  let objectUrl = null;
  let recording = null;

  const caption = () => meta.place
    ? `Lightning over ${meta.place}, live on Downstrike ⚡`
    : 'Live lightning on Downstrike ⚡';

  const setPreview = (el) => {
    preview.replaceChildren(el);
  };
  const setObjectUrl = (blob) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = blob ? URL.createObjectURL(blob) : null;
    return objectUrl;
  };
  const show = (open) => {
    sheet.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
  };
  const close = () => {
    show(false);
    current = null;
    // let the slide-out finish before dropping the preview
    setTimeout(() => { if (!sheet.classList.contains('open') && !recording) { preview.replaceChildren(); setObjectUrl(null); } }, 400);
  };

  const describe = async (f) => {
    const c = map.getCenter().wrap();
    const place = await placeName(c.lat, c.lng);
    const when = new Date().toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
    return {
      place,
      brand: brandLayer(f, {
        title: place ? `Lightning over ${place}` : 'Live lightning',
        when,
        count: strikesInFrame(map, store, f),
        radar: settings.radar,
      }),
    };
  };

  async function openImage() {
    if (recording) return;
    countEvent('share-open');
    current = null;
    go.disabled = true;
    go.textContent = 'Share picture';
    clipBtn.classList.toggle('hidden', !mime);
    const wait = document.createElement('div');
    wait.className = 'share-wait';
    wait.textContent = 'Framing the storm…';
    setPreview(wait);
    show(true);

    // freeze the moment of the tap, then add the frame once the place is known
    const f = frameFor(Math.min(16 / 9, Math.max(9 / 16, $('map').clientWidth / $('map').clientHeight)));
    const scene = document.createElement('canvas');
    scene.width = f.outW; scene.height = f.outH;
    await onNextRender(map, () => drawScene(scene.getContext('2d'), f, map, overlay));
    const d = await describe(f);
    meta = { place: d.place };
    scene.getContext('2d').drawImage(d.brand, 0, 0);
    const blob = await new Promise((r) => scene.toBlob(r, 'image/jpeg', 0.92));
    if (!blob || !sheet.classList.contains('open')) return;
    const img = new Image();
    img.alt = 'The picture that will be shared';
    img.src = setObjectUrl(blob);
    setPreview(img);
    current = {
      file: new File([blob], 'downstrike-storm.jpg', { type: 'image/jpeg' }),
      medium: 'image',
    };
    go.disabled = false;
  }

  async function startClip() {
    if (!mime || recording) return;
    countEvent('share-clip-start');
    show(false);
    const f = frameFor(9 / 16);
    const d = await describe(f);
    meta = { place: d.place };
    const canvas = document.createElement('canvas');
    canvas.width = f.outW; canvas.height = f.outH;
    const ctx = canvas.getContext('2d');
    const draw = () => { drawScene(ctx, f, map, overlay); ctx.drawImage(d.brand, 0, 0); };
    await onNextRender(map, draw); // first frame in place before the recorder starts

    const stream = canvas.captureStream(30);
    const withAudio = mime.includes('mp4a') || mime === 'video/mp4';
    const audio = withAudio && settings.sound ? startAudioTap() : null;
    if (audio) for (const t of audio.getAudioTracks()) stream.addTrack(t);
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
    } catch (e) {
      stopAudioTap();
      toast("This browser can't record clips. Try a picture instead.");
      return;
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const started = performance.now();
    map.on('render', draw);
    let raf = 0;
    const tick = () => {
      map.triggerRepaint(); // keep the map drawing every frame, even when still
      const left = Math.max(0, CLIP_SECONDS - (performance.now() - started) / 1000);
      pillTime.textContent = `0:${String(Math.ceil(left)).padStart(2, '0')}`;
      if (left <= 0) { stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    const onHidden = () => { if (document.hidden) stop(); };
    const stop = () => {
      if (!recording) return;
      recording = null;
      cancelAnimationFrame(raf);
      map.off('render', draw);
      document.removeEventListener('visibilitychange', onHidden);
      pill.classList.add('hidden');
      stopAudioTap();
      if (rec.state !== 'inactive') rec.stop();
    };
    const done = new Promise((r) => { rec.onstop = r; });
    recording = { stop };
    document.addEventListener('visibilitychange', onHidden);
    pill.classList.remove('hidden');
    rec.start(1000);
    tick();

    await done;
    for (const t of stream.getTracks()) t.stop();
    const type = mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    if (!blob.size) { toast("The clip didn't record. Try again, or share a picture."); return; }
    const video = document.createElement('video');
    video.src = setObjectUrl(blob);
    video.muted = true; video.loop = true; video.autoplay = true; video.playsInline = true;
    video.setAttribute('playsinline', '');
    setPreview(video);
    video.play().catch(() => {});
    current = { file: new File([blob], 'downstrike-storm.mp4', { type }), medium: 'clip' };
    go.textContent = 'Share clip';
    go.disabled = false;
    clipBtn.textContent = 'Record again';
    show(true);
    countEvent('share-clip-ready');
  }

  // Runs straight from the tap: Safari only opens the share sheet inside a
  // user gesture, which is why the file is built before this button enables.
  async function shareCurrent() {
    if (!current) return;
    const url = shareLink(map, store.home, current.medium);
    const data = { files: [current.file], title: 'Downstrike', text: `${caption()}\n${url}` };
    if (navigator.canShare && navigator.canShare({ files: data.files })) {
      try {
        await navigator.share(data);
        countEvent(`share-${current.medium}`);
      } catch (e) {
        if (e.name === 'AbortError') return; // closed the share sheet
        toast("Couldn't open sharing. Saved instead.");
        download(current.file);
      }
      return;
    }
    download(current.file);
    const copied = await copy(url);
    toast(copied ? 'Saved. Link copied too.' : 'Saved to your downloads.');
    countEvent(`share-${current.medium}-download`);
  }

  function download(file) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
  }

  async function copyLink() {
    const url = shareLink(map, store.home, 'link');
    if (await copy(url)) { toast('Link copied'); countEvent('share-link'); }
    else toast(url);
  }

  pill.onclick = () => recording && recording.stop();
  scrim.onclick = close;
  $('share-close').onclick = close;
  go.onclick = shareCurrent;
  clipBtn.onclick = startClip;
  $('share-copy').onclick = copyLink;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('open')) close();
  });

  return { open: () => { clipBtn.textContent = `Record a ${CLIP_SECONDS} s clip`; openImage(); } };
}
