// Which strikes get a thunder clap in the clip. Pure, so it can be tested.
// events: [{ at: seconds into the clip, d: km from the crosshair }]
// Closest strikes win: a near crack beats a far rumble that would mask it.
// Far rumbles are capped, because many of them at once turn into mush.

const gapFor = (d) => (d < 8 ? 0.45 : d < 20 ? 1.2 : 2.4);

export function selectClaps(events, { maxClaps = 24, maxFar = 6 } = {}) {
  const picked = [];
  let far = 0;
  for (const e of [...events].sort((a, b) => a.d - b.d)) {
    if (picked.length >= maxClaps) break;
    const isFar = e.d >= 20;
    if (isFar && far >= maxFar) continue;
    if (picked.some((p) => Math.abs(p.at - e.at) < Math.min(gapFor(e.d), gapFor(p.d)))) continue;
    picked.push(e);
    if (isFar) far++;
  }
  return picked.sort((a, b) => a.at - b.at);
}

// Final mix chain for ffmpeg: gentle compression lifts the rolling tails, a
// limiter catches close cracks. Lands near -15 LUFS, a typical level for social video.
export const AUDIO_FILTER = 'acompressor=threshold=0.1:ratio=3:attack=4:release=350:makeup=2,alimiter=limit=0.9:level=false';
