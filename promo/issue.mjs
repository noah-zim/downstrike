// The approval issue is the whole review UI: the clip, the caption, and the
// commands. Its body also carries the machine-readable bits between markers,
// so the caption can be edited right in the issue on a phone.

const CAP_START = '<!-- caption:start -->';
const CAP_END = '<!-- caption:end -->';
const META_RE = /<!-- promo-meta (\{[^\n]*\}) -->\s*$/;
export const TAG_RE = /^clip-\d{8}T\d{4}-[a-z0-9-]{1,40}$/;

const count = (s, sub) => s.split(sub).length - 1;
// visible text: nothing that can open an HTML comment or a code fence
const md = (s) => String(s).replace(/[<>`]/g, '');
// a caption may say anything, but must not be able to close its own block
const tidyCaption = (s) => String(s).replace(/<!--|-->/g, '').replace(/```/g, "'''").trim();

export function issueTitle(meta) {
  return `⚡ Post? ${md(meta.place.title)} · ${meta.stats.strikes10.toLocaleString('en-US')} strikes · ${md(meta.when)}`;
}

export function buildIssueBody({ meta, caption, videoUrl, coverUrl, releaseUrl, owner, note = '' }) {
  const warn = meta.safety === 'high'
    ? `> [!WARNING]\n> Active NWS alerts here: **${md(meta.alerts.map((a) => a.event).join(', '))}**. People may be in danger. Post with a safety-first caption, or \`/skip\`.\n\n`
    : meta.safety === 'elevated'
      ? `> [!NOTE]\n> Active NWS alerts here: ${md(meta.alerts.map((a) => a.event).join(', '))}.\n\n`
      : '';
  if (!TAG_RE.test(meta.tag)) throw new Error(`bad clip tag ${meta.tag}`);
  const machine = { tag: meta.tag, filmedAt: meta.filmedAt, thumbOffsetMs: meta.thumbOffsetMs };
  return [
    `@${owner} a new clip is ready. ${md(meta.place.sub)}, filmed ${md(meta.when)}${meta.captionSource === 'claude' ? ', text by Claude' : ''}.`,
    '',
    ...(note ? [`**Why it's waiting for you:** ${md(note).replace(/\n/g, ' ')}`, ''] : []),
    warn + `[![cover](${coverUrl})](${videoUrl})`,
    '',
    `▶️ **[Watch the clip](${videoUrl})** (${meta.seconds} s, sound on) · [release](${releaseUrl}) · [open this storm in Downstrike](${meta.shareUrl})`,
    '',
    '**Post text** (edit it right here, or comment `/caption your new text`; 280 characters, no links):',
    '',
    CAP_START,
    '```text',
    tidyCaption(caption),
    '```',
    CAP_END,
    '',
    '**Reply with**',
    '- `/post` to post it on X now',
    '- `/skip` to throw it away',
    '- `/caption …` to replace the post text',
    '',
    `Clips go stale: \`/post\` refuses after a few hours unless you write \`/post anyway\`.`,
    '',
    `<!-- promo-meta ${JSON.stringify(machine).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')} -->`,
  ].join('\n');
}

export function parseIssueBody(body) {
  body = String(body || '').replace(/\r\n/g, '\n'); // GitHub's web editor saves CRLF
  const m = META_RE.exec(body);
  if (!m || count(body, '<!-- promo-meta ') !== 1) throw new Error('not a promo clip issue (needs exactly one promo-meta block, at the end)');
  if (count(body, CAP_START) !== 1 || count(body, CAP_END) !== 1) throw new Error('the issue must have exactly one caption block');
  const meta = JSON.parse(m[1]);
  if (!TAG_RE.test(meta.tag || '')) throw new Error('promo-meta has a bad clip tag');
  const a = body.indexOf(CAP_START), b = body.indexOf(CAP_END);
  if (a < 0 || b < a) throw new Error('caption block missing from the issue');
  const caption = body.slice(a + CAP_START.length, b)
    .replace(/^\s*```[a-z]*\s*\n/, '').replace(/\n\s*```\s*$/, '').trim();
  return { meta, caption };
}

export function replaceCaption(body, caption) {
  const a = body.indexOf(CAP_START), b = body.indexOf(CAP_END);
  if (a < 0 || b < a) throw new Error('caption block missing from the issue');
  return body.slice(0, a + CAP_START.length) + '\n```text\n' + tidyCaption(caption) + '\n```\n' + body.slice(b);
}

// "/post", "/post anyway", "/skip", "/caption <text…>" (text may span lines)
export function parseCommand(comment) {
  const text = String(comment || '').trim();
  const m = /^\/(post|skip|caption)\b[ \t]*([\s\S]*)$/i.exec(text);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const rest = m[2].trim();
  if (cmd === 'post') return { cmd, anyway: /^anyway\b/i.test(rest) };
  if (cmd === 'caption') return rest ? { cmd, text: rest } : null;
  return { cmd };
}
