import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { oauthHeader, postVideo, xLength, LINKISH, scrubber } from '../x.mjs';

test('OAuth 1.0a signature matches X\'s published worked example', () => {
  const h = oauthHeader({
    method: 'POST', url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
    params: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    keys: { apiKey: 'xvz1evFS4wEEPTGEFPHBog', apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE' },
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958,
  });
  assert.match(h, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
});

test('X character counting and the link check', () => {
  assert.equal(xLength('abc'), 3);
  assert.equal(xLength('⚡ hi'), 5); // emoji count 2
  assert.ok(LINKISH.test('see downstrike.app'));
  assert.ok(LINKISH.test('Data: Blitzortung.org volunteers'));
  assert.ok(!LINKISH.test('Data: Blitzortung volunteers. Free live map, link in bio.'));
  assert.ok(!LINKISH.test('3.5 km away, 1,234 strikes'));
});

const file = path.join(os.tmpdir(), 'x-test-clip.mp4');
fs.writeFileSync(file, Buffer.alloc(9 * 1024 * 1024, 1)); // 9 MB: three chunks
const keys = { apiKey: 'K', apiSecret: 'KS', accessToken: 'T', accessSecret: 'TS' };

function fakeX({ states = ['pending', 'in_progress', 'succeeded'], postStatus = 201 } = {}) {
  const calls = [];
  const s = [...states];
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    calls.push({ method: opts.method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: opts.headers.Authorization,
      json: typeof opts.body === 'string' ? JSON.parse(opts.body) : null, form: opts.body instanceof FormData ? opts.body : null });
    if (u.pathname === '/2/media/upload/initialize') return json({ data: { id: '777', media_key: '7_777' } });
    if (/\/append$/.test(u.pathname)) return json({ data: { expires_at: 1 } });
    if (/\/finalize$/.test(u.pathname)) return json({ data: { id: '777', processing_info: { state: s.shift(), check_after_secs: 0 } } });
    if (u.pathname === '/2/media/upload') return json({ data: { processing_info: { state: s.shift() } } });
    if (u.pathname === '/2/tweets') return postStatus < 400 ? json({ data: { id: '999', text: 'x' } }, postStatus) : json({ title: 'Service Unavailable' }, postStatus);
    return json({ title: 'not found' }, 404);
  };
  return { fetchImpl, calls };
}

test('upload in chunks, wait for processing, then post with the media attached', async () => {
  const { fetchImpl, calls } = fakeX();
  const r = await postVideo({ file, text: '⚡ Lightning over Houston', keys, fetchImpl, pollMs: 1 });
  assert.deepEqual(r, { postId: '999', url: 'https://x.com/i/web/status/999' });
  assert.equal(calls[0].path, '/2/media/upload/initialize');
  assert.deepEqual(calls[0].json, { media_type: 'video/mp4', total_bytes: 9 * 1024 * 1024, media_category: 'tweet_video' });
  const appends = calls.filter((c) => c.path.endsWith('/append'));
  assert.deepEqual(appends.map((c) => c.form.get('segment_index')), ['0', '1', '2']);
  assert.equal(calls.find((c) => c.path === '/2/media/upload').query.command, 'STATUS');
  const post = calls.at(-1);
  assert.equal(post.path, '/2/tweets');
  assert.deepEqual(post.json.media, { media_ids: ['777'] });
  assert.ok(calls.every((c) => c.auth.startsWith('OAuth ') && c.auth.includes('oauth_signature=')));
});

test('refuses links, long text and missing keys before uploading anything', async () => {
  const { fetchImpl, calls } = fakeX();
  await assert.rejects(postVideo({ file, text: 'see downstrike.app', keys, fetchImpl }), /link or domain/);
  await assert.rejects(postVideo({ file, text: 'a'.repeat(281), keys, fetchImpl }), /281 of 280/);
  await assert.rejects(postVideo({ file, text: 'ok', keys: { apiKey: 'K' }, fetchImpl }), /X keys missing/);
  assert.equal(calls.length, 0);
});

test('a processing failure is reported; a 5xx on the post itself is "maybe published"', async () => {
  await assert.rejects(postVideo({ file, text: 'hi', keys, fetchImpl: fakeX({ states: ['failed'] }).fetchImpl, pollMs: 1 }), /could not process/);
  await assert.rejects(postVideo({ file, text: 'hi', keys, fetchImpl: fakeX({ postStatus: 503 }).fetchImpl, pollMs: 1 }),
    (e) => e.maybePublished === true && /post: Service Unavailable/.test(e.message));
});

test('keys never survive into text meant for logs or issues', () => {
  const scrub = scrubber({ X_API_KEY: 'abcdefghijk', X_ACCESS_SECRET: 'zyxwvutsrqp' });
  assert.equal(scrub('bad abcdefghijk and zyxwvutsrqp'), 'bad *** and ***');
});
