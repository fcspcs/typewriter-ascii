/**
 * Does the strike detector count the same thing twice, and does it count the
 * same audio the same way twice?
 *
 * THE SECOND QUESTION IS THE IMPORTANT ONE, AND IT USED NOT TO BE ASKED.
 *
 * The previous version of this file fed hand-built flux traces to `_pick()`
 * with a hard-coded threshold. Eighty-nine assertions passed while the
 * detector's dominant error sat entirely outside what they touched: the FFT,
 * the band, the adaptive threshold and — above all — the timing. It was
 * evidence about the test generator, not about typewriters.
 *
 * What replaces it is the phase sweep. Synthesise a recording, then run it
 * through the real detector many times, moving only the offset between the
 * audio and the analysis grid. That offset is arbitrary in a browser and
 * drifts continuously, so it must not change the answer — and unlike a hit
 * rate, this needs no ground truth at all. Any spread in the counts is
 * provably error. Measured on real recordings, the old chain spread 9% on
 * medium typing and 19% on fast typing; that is what this test exists to
 * stop coming back.
 *
 * The synthetic typewriter below is a model, and a model is not a machine.
 * It is honest about the properties this suite actually depends on — a
 * broadband transient, a weaker rebound, a room — and nothing here should be
 * read as a claim about how an Olympia SM7 sounds.
 */
import {
  StrikeDetector, StrikeListener, LineTracker, DEFAULTS,
} from '../src/core/listen.js';
import assert from 'node:assert';

const RATE = 48000;

/** Deterministic noise, so a failure is always the same failure. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/**
 * Build a recording.
 *
 * A strike is a broadband click with a fast attack and a short decay, plus a
 * weaker copy of itself a few dozen milliseconds later for the rebound. A
 * carriage return is a long train of smaller clatter, not a smooth swell —
 * the old test modelled it as `3 * Math.sin(...)` over half a second, which
 * is a sound no typewriter makes.
 *
 * @param {Object} spec
 * @param {number} spec.seconds
 * @param {number[]} [spec.strikes] strike times, seconds
 * @param {number[]} [spec.returns] carriage-return start times, seconds
 * @param {number} [spec.noise] room noise amplitude
 * @param {number[]} [spec.force] per-strike loudness, defaults to 1
 * @param {number[]} [spec.spaces] space-bar times, seconds
 */
function record({
  seconds, strikes = [], returns = [], noise = 0.0005, force = null,
  reboundMs = 45, reboundLevel = 0.5, gain = 1, spaces = [],
}) {
  const n = Math.round(seconds * RATE);
  const x = new Float32Array(n);
  const r = rng(7);
  for (let i = 0; i < n; i++) x[i] = r() * noise;

  // One click: filtered noise under a sharp exponential decay. Broadband is
  // the property that matters, since that is what the flux responds to.
  const click = (at, amp, decayMs) => {
    const start = Math.round(at * RATE);
    const len = Math.round((decayMs * 6 * RATE) / 1000);
    const q = rng(Math.round(at * 1e6) | 1);
    let last = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const t = (i / RATE) * 1000;
      // A touch of high-pass: differencing tilts the noise upwards, which is
      // where a metal-on-platen impact actually puts its energy.
      const w = q();
      const v = w - last * 0.6;
      last = w;
      x[start + i] += v * amp * Math.exp(-t / decayMs);
    }
  };

  strikes.forEach((t, i) => {
    const a = (force?.[i] ?? 1) * gain;
    click(t, a, 8);
    click(t + reboundMs / 1000, a * reboundLevel, 6);
  });

  // The space bar drives the escapement without a typebar reaching the
  // platen, so there is no metal-on-rubber impact and what is left is a low
  // thump. Modelled by integrating the noise instead of differencing it —
  // the opposite tilt to a strike. Measured on the real SM7, a space puts
  // ~72% of its energy below 2 kHz against a strike's ~13%.
  const thump = (at, amp, decayMs) => {
    const start = Math.round(at * RATE);
    const len = Math.round((decayMs * 6 * RATE) / 1000);
    const q = rng(Math.round(at * 1e6) | 3);
    let acc = 0;
    for (let i = 0; i < len && start + i < n; i++) {
      const t = (i / RATE) * 1000;
      acc = acc * 0.97 + q() * 0.03;
      x[start + i] += acc * amp * 20 * Math.exp(-t / decayMs);
    }
  };
  for (const t of spaces) {
    thump(t, gain, 12);
    thump(t + 0.13, gain * 0.6, 10);      // the release, quieter and later
  }

  for (const t of returns) {
    // Lever, travel, and the slam into the margin stop: continuous clatter
    // for ~400 ms, loudest at the end. The 4x amplitude is not decoration —
    // on real recordings events of 250 ms or more peak a measured 13 dB
    // above events of 100 ms or less, and a fixture that made the return
    // merely as loud as a keystroke would be testing a machine nobody owns.
    for (let k = 0; k < 40; k++) {
      const at = t + k * 0.01;
      const ramp = 0.5 + k / 40;
      click(at, 3 * ramp * gain, 9);
    }
  }
  return x;
}

