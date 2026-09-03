// Distance-modulated synthesized thunder (no audio assets).
// Close strikes: sharp broadband crack + sub-bass thump + short rumble.
// Distant strikes: quiet, slow-swelling low rumble — highs absorbed by the air.
let ctx = null;

export function armAudio() {
  // must be called from a user gesture at least once
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function synthThunder(ac, dest, distKm) {
  const t0 = ac.currentTime;
  const sr = ac.sampleRate;
  const d = Math.min(Math.max(distKm == null ? 10 : distKm, 0), 50);
  const close = 1 - d / 50; // 1 = overhead, 0 = 50 km away

  const master = ac.createGain();
  master.gain.value = 0.10 + 0.85 * Math.pow(close, 1.6);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 6;
  master.connect(comp).connect(dest);

  const dur = 2.2 + 3.8 * (1 - close);                  // far thunder rolls longer
  const attack = 0.005 + 0.45 * Math.pow(1 - close, 2); // far thunder swells in

  // --- rumble bed: brown noise with rolling random peaks, stereo ---
  const len = Math.ceil(sr * dur);
  const buf = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const peaks = [];
    const nP = 3 + Math.floor(Math.random() * 4);
    for (let p = 0; p < nP; p++) {
      peaks.push({
        at: Math.random() * dur * 0.6,
        w: 0.15 + Math.random() * 0.7,
        a: 0.4 + Math.random() * 0.6,
      });
    }
    let brown = 0;
    let peakAbs = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let env = 0;
      for (const p of peaks) {
        const x = (t - p.at) / p.w;
        if (x > 0) env += p.a * x * Math.exp(1 - x);
      }
      env = Math.tanh(env);
      const global = Math.min(1, t / attack) * Math.exp(-Math.max(0, t - attack) / (dur * 0.45));
      const fadeOut = Math.min(1, (dur - t) / (dur * 0.18)); // smooth landing at the end
      brown = brown * 0.985 + (Math.random() * 2 - 1) * 0.2;
      data[i] = brown * env * global * fadeOut * fadeOut;
      const a = Math.abs(data[i]);
      if (a > peakAbs) peakAbs = a;
    }
    if (peakAbs > 0) {
      for (let i = 0; i < len; i++) data[i] /= peakAbs;
    }
  }
  const rumble = ac.createBufferSource();
  rumble.buffer = buf;
  const rumbleLp = ac.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.value = 85 + 380 * close * close; // air eats the highs with distance
  rumble.connect(rumbleLp).connect(master);
  rumble.start(t0);

  // --- boom: only within ~12 km — blunt low-mid impact, not a whip crack ---
  const crackAmt = Math.max(0, 1 - d / 12);
  if (crackAmt > 0) {
    const cDur = 0.7;
    const cLen = Math.ceil(sr * cDur);
    const cBuf = ac.createBuffer(2, cLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const cd = cBuf.getChannelData(ch);
      for (let i = 0; i < cLen; i++) {
        const t = i / sr;
        const soften = Math.min(1, t / 0.012);            // no instantaneous edge
        const body = Math.exp(-t / 0.11);
        const echo = t > 0.09 ? 0.5 * Math.exp(-(t - 0.09) / 0.12) : 0;
        const fadeOut = Math.min(1, (cDur - t) / 0.12);
        cd[i] = (Math.random() * 2 - 1) * (body + echo) * soften * fadeOut;
      }
    }
    const crack = ac.createBufferSource();
    crack.buffer = cBuf;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;                              // keep the low body in
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + 1600 * crackAmt;            // tops out ~2.5 kHz, no whip
    const cg = ac.createGain();
    cg.gain.value = 0.6 * Math.pow(crackAmt, 1.2);
    crack.connect(hp).connect(lp).connect(cg).connect(master);
    crack.start(t0);
  }

  // --- sub-bass thump for strikes inside ~25 km ---
  if (close > 0.5) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(50, t0);
    osc.frequency.exponentialRampToValueAtTime(30, t0 + 0.9);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(Math.max(0.05, (close - 0.5) * 1.2), t0 + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
    osc.connect(og).connect(master);
    osc.start(t0);
    osc.stop(t0 + 1.2);
  }

  return dur;
}

export function thunder(distKm) {
  window._thunderTries = (window._thunderTries || 0) + 1; // debug: wiring check
  if (!ctx || ctx.state !== 'running') return;
  synthThunder(ctx, ctx.destination, distKm);
}

// Offline-render a thunder clap and report levels — used for testing only.
export async function _renderTest(distKm) {
  const ac = new OfflineAudioContext(2, 44100 * 7, 44100);
  synthThunder(ac, ac.destination, distKm);
  const buf = await ac.startRendering();
  const chd = buf.getChannelData(0);
  let peak = 0, sum = 0, lastLoud = 0;
  for (let i = 0; i < chd.length; i++) {
    const a = Math.abs(chd[i]);
    if (a > peak) peak = a;
    sum += a * a;
    if (a > 0.02) lastLoud = i;
  }
  // measure the taper into the ending: RMS of two windows before the rumble ends
  const d = Math.min(Math.max(distKm == null ? 10 : distKm, 0), 50);
  const dur = 2.2 + 3.8 * (d / 50);
  const win = (a, b) => {
    let s = 0, n = 0;
    for (let i = Math.floor(a * 44100); i < Math.min(chd.length, Math.floor(b * 44100)); i++) {
      s += chd[i] * chd[i]; n++;
    }
    return n ? Math.sqrt(s / n) : 0;
  };
  return {
    peak: +peak.toFixed(3),
    rms: +Math.sqrt(sum / chd.length).toFixed(4),
    audibleSecs: +(lastLoud / 44100).toFixed(2),
    tailRms: [+win(dur - 0.5, dur - 0.25).toFixed(4), +win(dur - 0.25, dur).toFixed(4), +win(dur, dur + 0.3).toFixed(4)],
  };
}
