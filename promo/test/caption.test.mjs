import test from 'node:test';
import assert from 'node:assert/strict';
import { templateCaption, cleanCaption, hashtags, safetyLevel, captionProblem } from '../caption.mjs';
import { xLength } from '../x.mjs';

const meta = {
  filmedAt: '2026-10-08T23:57:51Z', when: 'Oct 8, 6:57 PM CDT', safety: 'none', alerts: [],
  place: { title: 'Lightning over São Paulo', sub: 'São Paulo, Brazil', city: { name: 'São Paulo', region: 'Brazil', cc: 'BR' } },
  stats: { strikes10: 1234, perMin: 80 },
};
const us = (name, region, extra = {}) => ({ ...meta, ...extra, place: { title: `Lightning over ${name}`, sub: `${name}, ${region}`, city: { name, region, cc: 'US' } } });

test('template post fits X and follows the house rules', () => {
  for (let h = 0; h < 10; h++) {
    for (const m of [meta, us('Fort Myers', 'FL'), us('Oklahoma City', 'OK', { safety: 'high' })]) {
      const c = templateCaption({ ...m, filmedAt: new Date(Date.parse(meta.filmedAt) + h * 3600e3).toISOString() });
      assert.equal(captionProblem(c), null, c);
      assert.ok(xLength(c) <= 280);
      assert.match(c, /Blitzortung volunteers/);
      assert.match(c, /link in bio/);
      assert.ok(!c.includes('—'));
    }
  }
  assert.match(templateCaption(meta), /^⚡ Lightning over São Paulo: 1,234 strikes in 10 minutes\./);
});

test('hashtags: at most three, with the state weather tag', () => {
  assert.equal(hashtags(us('Fort Myers', 'FL')), '#lightning #flwx #FortMyersWeather');
  assert.equal(hashtags(meta), '#lightning #SaoPauloWeather');
});

test('safety first when people may be in danger', () => {
  assert.equal(safetyLevel([{ event: 'Tornado Warning' }]), 'high');
  assert.equal(safetyLevel([{ event: 'Severe Thunderstorm Warning' }]), 'elevated');
  assert.equal(safetyLevel([{ event: 'Special Weather Statement' }]), 'none');
  const c = templateCaption(us('Tulsa', 'OK', { safety: 'high' }));
  assert.match(c.split('\n')[0], /National Weather Service/);
});

test('model drafts are tidied and held to the limits', () => {
  const c = cleanCaption('"Storm over the city — wow.\nFree live map, link in bio."', meta);
  assert.ok(!c.includes('—'));
  assert.ok(!c.startsWith('"'));
  assert.match(c, /#lightning/);
  assert.match(captionProblem('see Blitzortung.org for more ' + 'x'.repeat(30)), /link/);
  assert.match(captionProblem('x'.repeat(300)), /too long/);
});
