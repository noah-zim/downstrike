// Record a vertical clip of live lightning on downstrike.app.
// usage: node record_clip.js <out.mp4> [lat lon zoom] [seconds]
// With no lat/lon it uses the app's ?storm mode (flies to the most active storm on Earth).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
(async () => {
  const [out, lat, lon, zoom = '8.4', secs = '25'] = process.argv.slice(2);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  const W = 540, H = 960;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2,
    recordVideo: { dir, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
  await page.goto('https://downstrike.app/app/?storm', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window._map && window._map.loaded(), null, { timeout: 60000 });
  // let strikes stream in (the buffer fills from the live websocket)
  await page.waitForTimeout(lat ? 20000 : 30000);
  if (lat) await page.evaluate(([la, lo, z]) => window._map.jumpTo({ center: [lo, la], zoom: z }), [+lat, +lon, +zoom]);
  const t0 = Date.now();
  await page.waitForTimeout(4000); // tiles settle
  const trimStart = (Date.now() - t0) / 1000;
  const startedAt = Date.now();
  await page.waitForTimeout(+secs * 1000);
  const video = page.video();
  await ctx.close(); await browser.close();
  const raw = await video.path();
  const total = (Date.now() - startedAt) / 1000;
  // keep only the last <secs> seconds; burn the credit line in-frame
  const credit = 'Lightning\\: Blitzortung.org (CC BY-SA) · downstrike.app';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', `-${secs}`, '-i', raw,
    '-vf', `scale=1080:1920:flags=lanczos,drawtext=text='${credit}':fontcolor=white:fontsize=30:box=1:boxcolor=black@0.45:boxborderw=12:x=(w-text_w)/2:y=150`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out]);
  console.log(JSON.stringify({ out, seconds: +secs }));
})().catch((e) => { console.error(e); process.exit(1); });
