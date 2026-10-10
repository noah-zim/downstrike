// Render tools/social/share-card.html to assets/share-card.png (1200×630 link preview).
// usage: node tools/social/render_share_card.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const src = path.join(__dirname, 'share-card.html');
  const out = path.join(__dirname, '..', '..', 'assets', 'share-card.png');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto('file://' + src);
  await page.screenshot({ path: out });
  await browser.close();
  console.log(out);
})().catch((e) => { console.error(e); process.exit(1); });
