import test from 'node:test';
import assert from 'node:assert/strict';
import { selectClaps } from '../sound.mjs';

test('close cracks win over far rumbles at the same moment', () => {
  const picked = selectClaps([{ at: 2.0, d: 40 }, { at: 2.3, d: 3 }]);
  assert.deepEqual(picked, [{ at: 2.3, d: 3 }]);
});

test('far rumbles are spaced out and capped; output is in time order', () => {
  const far = Array.from({ length: 60 }, (_, i) => ({ at: i * 0.3, d: 30 + (i % 10) })); // 18 s: room for 8, cap is 6
  const picked = selectClaps(far, { maxFar: 6 });
  assert.equal(picked.length, 6);
  for (let i = 1; i < picked.length; i++) {
    assert.ok(picked[i].at > picked[i - 1].at);
    assert.ok(picked[i].at - picked[i - 1].at >= 2.4 - 1e-9);
  }
});

test('a storm overhead can crack every half second', () => {
  const near = Array.from({ length: 20 }, (_, i) => ({ at: i * 0.5, d: 2 }));
  assert.equal(selectClaps(near).length, 20);
});
