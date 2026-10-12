// The branded frame laid over the live map while filming. Same palette as the
// app (app/styles.css); sized for a 540×960 CSS-px viewport rendered at 2×.
// Everything that matters sits in the top third, inside the Reels/Shorts/TikTok
// safe zone: below the platform header, left of the button rail, and well above
// the caption block that covers the bottom quarter of the screen.

const BOLT = '<svg viewBox="0 0 20 20" fill="#ffd54f"><path d="M11.2 2L4.6 11h4.2l-1.4 7L14.4 8.6h-4.1L11.2 2z"/></svg>';
const SPEAKER = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M13.5 7a4 4 0 0 1 0 6"/><path d="M15.8 4.8a7 7 0 0 1 0 10.4"/></svg>';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const OVERLAY_CSS = `
#promo { position: fixed; inset: 0; pointer-events: none; z-index: 50;
  font-family: Inter, -apple-system, system-ui, sans-serif; color: #e8eaf0;
  font-feature-settings: "tnum" 1, "cv11" 1; -webkit-font-smoothing: antialiased; }
#promo .scrim-top { position: absolute; left: 0; right: 0; top: 0; height: 300px;
  background: linear-gradient(rgba(10,12,16,0.94), rgba(10,12,16,0.7) 60%, rgba(10,12,16,0)); }
#promo .scrim-bot { position: absolute; left: 0; right: 0; bottom: 0; height: 120px;
  background: linear-gradient(rgba(10,12,16,0), rgba(10,12,16,0.85)); }
#promo .vignette { position: absolute; inset: 0;
  background: radial-gradient(ellipse 90% 70% at 50% 50%, rgba(10,12,16,0) 62%, rgba(10,12,16,0.5)); }
#promo .head { position: absolute; top: 92px; left: 28px; right: 88px; }
#promo .row { display: flex; align-items: center; gap: 10px; }
#promo .brand { display: flex; align-items: center; gap: 7px; }
#promo .brand svg { width: 17px; height: 17px; filter: drop-shadow(0 0 7px rgba(255,171,0,0.6)); }
#promo .brand b { font-size: 15.5px; font-weight: 720; letter-spacing: -0.01em; }
#promo .brand span { font-size: 12.5px; color: #8a93a5; }
#promo .pill { padding: 3px 8px; border-radius: 999px; border: 1px solid rgba(255,213,79,0.34);
  background: rgba(255,213,79,0.08); color: #ffd54f; font-size: 9.5px; font-weight: 680;
  letter-spacing: 0.09em; text-transform: uppercase; }
#promo h1 { margin: 18px 0 0; font-size: 31px; line-height: 1.1; font-weight: 720; letter-spacing: -0.022em; }
#promo .sub { margin-top: 6px; font-size: 14px; color: #8a93a5; }
#promo .stat { margin-top: 14px; display: flex; align-items: baseline; gap: 8px; }
#promo .stat b { font-size: 26px; font-weight: 700; color: #ffd54f; letter-spacing: -0.01em;
  text-shadow: 0 0 18px rgba(255,171,0,0.35); }
#promo .stat span { font-size: 14.5px; color: #e8eaf0; }
#promo .hint { margin-top: 9px; display: flex; align-items: center; gap: 7px;
  font-size: 12.5px; color: rgba(180,210,255,0.85); }
#promo .hint svg { width: 15px; height: 15px; }
#promo .credits { position: absolute; left: 28px; right: 28px; bottom: 30px;
  font-size: 9.5px; color: rgba(138,147,165,0.9); }
`;

// d: { title, sub, strikes10, when }
export function overlayHtml(d) {
  return `
<div class="vignette"></div><div class="scrim-top"></div><div class="scrim-bot"></div>
<div class="head">
  <div class="row">
    <div class="brand">${BOLT}<b>Downstrike</b><span>downstrike.app</span></div>
    <div class="pill">Real strikes</div>
  </div>
  <h1>${esc(d.title)}</h1>
  <div class="sub">${esc(d.sub)} · ${esc(d.when)}</div>
  <div class="stat"><b>${Number(d.strikes10).toLocaleString('en-US')}</b><span>strikes in the last 10 minutes</span></div>
  <div class="hint">${SPEAKER}<span>Each ring moves at the speed of sound. Sound on.</span></div>
</div>
<div class="credits">Lightning: Blitzortung.org volunteers · Map © CARTO © OpenStreetMap · Free on iPhone and the web</div>`;
}
