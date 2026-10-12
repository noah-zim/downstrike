import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickStorm, scoreStorm, describePlace, nearestCity } from '../pick.mjs';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url)));
const now = Date.parse('2026-10-08T22:00:00Z');
const houston = { lat: 29.8, lon: -95.5, count: 900 };
const amazon = { lat: -5.0, lon: -63.0, count: 1500 }; // far from any listed metro
const smallUS = { lat: 46.9, lon: -96.8, count: 150 };  // Fargo

test('a storm over a big US city outranks a bigger one in the middle of nowhere', () => {
  assert.ok(scoreStorm(houston, cfg) > scoreStorm(amazon, cfg));
  const r = pickStorm([amazon, houston], { history: [], cfg, now });
  assert.equal(r.storm, houston);
});

test('cooldown skips a place filmed recently, and the daily cap stops everything', () => {
  const recent = [{ at: new Date(now - 2 * 3600e3).toISOString(), lat: 29.7, lon: -95.4 }];
  const r = pickStorm([houston, amazon], { history: recent, cfg, now });
  assert.notEqual(r.storm, houston);
  const capped = Array.from({ length: cfg.maxClipsPerDay }, (_, i) => ({ at: new Date(now - (i + 1) * 3600e3).toISOString(), lat: 0, lon: 0 }));
  assert.match(pickStorm([houston], { history: capped, cfg, now }).skip, /clips in 24 h/);
  assert.equal(pickStorm([houston], { history: capped, cfg, now, force: true }).storm, houston);
});

test('quiet day: the daily fallback still makes one clip, but not a second', () => {
  const r = pickStorm([smallUS], { history: [], cfg, now });
  assert.ok(r.score < cfg.minScore, `score ${r.score} should be under the bar`);
  assert.equal(r.fallback, true);
  const yesterday = [{ at: new Date(now - 5 * 3600e3).toISOString(), lat: 10, lon: 10 }];
  assert.ok(pickStorm([smallUS], { history: yesterday, cfg, now }).skip);
});

test('place names', () => {
  assert.equal(describePlace(29.76, -95.37).title, 'Lightning over Houston');
  const near = describePlace(30.5, -95.37);
  assert.equal(near.title, 'Lightning near Houston');
  assert.match(near.sub, /^\d+ km N of Houston, TX$/);
  assert.equal(describePlace(-5, -63, 'Amazonas, Brazil').title, 'Lightning over Amazonas');
  assert.match(describePlace(-5, -63).sub, /5\.0°S, 63\.0°W/);
  assert.equal(nearestCity(-23.5, -46.6).city.name, 'São Paulo');
});

test('reverse-geocoded names are reduced to letters and plain punctuation', async () => {
  const { safeName } = await import('../pick.mjs');
  assert.equal(safeName('Mato Grosso, Brasil'), 'Mato Grosso, Brasil');
  assert.equal(safeName('X<!-- caption:start -->`bad`'), 'X-- captionstart --bad');
  assert.equal(describePlace(-5, -63, '<b>Amazonas</b>, Brazil').sub, 'bAmazonasb, Brazil');
});