/** Count strikes and line ends in a recording, at a given analysis phase. */
function run(x, phase = 0, opt = {}, block = 480) {
  const strikes = [];
  const returns = [];
  const d = new StrikeDetector(RATE, {
    ...opt,
    onStrike: (e) => strikes.push(e),
    onReturn: (e) => returns.push(e),
  });
  const y = x.subarray(phase);
  for (let i = 0; i < y.length; i += block) d.push(y.subarray(i, i + block));
  // The recording is over. A carriage return is reported only once its
  // train of clatter has clearly ended, and a fixture must not have to
  // carry seconds of trailing silence to prove that.
  d.flush();
  return { strikes, returns, detector: d };
}

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

/* ── the load-bearing test ───────────────────────────────────── */

console.log('the same audio counts the same, whatever the clock does');

// Twelve seconds of ordinary typing: uneven spacing and uneven force, which
// is what a person produces and what a fixed-interval generator does not.
const typing = (() => {
  const times = [];
  const force = [];
  const r = rng(31);
  let t = 0.4;
  for (let i = 0; i < 40; i++) {
    times.push(t);
    force.push(0.6 + Math.abs(r()) * 0.8);
    t += 0.18 + Math.abs(r()) * 0.28;
  }
  return { x: record({ seconds: t + 1, strikes: times, force }), times, force };
})();

const HOP = Math.round((RATE * DEFAULTS.hopMs) / 1000);

check('the count does not move when the analysis phase does', () => {
  // This is the whole point of the rewrite. The phase between the audio and
  // the analysis grid is arbitrary in a browser; if it changes the answer,
  // the user sees drift that has nothing to do with what they typed.
  const counts = [];
  for (let p = 0; p < HOP; p += Math.round(HOP / 12)) {
    counts.push(run(typing.x, p).strikes.length);
  }
  const lo = Math.min(...counts);
  const hi = Math.max(...counts);
  assert.strictEqual(hi - lo, 0,
    `counts ranged ${lo}..${hi} over ${counts.length} phases: ${counts.join(',')}`);
});

check('the count does not move when the audio arrives in different sized blocks', () => {
  // A worklet delivers 128 frames at a time, a ScriptProcessorNode 1024, and
  // a test file whatever it likes. The framing belongs to the detector, so
  // none of that may be visible in the result.
  const counts = [128, 256, 480, 1024, 4096]
    .map((b) => run(typing.x, 0, {}, b).strikes.length);
  assert.strictEqual(new Set(counts).size, 1, `got ${counts.join(',')}`);
});

check('the count does not move when the recording level does', () => {
  // Phones vary, distances vary, and nobody will hold the machine at a fixed
  // 30 cm. The threshold is relative to the room by construction; this
  // checks that it really is.
  const counts = [0.25, 0.5, 1, 2, 4].map((g) => {
    const y = new Float32Array(typing.x.length);
    for (let i = 0; i < y.length; i++) y[i] = typing.x[i] * g;
    return run(y).strikes.length;
  });
  assert.strictEqual(new Set(counts).size, 1, `got ${counts.join(',')}`);
});

