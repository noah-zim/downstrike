// Posts a Reel through Meta's official Instagram API. Two ways in, picked by IG_API:
//
//   facebook  (default) Instagram professional account linked to a Facebook Page,
//             "Instagram API with Facebook Login". The video bytes are uploaded
//             straight from the runner (resumable upload), so nothing has to be
//             hosted, and a Page or system-user token can be made non-expiring.
//   instagram "Instagram API with Instagram Login" (no Facebook Page). Meta only
//             accepts a public video_url here, so we hand it the clip's GitHub
//             release asset. Tokens last 60 days; token.mjs refreshes them.
//
// Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing
// The token is only ever sent in request bodies or headers, never logged.

import fs from 'node:fs';

const HOSTS = { facebook: 'https://graph.facebook.com', instagram: 'https://graph.instagram.com' };

export class GraphError extends Error {
  constructor(where, body, status) {
    const e = (body && body.error) || {};
    super(`${where}: ${e.message || `HTTP ${status}`}${e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})` : ''}`);
    this.code = e.code;
    this.subcode = e.error_subcode;
  }
}

async function graph(fetchImpl, method, url, params, where) {
  const opts = { method };
  if (method === 'GET') url += (url.includes('?') ? '&' : '?') + new URLSearchParams(params);
  else {
    opts.body = new URLSearchParams(params);
    opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  }
  const res = await fetchImpl(url, opts);
  let body = null;
  try { body = await res.json(); } catch (e) {}
  if (!res.ok || (body && body.error)) throw new GraphError(where, body, res.status);
  return body;
}

// GitHub serves release assets through a redirect to a signed URL; Meta's
// fetcher should get the final file URL, not a page github.com's robots.txt covers.
export async function resolveRedirect(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual' });
  const loc = res.headers.get('location');
  return loc || url;
}

export async function publishReel({
  file, caption, thumbOffsetMs, audioName,
  mode = 'facebook', userId, token, version = 'v25.0', videoUrl,
  pollMs = 15000, maxPolls = 40, fetchImpl = fetch, log = () => {},
}) {
  if (!userId || !token) throw new Error('IG_USER_ID and IG_ACCESS_TOKEN are required');
  const host = HOSTS[mode];
  if (!host) throw new Error(`IG_API must be "facebook" or "instagram", not "${mode}"`);
  const base = `${host}/${version}`;

  const params = { media_type: 'REELS', caption, share_to_feed: 'true', access_token: token };
  if (thumbOffsetMs != null) params.thumb_offset = String(Math.max(0, Math.round(thumbOffsetMs)));
  if (audioName) params.audio_name = audioName;
  if (mode === 'facebook') params.upload_type = 'resumable';
  else {
    if (!videoUrl) throw new Error('instagram mode needs a public video URL');
    params.video_url = videoUrl;
  }

  // 1. container
  let container;
  try {
    container = await graph(fetchImpl, 'POST', `${base}/${userId}/media`, params, 'create container');
  } catch (e) {
    if (!audioName || !/audio/i.test(e.message)) throw e;
    log('container: retrying without audio_name');
    delete params.audio_name;
    container = await graph(fetchImpl, 'POST', `${base}/${userId}/media`, params, 'create container');
  }
  log(`container ${container.id}`);

  // 2. bytes (facebook mode): one POST of the whole file to the URI Meta returned
  if (mode === 'facebook') {
    if (!container.uri) throw new Error('create container: no upload uri returned');
    const bytes = fs.readFileSync(file);
    const res = await fetchImpl(container.uri, {
      method: 'POST',
      headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(bytes.length) },
      body: bytes,
    });
    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok || (body && body.error) || (body && body.success === false)) throw new GraphError('upload', body, res.status);
    log(`uploaded ${(bytes.length / 1e6).toFixed(1)} MB`);
  }

  // 3. wait for Meta to process the video
  let status = 'IN_PROGRESS';
  for (let i = 0; i < maxPolls && status === 'IN_PROGRESS'; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    const s = await graph(fetchImpl, 'GET', `${base}/${container.id}`, { fields: 'status_code,status', access_token: token }, 'status');
    status = s.status_code;
    log(`processing: ${status}${s.status && status !== 'IN_PROGRESS' ? ` (${s.status})` : ''}`);
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Meta could not process the video: ${s.status || status}`);
  }
  if (status !== 'FINISHED') throw new Error(`video still ${status} after ${(maxPolls * pollMs) / 60000} min`);

  // 4. publish. If this call errors we can't be sure Meta didn't publish
  // (a timeout after the fact), so the caller must not blindly retry.
  let pub;
  try {
    pub = await graph(fetchImpl, 'POST', `${base}/${userId}/media_publish`, { creation_id: container.id, access_token: token }, 'publish');
  } catch (e) {
    e.maybePublished = true;
    e.containerId = container.id;
    throw e;
  }
  let permalink = null;
  try {
    permalink = (await graph(fetchImpl, 'GET', `${base}/${pub.id}`, { fields: 'permalink', access_token: token }, 'permalink')).permalink;
  } catch (e) { log(`permalink lookup failed: ${e.message}`); }
  return { mediaId: pub.id, permalink };
}

export async function checkAccount({ mode = 'facebook', userId, token, version = 'v25.0', fetchImpl = fetch }) {
  const host = HOSTS[mode];
  return graph(fetchImpl, 'GET', `${host}/${version}/${userId}`, { fields: 'username', access_token: token }, 'account check');
}
