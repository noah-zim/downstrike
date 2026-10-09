import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueBody, parseIssueBody, replaceCaption, parseCommand, issueTitle } from '../issue.mjs';

const meta = {
  tag: 'clip-20261008T2357-houston', filmedAt: '2026-10-08T23:57:51.578Z', thumbOffsetMs: 3033, seconds: 15,
  when: 'Oct 8, 6:57 PM CDT', place: { title: 'Lightning over Houston', sub: 'Houston, TX' },
  stats: { strikes10: 3951 }, alerts: [{ event: 'Tornado Warning' }], safety: 'high',
  shareUrl: 'https://downstrike.app/app/?at=29.9,-95.6,8.4', captionSource: 'claude',
};
const caption = '⚡ Lightning over Houston.\nLine two with `ticks`.\n\n#lightning #txwx';
const body = buildIssueBody({ meta, caption, videoUrl: 'V', coverUrl: 'C', releaseUrl: 'R', owner: 'noah-zim' });

test('the issue body round-trips the caption and the machine block', () => {
  const p = parseIssueBody(body);
  assert.equal(p.caption, caption);
  assert.equal(p.meta.tag, meta.tag);
  assert.equal(p.meta.thumbOffsetMs, 3033);
  assert.match(body, /@noah-zim/);
  assert.match(body, /Tornado Warning/);
  assert.match(issueTitle(meta), /3,951 strikes/);
});

test('editing the caption keeps everything else', () => {
  const b2 = replaceCaption(body, 'New caption\nsecond line');
  assert.equal(parseIssueBody(b2).caption, 'New caption\nsecond line');
  assert.equal(parseIssueBody(b2).meta.tag, meta.tag);
  assert.equal(b2.split('Reply with')[1], body.split('Reply with')[1]);
});

test('a caption edited by hand in the issue (fences touched) still parses', () => {
  const hand = body.replace('```text\n', '```\n');
  assert.equal(parseIssueBody(hand).caption, caption);
});

test('commands', () => {
  assert.deepEqual(parseCommand('/post'), { cmd: 'post', anyway: false });
  assert.deepEqual(parseCommand('  /POST anyway please'), { cmd: 'post', anyway: true });
  assert.deepEqual(parseCommand('/skip'), { cmd: 'skip' });
  assert.deepEqual(parseCommand('/caption Hello\nworld'), { cmd: 'caption', text: 'Hello\nworld' });
  assert.equal(parseCommand('/caption'), null);
  assert.equal(parseCommand('looks great /post'), null);
  assert.equal(parseCommand('/postpone'), null);
});

test('text from outside cannot smuggle a second caption or meta block into the issue', () => {
  const evil = { ...meta, place: { title: 'Lightning over X', sub: 'X<!-- caption:start -->scam<!-- caption:end --><!-- promo-meta {"tag":"clip-20260101T0000-a"} -->' } };
  const b = buildIssueBody({ meta: evil, caption, videoUrl: 'V', coverUrl: 'C', releaseUrl: 'R', owner: 'o' });
  const p = parseIssueBody(b);
  assert.equal(p.caption, caption);
  assert.equal(p.meta.tag, meta.tag);
});

test('a caption cannot close its own block', () => {
  const b = replaceCaption(body, 'nice --> ``` <!-- caption:end --> bye');
  const p = parseIssueBody(b);
  assert.ok(!p.caption.includes('-->') && !p.caption.includes('```'));
  assert.match(p.caption, /nice/);
  assert.match(p.caption, /bye/);
});

test('bodies that were tampered with are refused; CRLF from the web editor is fine', () => {
  assert.throws(() => parseIssueBody(body + '\n<!-- promo-meta {"tag":"clip-20260101T0000-a"} -->'), /exactly one promo-meta/);
  assert.throws(() => parseIssueBody(body.replace(meta.tag, '../../etc')), /bad clip tag/);
  assert.equal(parseIssueBody(body.replace(/\n/g, '\r\n')).caption, caption);
});