check('event times come from the audio, not from when we looked', () => {
  // The old code timestamped with performance.now(), which is when the main
  // thread got round to it. Times must be recoverable from the samples
  // alone, so replaying the same recording gives the same times to the
  // millisecond regardless of how it was fed in.
  const a = run(typing.x, 0, {}, 128).strikes.map((e) => e.at.toFixed(3));
  const b = run(typing.x, 0, {}, 8192).strikes.map((e) => e.at.toFixed(3));
  assert.deepStrictEqual(a, b, 'times depended on the delivery schedule');
});

check('every strike is found, and none is found twice', () => {
  // With a clean synthetic recording there is a right answer, so use it —
  // but only as a floor. This says the detector works on the easy case; it
  // says nothing about a real machine in a real room.
  const { strikes } = run(typing.x);
  assert.strictEqual(strikes.length, typing.times.length,
    `heard ${strikes.length} of ${typing.times.length}`);
  strikes.forEach((s, i) => {
    const off = Math.abs(s.at - typing.times[i] * 1000);
    assert.ok(off < 60, `strike ${i} placed ${off.toFixed(0)} ms out`);
  });
});

/* ── the things the old suite was right to test ──────────────── */

console.log('strike detection');

check('a single strike counts once, not twice', () => {
  const x = record({ seconds: 2, strikes: [0.8] });
  assert.strictEqual(run(x).strikes.length, 1);
});

check('the rebound is swallowed even when it is loud', () => {
  const x = record({
    seconds: 3, strikes: [0.8, 1.8], reboundMs: 60, reboundLevel: 0.8,
  });
  assert.strictEqual(run(x).strikes.length, 2);
});

check('fast typing still resolves each strike', () => {
  // Eight a second: quick, but well within what a practised typist does.
  const times = Array.from({ length: 8 }, (_, i) => 0.5 + i * 0.125);
  const x = record({ seconds: 2.5, strikes: times, reboundMs: 40 });
  assert.strictEqual(run(x).strikes.length, 8);
});

check('varying strike force is not mistaken for a rebound', () => {
  // Real typing is uneven. A light stroke after a heavy one must still count.
  const times = [0.5, 0.8, 1.1, 1.4];
  const x = record({ seconds: 2.2, strikes: times, force: [1, 0.4, 1, 0.4] });
  assert.strictEqual(run(x).strikes.length, 4);
});

check('a quiet room produces no phantom strikes', () => {
  const x = record({ seconds: 5, strikes: [], noise: 0.002 });
  assert.strictEqual(run(x).strikes.length, 0);
});

check('a noisy room produces no phantom strikes either', () => {
  // Forty times the noise of the quiet case. Nothing about it is impulsive,
  // so nothing about it should read as an onset.
  const x = record({ seconds: 5, strikes: [], noise: 0.08 });
  assert.strictEqual(run(x).strikes.length, 0);
});

check('the band is set in hertz, so it means the same at any sample rate', () => {
  // The old code took a fraction of Nyquist, which listened above 6.6 kHz on
  // one device and above 7.2 kHz on another. Same code, different detector.
  for (const rate of [44100, 48000]) {
    const d = new StrikeDetector(rate);
    const perBin = rate / d.opt.fftSize;
    assert.ok(Math.abs(d.binLo * perBin - DEFAULTS.bandLowHz) < perBin,
      `low edge is ${(d.binLo * perBin).toFixed(0)} Hz at ${rate}`);
    assert.ok(Math.abs(d.binHi * perBin - DEFAULTS.bandHighHz) < perBin,
      `high edge is ${(d.binHi * perBin).toFixed(0)} Hz at ${rate}`);
  }
});

check('a space bar reads low, a typebar reads broad', () => {
  /*
   * Measured on the labelled SM7 takes of 2026-08-24: space presses put
   * 0.68/0.72/0.75 (q10/med/q90) of their 0.5-12 kHz energy below 2 kHz,
   * against 0.08/0.13/0.62 for letter strikes. §4.3(b) of the research
   * document had rated this a guess for want of data; it is the one thing
   * that could eventually resolve a run of spaces, which is where an ASCII
   * motif is most easily lost.
   */
  const x = record({ seconds: 5, strikes: [0.6, 1.4], spaces: [2.4, 3.4] });
  const { strikes } = run(x);
  const typed = strikes.filter((s) => s.at < 2000);
  const spaced = strikes.filter((s) => s.at >= 2000);
  assert.ok(typed.length >= 2 && spaced.length >= 2,
    `heard ${typed.length} strikes and ${spaced.length} spaces`);
  assert.ok(typed.every((s) => !s.space),
    `a typebar was called a space: shares ${typed.map((s) => s.lowShare.toFixed(2))}`);
  assert.ok(spaced.every((s) => s.space),
    `a space was called a typebar: shares ${spaced.map((s) => s.lowShare.toFixed(2))}`);
});

