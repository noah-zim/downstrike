import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publishReel, resolveRedirect } from '../publish.mjs';

const file = path.join(os.tmpdir(), 'promo-test-clip.mp4');
fs.writeFileSync(file, Buffer.alloc(1234, 7));

// A fake Graph API that records every call.
function fakeMeta({ failAudioOnce = false, statuses = ['IN_PROGRESS', 'FINISHED'] } = {}) {
  const calls = [];
  let audioFailed = false;
  const s = [...statuses];
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: new Map() });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const body = opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : null;
    calls.push({ method: opts.method, host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: opts.headers, size: Buffer.isBuffer(opts.body) ? opts.body.length : null });
    if (u.pathname.endsWith('/media') && opts.method === 'POST') {
      if (failAudioOnce && body.audio_name && !audioFailed) {
        audioFailed = true;
        return json({ error: { message: 'Invalid parameter audio_name', code: 100 } }, 400);
      }
      return json({ id: 'C1', uri: 'https://rupload.facebook.com/ig-api-upload/v25.0/C1' });
    }
    if (u.host === 'rupload.facebook.com') return json({ success: true, message: 'Upload successful.' });
    if (u.pathname.endsWith('/C1')) return json({ status_code: s.shift() || 'FINISHED' });
    if (u.pathname.endsWith('/media_publish')) return json({ id: 'M1' });
    if (u.pathname.endsWith('/M1')) return json({ permalink: 'https://www.instagram.com/reel/abc/' });
    return json({ error: { message: 'unexpected ' + u.pathname } }, 404);
  };
  return { fetchImpl, calls };
}

test('facebook mode: resumable upload of the bytes, then publish', async () => {
  const { fetchImpl, calls } = fakeMeta();
  const r = await publishReel({ file, caption: 'hi', thumbOffsetMs: 3033.4, audioName: 'Real thunder', mode: 'facebook',
    userId: '178', token: 'SECRET', pollMs: 1, fetchImpl });
  assert.deepEqual(r, { mediaId: 'M1', permalink: 'https://www.instagram.com/reel/abc/' });
  const create = calls[0];
  assert.equal(create.host, 'graph.facebook.com');
  assert.equal(create.path, '/v25.0/178/media');
  assert.equal(create.body.upload_type, 'resumable');
  assert.equal(create.body.media_type, 'REELS');
  assert.equal(create.body.thumb_offset, '3033');
  assert.equal(create.body.video_url, undefined);
  assert.ok(!('access_token' in create.query), 'token must not be in the URL of a POST');
  const up = calls[1];
  assert.equal(up.host, 'rupload.facebook.com');
  assert.equal(up.headers.Authorization, 'OAuth SECRET');
  assert.equal(up.headers.file_size, '1234');
  assert.equal(up.size, 1234);
  assert.ok(calls.some((c) => c.path.endsWith('/media_publish') && c.body.creation_id === 'C1'));
});

test('instagram mode: public video_url, no upload step', async () => {
  const { fetchImpl, calls } = fakeMeta();
  await publishReel({ file, caption: 'hi', mode: 'instagram', userId: '178', token: 'T', videoUrl: 'https://x/clip.mp4', pollMs: 1, fetchImpl });
  assert.equal(calls[0].host, 'graph.instagram.com');
  assert.equal(calls[0].body.video_url, 'https://x/clip.mp4');
  assert.equal(calls[0].body.upload_type, undefined);
  assert.ok(!calls.some((c) => c.host === 'rupload.facebook.com'));
});

test('retries without audio_name if Meta rejects it', async () => {
  const { fetchImpl, calls } = fakeMeta({ failAudioOnce: true });
  await publishReel({ file, caption: 'hi', audioName: 'Real thunder', mode: 'facebook', userId: '1', token: 'T', pollMs: 1, fetchImpl });
  const creates = calls.filter((c) => c.path.endsWith('/media') && c.method === 'POST');
  assert.equal(creates.length, 2);
  assert.equal(creates[1].body.audio_name, undefined);
});

test('a processing error surfaces with Meta\'s reason', async () => {
  const { fetchImpl } = fakeMeta({ statuses: ['ERROR'] });
  await assert.rejects(
    publishReel({ file, caption: 'hi', mode: 'facebook', userId: '1', token: 'T', pollMs: 1, fetchImpl }),
    /could not process/);
});

test('release asset redirect is followed to the file', async () => {
  const fetchImpl = async () => ({ headers: new Map([['location', 'https://release-assets.githubusercontent.com/x?sig=1']]) });
  assert.equal(await resolveRedirect('https://github.com/a/b/releases/download/t/clip.mp4', fetchImpl), 'https://release-assets.githubusercontent.com/x?sig=1');
});
