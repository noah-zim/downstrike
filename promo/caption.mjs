// Caption for a clip: Claude writes it in the house voice when ANTHROPIC_API_KEY
// is set, a template writes it otherwise. Both use only facts measured from
// the clip, plus any active National Weather Service alerts for the spot.

const UA = 'Downstrike-promo/1.0 (+https://downstrike.app)';

const HOW_IT_WORKS = [
  'Every ring grows at the speed of sound, 343 meters per second. When a ring reaches you, that is when you hear the thunder.',
  'Count the seconds from flash to boom and divide by 3. That is about how many kilometers away it struck.',
  'Nobody films these bolts. Volunteers with backyard antennas hear each one, and the timing of the radio crackle finds it, like GPS in reverse.',
  'Fresh strikes glow white, then cool to amber and ember-red over 30 minutes, so a storm paints its own trail.',
  'Thunder rolls because sound from different parts of one long bolt reaches you at different times.',
];

const VOICE = `You write Instagram Reel captions for Downstrike, a free live lightning map (iPhone app and website) made by a dad and his kid, Leo and Noah Zimmerman.
House voice: short, precise, curious, kid-friendly (a smart middle schooler can read it), real physics kept intact. Calm wonder, never hype.
Rules:
- 3 to 5 short lines, then one line of hashtags. Under 700 characters in total.
- Line 1 is the hook and must stand on its own, because it is all most people see. Name the place.
- Use only the numbers and facts provided. Never invent statistics, damage, injuries, or forecasts.
- Include exactly one "how it works" idea, from the options provided or close to them.
- Credit the data with this exact line: "Lightning data: Blitzortung.org volunteers."
- End the body with this exact line: "Watch any storm live, free: link in bio."
- No em dashes. No emoji except at most one ⚡. No ALL CAPS words. No clickbait words like insane or crazy.
- If safety is "high", open with one calm line telling people near the place to follow official National Weather Service warnings, and drop the playful tone.
- Use the suggested hashtags; you may swap at most two for better ones.
- Output only the caption text, nothing else.`;

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

export function hashtags(meta, cfg) {
  const tags = [...cfg.hashtags];
  const city = meta.place.city;
  if (city) tags.push(`${plain(city.name)}Weather`);
  if (city && city.cc === 'US' && /^[A-Z]{2}$/.test(city.region) && city.region !== 'DC') {
    tags.push(`${city.region.toLowerCase()}wx`); // the weather community's state tags: #txwx, #flwx
  }
  return [...new Set(tags)].slice(0, 8).map((t) => '#' + t).join(' ');
}

function nuggetsFor(date) {
  const k = Math.floor(date.getTime() / 3600e3); // rotates every hour
  return [HOW_IT_WORKS[k % HOW_IT_WORKS.length], HOW_IT_WORKS[(k + 2) % HOW_IT_WORKS.length]];
}

export function templateCaption(meta, cfg) {
  const [nugget] = nuggetsFor(new Date(meta.filmedAt));
  const lines = [];
  if (meta.safety === 'high' && meta.place.city) {
    lines.push(`If you are near ${meta.place.city.name}, follow your National Weather Service warnings.`);
  }
  const n = meta.stats.strikes10.toLocaleString('en-US');
  lines.push(`⚡ ${meta.place.title}: ${n} strikes in 10 minutes, ${meta.when}.`);
  lines.push(nugget);
  lines.push('Lightning data: Blitzortung.org volunteers.');
  lines.push('Watch any storm live, free: link in bio.');
  return lines.join('\n') + '\n\n' + hashtags(meta, cfg);
}

// Tidy whatever the model returns so house rules hold even if it slips.
export function cleanCaption(text, meta, cfg) {
  let t = String(text || '').trim()
    .replace(/\s*—\s*/g, ', ')
    .replace(/^["']|["']$/g, '');
  if (!/Blitzortung/i.test(t)) t = t.replace(/\n\n(#)/, '\nLightning data: Blitzortung.org volunteers.\n\n$1');
  if (!/#\w/.test(t)) t += '\n\n' + hashtags(meta, cfg);
  return t;
}

export async function writeCaption(meta, cfg, { apiKey = process.env.ANTHROPIC_API_KEY, log = () => {} } = {}) {
  if (!apiKey) return { caption: templateCaption(meta, cfg), source: 'template' };
  const facts = {
    place_title: meta.place.title,
    place_detail: meta.place.sub,
    local_time: meta.when,
    strikes_last_10_min: meta.stats.strikes10,
    strikes_per_minute_now: meta.stats.perMin,
    active_nws_alerts: meta.alerts.map((a) => a.event),
    safety: meta.safety,
    how_it_works_options: nuggetsFor(new Date(meta.filmedAt)),
    suggested_hashtags: hashtags(meta, cfg),
  };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.captionModel,
        max_tokens: 500,
        system: VOICE,
        messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await res.json();
    if (!res.ok) throw new Error((j.error && j.error.message) || `HTTP ${res.status}`);
    const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const caption = cleanCaption(text, meta, cfg);
    if (caption.length < 40 || caption.length > 2000) throw new Error(`odd caption length ${caption.length}`);
    return { caption, source: 'claude' };
  } catch (e) {
    log(`caption: Claude failed (${e.message}); using the template`);
    return { caption: templateCaption(meta, cfg), source: 'template' };
  }
}