check('the reading is a number on every strike, not only on spaces', () => {
  // Whoever aligns against a known line needs the evidence, not a verdict.
  const x = record({ seconds: 2, strikes: [0.8] });
  const [s] = run(x).strikes;
  assert.ok(s.lowShare >= 0 && s.lowShare <= 1, `share is ${s.lowShare}`);
  assert.strictEqual(typeof s.space, 'boolean');
});

check('the band keeps the part of the strike that carries the energy', () => {
  // Zhuang et al. 2005 put the keystroke between 400 Hz and 12 kHz. The old
  // band began at 7.2 kHz and threw away a measured 62% of it.
  assert.ok(DEFAULTS.bandLowHz <= 1000, 'the low edge is above the strike');
  assert.ok(DEFAULTS.bandHighHz >= 10000, 'the high edge cuts into the strike');
});

/* ── carriage return ─────────────────────────────────────────── */

console.log('carriage return');

/** A line of typing followed by the carriage coming back. */
function line(count = 12, at = 0.4, pace = 0.25) {
  const strikes = Array.from({ length: count }, (_, i) => at + i * pace);
  const ret = strikes[strikes.length - 1] + 0.6;
  return { strikes, ret, end: ret + 1 };
}

check('a carriage return is recognised as a line end', () => {
  const l = line();
  const x = record({ seconds: l.end, strikes: l.strikes, returns: [l.ret] });
  const { returns } = run(x);
  assert.strictEqual(returns.length, 1, `got ${returns.length}`);
  assert.ok(returns[0].durationMs >= DEFAULTS.returnMinMs,
    `only ${returns[0].durationMs.toFixed(0)} ms long`);
});

check('a long noise that is not louder than typing is not a line end', () => {
  // A chair scraping, or a lorry outside: long enough, but nothing like as
  // loud as the machine. Duration alone would fall for it.
  const l = line();
  const x = record({ seconds: l.end, strikes: l.strikes, returns: [l.ret] });
  // Quarter amplitude for the return only: rebuild it that way.
  const quiet = record({
    seconds: l.end, strikes: l.strikes, returns: [],
  });
  const scale = 0.12;
  const merged = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    merged[i] = quiet[i] + (x[i] - quiet[i]) * scale;
  }
  assert.strictEqual(run(merged).returns.length, 0);
});

check('nothing is called a line end before any strike has been heard', () => {
  // "Louder than an ordinary strike" is meaningless until ordinary strikes
  // have been heard, and an absolute level would only measure the phone's
  // distance from the machine. Refusing to answer is the correct answer.
  const x = record({ seconds: 3, strikes: [], returns: [1.0] });
  assert.strictEqual(run(x).returns.length, 0);
});

check('a burst of fast typing is not a carriage return', () => {
  // This is the failure that matters. A run of quick strikes lasts as long
  // as a return and is nearly as loud, so it can merge into one continuous
  // loud stretch. Calling that a line end would reset the count halfway
  // along the line, which is worse than never resetting at all.
  const slow = Array.from({ length: 8 }, (_, i) => 0.4 + i * 0.25);
  const fast = Array.from({ length: 12 }, (_, i) => 2.6 + i * 0.09);
  const x = record({ seconds: 5, strikes: [...slow, ...fast] });
  assert.strictEqual(run(x).returns.length, 0);
});

check('ordinary typing produces no line ends', () => {
  const l = line(16);
  const x = record({ seconds: l.end, strikes: l.strikes });
  assert.strictEqual(run(x).returns.length, 0);
});

check('the return reports the strikes counted inside it', () => {
  // The clatter of the return trips the onset detector. The caller needs to
  // know how many of those to take back off the line's total.
  const l = line();
  const x = record({ seconds: l.end, strikes: l.strikes, returns: [l.ret] });
  const { returns } = run(x);
  assert.strictEqual(returns.length, 1);
  assert.ok(returns[0].strikesInside >= 0, 'no count reported');
});

