// Post text for a clip on X: Claude writes it in the house voice when
// ANTHROPIC_API_KEY is set, a template writes it otherwise. Both use only facts
// measured from the clip, plus any active National Weather Service alerts.
// Hard limits: 280 X characters, and no links or domain names (X charges
// $0.20 for a post with a link, versus $0.015 without).

import { xLength, LINKISH } from './x.mjs';

const UA = 'Downstrike-promo/1.0 (+https://downstrike.app)';

const HOW_IT_WORKS = [
  'Each ring grows at the speed of sound. When one reaches you, you hear the thunder.',
  'Count the seconds from flash to boom and divide by 3. That is roughly how many km away it hit.',
  'Volunteers with backyard antennas hear every bolt and time the crackle to find where it struck.',
  'Fresh strikes glow white, then cool to ember-red over 30 minutes. Storms paint their own trails.',
  'Thunder rolls because sound from different parts of one long bolt reaches you at different times.',
];

const CREDIT = 'Data: Blitzortung volunteers.';
const CTA = 'Free live map, link in bio.';

const VOICE = `You write posts on X for Downstrike, a free live lightning map (iPhone app and website) made by a dad and his kid, Leo and Noah Zimmerman. Each post carries a short video of a real storm on the map.
House voice: short, precise, curious, kid-friendly (a smart middle schooler can read it), real physics kept intact. Calm wonder, never hype.
Rules:
- At most 250 characters in total, hashtags included.
- First line is the hook: name the place and the strike count.
- Use only the numbers and facts provided. Never invent statistics, damage, injuries or forecasts.
- One "how it works" idea, from the options provided or close to them.
- Include these two lines exactly: "${CREDIT}" and "${CTA}"
- No links, no web addresses, no domain names of any kind (no ".org", ".com", ".app").
- No em dashes. At most one ⚡ and no other emoji. No ALL CAPS. No clickbait words like insane or crazy.
- If safety is "high", the first line tells people near the place to follow official National Weather Service warnings, and the tone is calm and serious.
- End with the suggested hashtags (at most 3).
- Output only the post text.`;

const CONUS = (lat, lon) => lat > 18 && lat < 50 && lon > -125 && lon < -64;

export async function nwsAlerts(lat, lon, { timeoutMs = 8000 } = {}) {
  if (!CONUS(lat, lon)) return [];
  try {
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const j = await res.json();
    const seen = new Set();
    return (j.features || []).map((f) => f.properties).filter((p) => {
      if (!p || seen.has(p.event)) return false;
      seen.add(p.event);
      return true;
    }).map((p) => ({ event: p.event, headline: p.headline }));
  } catch (e) {
    return [];
  }
}

export function safetyLevel(alerts) {
  const events = alerts.map((a) => a.event).join(' | ');
  if (/Tornado|Flash Flood|Hurricane|Extreme Wind|Tsunami|Storm Surge/i.test(events)) return 'high';
  if (/Severe Thunderstorm/i.test(events)) return 'elevated';
  return 'none';
}

const plain = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '');

export function hashtags(meta) {
  const tags = ['lightning'];
  const city = meta.place.city;
  if (city && city.cc === 'US' && /^[A-Z]{2}$/.test(city.region) && city.region !== 'DC') {
    tags.push(`${city.region.toLowerCase()}wx`); // the weather community's state tags: #txwx, #flwx
  }
  if (city) tags.push(`${plain(city.name)}Weather`);
  else tags.push('thunderstorm');
  return [...new Set(tags)].slice(0, 3).map((t) => '#' + t).join(' ');
}

function nuggetsFor(date) {
  const k = Math.floor(date.getTime() / 3600e3); // rotates every hour
  return [HOW_IT_WORKS[k % HOW_IT_WORKS.length], HOW_IT_WORKS[(k + 2) % HOW_IT_WORKS.length]];
}

export function templateCaption(meta) {
  const n = meta.stats.strikes10.toLocaleString('en-US');
  const head = [];
  if (meta.safety === 'high' && meta.place.city) {
    head.push(`If you are near ${meta.place.city.name}, follow your National Weather Service warnings.`);
  }
  head.push(`⚡ ${meta.place.title}: ${n} strikes in 10 minutes.`);
  const tags = hashtags(meta);
  for (const nugget of [...nuggetsFor(new Date(meta.filmedAt)), null]) {
    const body = [...head, nugget, `${CREDIT} ${CTA}`].filter(Boolean).join('\n\n');
    const text = `${body}\n\n${tags}`;
    if (xLength(text) <= 280) return text;
  }
  return `${head.join('\n')}\n${CREDIT} ${CTA}`.slice(0, 270);
}

// Tidy whatever the model returns, then hold it to the hard limits.
export function cleanCaption(text, meta) {
  let t = String(text || '').trim()
    .replace(/\s*—\s*/g, ', ')
    .replace(/^["']|["']$/g, '');
  if (!/Blitzortung/i.test(t)) t = t.replace(/\n\n(#)/, `\n${CREDIT}\n\n$1`);
  if (!/#\w/.test(t)) t += '\n\n' + hashtags(meta);
  return t;
}

export function captionProblem(text) {
  if (xLength(text) > 280) return `too long for X (${xLength(text)} of 280)`;
  if (LINKISH.test(text)) return 'contains a link or domain name';
  if (xLength(text) < 40) return 'too short';
  return null;
}

export async function writeCaption(meta, cfg, { apiKey = process.env.ANTHROPIC_API_KEY, log = () => {} } = {}) {
  if (!apiKey) return { caption: templateCaption(meta), source: 'template' };
  const facts = {
    place_title: meta.place.title,
    place_detail: meta.place.sub,
    local_time: meta.when,
    strikes_last_10_min: meta.stats.strikes10,
    strikes_per_minute_now: meta.stats.perMin,
    active_nws_alerts: meta.alerts.map((a) => a.event),
    safety: meta.safety,
    how_it_works_options: nuggetsFor(new Date(meta.filmedAt)),
    suggested_hashtags: hashtags(meta),
  };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.captionModel,
        max_tokens: 400,
        system: VOICE,
        messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await res.json();
    if (!res.ok) throw new Error((j.error && j.error.message) || `HTTP ${res.status}`);
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const caption = cleanCaption(text, meta);
    const problem = captionProblem(caption);
    if (problem) throw new Error(problem);
    return { caption, source: 'claude' };
  } catch (e) {
    log(`caption: Claude's draft was unusable (${e.message}); using the template`);
    return { caption: templateCaption(meta), source: 'template' };
  }
}
