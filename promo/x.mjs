// Posts a video to X with the official v2 API, signed OAuth 1.0a user context
// (the four keys from the X developer console: API key + secret, access token + secret).
// Docs: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
// Keys are only ever put in the Authorization header, never logged.

import crypto from 'node:crypto';
import fs from 'node:fs';

const API = 'https://api.x.com';
const CHUNK = 4 * 1024 * 1024; // X wants segments of 5 MB or less

// RFC 3986 encoding, as OAuth 1.0a requires
export const pct = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Authorization header for one request. Only query-string and form-encoded
// parameters are signed; JSON and multipart bodies are not part of the signature.
export function oauthHeader({ method, url, params = {}, keys, nonce, timestamp }) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: '1.0',
  };
  const all = [];
  for (const [k, v] of u.searchParams) all.push([pct(k), pct(v)]);
  for (const [k, v] of Object.entries(params)) all.push([pct(k), pct(v)]);
  for (const [k, v] of Object.entries(oauth)) all.push([pct(k), pct(v)]);
  all.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const paramStr = all.map(([k, v]) => `${k}=${v}`).join('&');
  const base = `${method.toUpperCase()}&${pct(u.origin + u.pathname)}&${pct(paramStr)}`;
  const signingKey = `${pct(keys.apiSecret)}&${pct(keys.accessSecret)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map((k) => `${pct(k)}="${pct(oauth[k])}"`).join(', ');
}

export class XError extends Error {
  constructor(where, status, body) {
    const e = body || {};
    const detail = e.detail || (e.errors && e.errors.map((x) => x.message || x.detail).join('; ')) || e.title || `HTTP ${status}`;
    super(`${where}: ${detail} (HTTP ${status})`);
    this.status = status;
  }
}

async function call(fetchImpl, keys, method, url, { json, form } = {}, where) {
  const headers = { Authorization: oauthHeader({ method, url, keys }) };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetchImpl(url, { method, headers, body });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new XError(where, res.status, data);
  return data || {};
}

// X counts most characters as 1 and others (emoji, CJK) as 2; a post holds 280.
export function xLength(text) {
  let n = 0;
  for (const ch of String(text).normalize('NFC')) {
    const c = ch.codePointAt(0);
    const light = c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    if (c === 0xfe0f || c === 0x200d) continue; // emoji joiners/selectors ride along
    n += light ? 1 : 2;
  }
  return n;
}

// Anything X would turn into a link (and charge $0.20 a post for).
export const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|app|io|gov|edu|co|ly|me|ai|dev|tv|us|uk)\b)/i;

export async function postVideo({ file, text, keys, fetchImpl = fetch, pollMs = 3000, maxPolls = 100, log = () => {} }) {
  for (const k of ['apiKey', 'apiSecret', 'accessToken', 'accessSecret']) {
    if (!keys || !keys[k]) throw new Error('X keys missing: set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_SECRET');
  }
  if (xLength(text) > 280) throw new Error(`post text is ${xLength(text)} of 280 characters`);
  if (LINKISH.test(text)) throw new Error('post text contains a link or domain name, which X charges $0.20 for; remove it');

  const bytes = fs.readFileSync(file);
  const init = await call(fetchImpl, keys, 'POST', `${API}/2/media/upload/initialize`,
    { json: { media_type: 'video/mp4', total_bytes: bytes.length, media_category: 'tweet_video' } }, 'upload init');
  const id = init.data && init.data.id;
  if (!id) throw new Error('upload init: no media id returned');
  log(`media ${id}: uploading ${(bytes.length / 1e6).toFixed(1)} MB`);

  for (let i = 0, off = 0; off < bytes.length; i++, off += CHUNK) {
    const form = new FormData();
    form.append('segment_index', String(i));
    form.append('media', new Blob([bytes.subarray(off, off + CHUNK)], { type: 'application/octet-stream' }), 'chunk');
    await call(fetchImpl, keys, 'POST', `${API}/2/media/upload/${id}/append`, { form }, `upload chunk ${i}`);
  }

  const fin = await call(fetchImpl, keys, 'POST', `${API}/2/media/upload/${id}/finalize`, {}, 'upload finalize');
  let info = fin.data && fin.data.processing_info;
  for (let n = 0; info && info.state !== 'succeeded'; n++) {
    if (info.state === 'failed') throw new Error(`X could not process the video: ${JSON.stringify(info.error || info)}`);
    if (n >= maxPolls) throw new Error('X is still processing the video; giving up');
    await new Promise((r) => setTimeout(r, Math.max(pollMs, (info.check_after_secs || 0) * 1000)));
    const st = await call(fetchImpl, keys, 'GET', `${API}/2/media/upload?command=STATUS&media_id=${id}`, {}, 'upload status');
    info = (st.data && st.data.processing_info) || st.processing_info;
    log(`media ${id}: ${info ? info.state : 'ready'}`);
  }

  let post;
  try {
    post = await call(fetchImpl, keys, 'POST', `${API}/2/tweets`, { json: { text, media: { media_ids: [String(id)] } } }, 'post');
  } catch (e) {
    e.maybePublished = e.status === undefined || e.status >= 500; // a timeout or 5xx may still have posted
    throw e;
  }
  const postId = post.data && post.data.id;
  return { postId, url: postId ? `https://x.com/i/web/status/${postId}` : null };
}

export function keysFromEnv(env = process.env) {
  return { apiKey: env.X_API_KEY, apiSecret: env.X_API_SECRET, accessToken: env.X_ACCESS_TOKEN, accessSecret: env.X_ACCESS_SECRET };
}

// Never let a key reach a log line or a public issue.
export function scrubber(env = process.env) {
  const secrets = [env.X_API_KEY, env.X_API_SECRET, env.X_ACCESS_TOKEN, env.X_ACCESS_SECRET].filter((s) => s && s.length > 6);
  return (text) => secrets.reduce((t, s) => t.split(s).join('***'), String(text));
}