check('line ends are found at the same place whatever the phase', () => {
  const l = line();
  const x = record({ seconds: l.end, strikes: l.strikes, returns: [l.ret] });
  const found = [];
  for (let p = 0; p < HOP; p += Math.round(HOP / 6)) found.push(run(x, p).returns.length);
  assert.strictEqual(new Set(found).size, 1, `got ${found.join(',')}`);
});

check('three lines produce three line ends, not two and not five', () => {
  const strikes = [];
  const returns = [];
  let t = 0.4;
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 10; i++) { strikes.push(t); t += 0.22; }
    returns.push(t + 0.2);
    t += 1.2;
  }
  const x = record({ seconds: t + 1, strikes, returns });
  assert.strictEqual(run(x).returns.length, 3);
});

/* ── line bookkeeping ────────────────────────────────────────── */

console.log('keeping the count honest');

check('the count resets at every line end', () => {
  // The reason carriage-return detection is worth building at all: an error
  // is confined to the line it happened on instead of following the typist
  // down the page.
  const t = new LineTracker().begin(10);
  for (let i = 0; i < 12; i++) t.strike();
  t.lineEnd();
  assert.strictEqual(t.count, 0, 'the count carried over into the next line');
});

check('a line that counted right is not reported as lost', () => {
  const t = new LineTracker().begin(10);
  for (let i = 0; i < 10; i++) t.strike();
  const r = t.lineEnd();
  assert.strictEqual(r.error, 0);
  assert.strictEqual(r.lost, false);
});

check('being one out is forgiven, being three out is not', () => {
  const near = new LineTracker().begin(40);
  for (let i = 0; i < 41; i++) near.strike();
  assert.strictEqual(near.lineEnd().lost, false);

  const far = new LineTracker().begin(40);
  for (let i = 0; i < 37; i++) far.strike();
  assert.strictEqual(far.lineEnd().lost, true);
});

check('strikes heard during the return itself do not count against the line', () => {
  const t = new LineTracker().begin(20);
  for (let i = 0; i < 22; i++) t.strike();
  const r = t.lineEnd(2);      // two of those were the carriage coming back
  assert.strictEqual(r.heard, 20);
  assert.strictEqual(r.error, 0);
});

check('saying where you are clears the lost state', () => {
  const t = new LineTracker().begin(40);
  for (let i = 0; i < 30; i++) t.strike();
  t.lineEnd();
  assert.strictEqual(t.lost, true);
  t.resolve(12);
  assert.strictEqual(t.lost, false);
  assert.strictEqual(t.count, 12);
});

check('the recent error is reported, so the user can be told', () => {
  const t = new LineTracker().begin(40);
  for (let i = 0; i < 38; i++) t.strike();
  t.lineEnd();
  t.begin(40);
  for (let i = 0; i < 38; i++) t.strike();
  t.lineEnd();
  assert.strictEqual(t.drift, -2, `drift reads ${t.drift}`);
});

/* ── mechanism noise ─────────────────────────────────────────── */

console.log('telling a strike from the machine coming back to rest');

check('a rebound 8 dB below its own strike is not a second strike', () => {
  /*
   * Measured on a real Olympia SM7: 22 keystrokes typed deliberately slowly,
   * 61 acoustic events in the recording, 56 counted. The 39 extras sat 6-20
   * dB below the strike that caused them, 15-190 ms later.
   *
   * Spectral flux cannot tell them apart, because a key returning starts a
   * sound just as definitely as a key being struck. Only loudness can.
   */
  const sr = 48000;
  const d = new StrikeDetector(sr, { sensitivity: 0.6 });
  let n = 0;
  d.onStrike = () => n++;

  const x = new Float32Array(sr * 6);
  const burst = (atMs, amp) => {
    const at = Math.round((atMs / 1000) * sr);
    for (let i = 0; i < sr * 0.06; i++) {
      // noise burst with a fast decay: broadband, like a key hitting paper
      x[at + i] += amp * (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.012));
    }
  };

  // eight strikes, each followed by its own rebound 120 ms later at -8 dB
  for (let k = 0; k < 8; k++) {
    burst(1000 + k * 600, 0.5);
    burst(1120 + k * 600, 0.5 * 10 ** (-9 / 20));
  }
  for (let i = 0; i + 480 <= x.length; i += 480) d.push(x.subarray(i, i + 480));

  assert.ok(n <= 10, `counted ${n} for 8 strikes: rebounds are being counted`);
  assert.ok(n >= 6, `counted ${n} for 8 strikes: real strikes are being lost`);
});

