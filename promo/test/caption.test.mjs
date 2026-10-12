import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { templateCaption, cleanCaption, hashtags, safetyLevel } from '../caption.mjs';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const meta = {
  filmedAt: '2026-10-08T23:57:51Z', when: 'Oct 8, 6:57 PM CDT', safety: 'none', alerts: [],
  place: { title: 'Lightning over São Paulo', sub: 'São Paulo, Brazil', city: { name: 'São Paulo', region: 'Brazil', cc: 'BR' } },
  stats: { strikes10: 1234, perMin: 80 },
};

test('template caption follows the house rules', () => {
  const c = templateCaption(meta, cfg);
  assert.match(c, /^⚡ Lightning over São Paulo: 1,234 strikes in 10 minutes/);
  assert.match(c, /Lightning data: Blitzortung\.org volunteers\./);
  assert.match(c, /link in bio/);
  assert.ok(!c.includes('—'));
  assert.match(c, /#SaoPauloWeather/);
});

test('US state weather tag', () => {
  const us = { ...meta, place: { ...meta.place, city: { name: 'Fort Myers', region: 'FL', cc: 'US' } } };
  assert.match(hashtags(us, cfg), /#FortMyersWeather #flwx/);
});

test('safety first when people may be in danger', () => {
  assert.equal(safetyLevel([{ event: 'Tornado Warning' }]), 'high');
  assert.equal(safetyLevel([{ event: 'Severe Thunderstorm Warning' }]), 'elevated');
  assert.equal(safetyLevel([{ event: 'Special Weather Statement' }]), 'none');
  const c = templateCaption({ ...meta, safety: 'high' }, cfg);
  assert.match(c.split('\n')[0], /National Weather Service/);
});

test('model output is tidied: no em dashes, credit and hashtags guaranteed', () => {
  const c = cleanCaption('"Storm over the city — wow.\nWatch any storm live, free: link in bio."', meta, cfg);
  assert.ok(!c.includes('—'));
  assert.ok(!c.startsWith('"'));
  assert.match(c, /#lightning/);
});