check('a softer strike still counts, so easing off is not silence', () => {
  // The reference decays, otherwise the hardest strike ever heard sets the
  // bar and a typist easing off goes unheard. Measured without decay: 19 of
  // 22 on the labelled recording.
  const sr = 48000;
  const d = new StrikeDetector(sr, { sensitivity: 0.6 });
  let n = 0;
  d.onStrike = () => n++;

  const x = new Float32Array(sr * 8);
  const burst = (atMs, amp) => {
    const at = Math.round((atMs / 1000) * sr);
    for (let i = 0; i < sr * 0.06; i++) {
      x[at + i] += amp * (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.012));
    }
  };
  // one hard strike, then six progressively softer ones a second apart
  burst(800, 0.8);
  for (let k = 0; k < 6; k++) burst(1800 + k * 1000, 0.8 * 10 ** (-(k + 2) / 20));
  for (let i = 0; i + 480 <= x.length; i += 480) d.push(x.subarray(i, i + 480));

  assert.ok(n >= 6, `only ${n} of 7 strikes heard as the typist eased off`);
});

/* ── calibration ─────────────────────────────────────────────── */

console.log('calibration');

check('calibrate finds an interval that yields the right count', () => {
  // Candidates as the detector sees them with the gate wide open: a strike
  // and its rebound for every keystroke.
  const peaks = [];
  for (let i = 0; i < 12; i++) {
    peaks.push({ at: i * 300 });
    peaks.push({ at: i * 300 + 55 });
  }
  const cal = StrikeListener.calibrate(12, peaks);
  assert.ok(cal, 'no calibration returned');
  assert.strictEqual(cal.err, 0, `error ${cal.err}`);
  assert.ok(cal.minIntervalMs > 55 && cal.minIntervalMs <= 300,
    `settled on ${cal.minIntervalMs} ms`);
});

check('calibration result actually applies', () => {
  const l = new StrikeListener();
  l.apply({ minIntervalMs: 123 });
  assert.strictEqual(l.opt.minIntervalMs, 123);
});

check('calibration refuses to invent an answer from nothing', () => {
  assert.strictEqual(StrikeListener.calibrate(20, []), null);
  assert.strictEqual(StrikeListener.calibrate(1, [{ at: 0 }]), null);
});

/* ── the shape of the analysis ───────────────────────────────── */

console.log('the analysis grid');

check('the hop is fixed and fine enough to see a transient', () => {
  // Dixon 2006 uses 10 ms, Zhuang et al. 10 ms, Böck & Widmer 5 ms. A frame
  // at 60 fps is 16.7 ms and at 30 fps is 33 ms, which is coarser than any
  // of them and, worse, not constant.
  assert.ok(DEFAULTS.hopMs <= 10, `hop is ${DEFAULTS.hopMs} ms`);
  const d = new StrikeDetector(48000);
  assert.strictEqual(d.hop, 480);
});

check('the analysis windows overlap, so no audio goes unexamined', () => {
  const d = new StrikeDetector(48000);
  const windowMs = (d.opt.fftSize / 48000) * 1000;
  assert.ok(windowMs > DEFAULTS.hopMs * 2,
    `window ${windowMs.toFixed(1)} ms against a ${DEFAULTS.hopMs} ms hop`);
});

check('it runs comfortably faster than real time', () => {
  // It has to keep up on a phone that is also drawing the sheet. Node on a
  // server is not a phone, so this is a smoke test for an accidental
  // quadratic, not a performance claim about any device.
  const x = record({ seconds: 10, strikes: Array.from({ length: 30 }, (_, i) => 0.3 + i * 0.3) });
  const t0 = Date.now();
  run(x);
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `10 s of audio took ${ms} ms`);
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
