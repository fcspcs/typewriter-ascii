/**
 * Does the peak picker survive the rebound?
 *
 * We synthesise the flux signal a typewriter produces: a sharp strike
 * followed by a weaker echo a few dozen milliseconds later, plus noise.
 * A naive threshold detector counts every one of those twice — that is the
 * bug this test exists to catch.
 */
import { StrikeListener, DEFAULTS } from '../src/core/listen.js';
import assert from 'node:assert';

/** Fake one frame of flux into a listener's peak picker. */
function feed(listener, flux, now, threshold) {
  listener._pick(flux, threshold, now);
}

/**
 * Build a flux trace, 60 fps.
 * @param {number[]} strikeTimes ms
 * @param {number} reboundDelay  ms after each strike
 * @param {number} reboundLevel  relative loudness of the rebound
 */
function trace(strikeTimes, reboundDelay = 45, reboundLevel = 0.55) {
  const frames = [];
  const end = Math.max(...strikeTimes) + 600;
  for (let t = 0; t <= end; t += 16.7) {
    let v = 0.4 + Math.sin(t / 37) * 0.15;      // room noise
    for (const s of strikeTimes) {
      // strike: fast attack, quick decay
      const d = t - s;
      if (d >= 0 && d < 60) v += 9 * Math.exp(-d / 12);
      const r = t - s - reboundDelay;
      if (r >= 0 && r < 60) v += 9 * reboundLevel * Math.exp(-r / 12);
    }
    frames.push({ t, v });
  }
  return frames;
}

function countStrikes(frames, opt = {}) {
  const hits = [];
  const l = new StrikeListener({ ...opt, onStrike: (i) => hits.push(i) });
  for (const f of frames) feed(l, f.v, f.t, 2.0);
  return hits;
}

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); failures++; }
};

console.log('strike detection');

check('single strike counts once, not twice', () => {
  const hits = countStrikes(trace([200]));
  assert.strictEqual(hits.length, 1, `got ${hits.length}`);
});

check('ten strikes at typing speed count as ten', () => {
  const times = Array.from({ length: 10 }, (_, i) => 200 + i * 260);
  const hits = countStrikes(trace(times));
  assert.strictEqual(hits.length, 10, `got ${hits.length}`);
});

check('fast typing still resolves each strike', () => {
  // 8 strikes per second — quick but human
  const times = Array.from({ length: 8 }, (_, i) => 200 + i * 125);
  const hits = countStrikes(trace(times, 40, 0.5));
  assert.strictEqual(hits.length, 8, `got ${hits.length}`);
});

check('a loud rebound is still not a strike', () => {
  const hits = countStrikes(trace([200, 700], 60, 0.8));
  assert.strictEqual(hits.length, 2, `got ${hits.length}`);
});

check('quiet room produces no phantom strikes', () => {
  const frames = [];
  for (let t = 0; t < 3000; t += 16.7) frames.push({ t, v: 0.5 + Math.random() * 0.3 });
  const hits = countStrikes(frames);
  assert.strictEqual(hits.length, 0, `got ${hits.length}`);
});


check('slow deliberate typing, long rebound gap', () => {
  const times = Array.from({ length: 6 }, (_, i) => 200 + i * 700);
  const hits = countStrikes(trace(times, 90, 0.6));
  assert.strictEqual(hits.length, 6, `got ${hits.length}`);
});

check('varying strike force is not mistaken for rebound', () => {
  // Real typing is uneven: a light stroke after a heavy one must still count.
  const frames = [];
  const times = [200, 500, 800, 1100];
  const force = [9, 4, 9, 4];
  for (let t = 0; t <= 1800; t += 16.7) {
    let v = 0.4;
    times.forEach((s, i) => {
      const d = t - s;
      if (d >= 0 && d < 60) v += force[i] * Math.exp(-d / 12);
      const r = d - 45;
      if (r >= 0 && r < 60) v += force[i] * 0.5 * Math.exp(-r / 12);
    });
    frames.push({ t, v });
  }
  const hits = countStrikes(frames);
  assert.strictEqual(hits.length, 4, `got ${hits.length}`);
});

check('space bar (two mechanical clicks) counts once', () => {
  // Down and release, close together and similar in level.
  const hits = countStrikes(trace([300], 35, 0.75));
  assert.strictEqual(hits.length, 1, `got ${hits.length}`);
});

check('carriage return does not add a strike', () => {
  // A long rumble rather than a transient: high level, slow rise.
  const frames = [];
  for (let t = 0; t <= 1200; t += 16.7) {
    let v = 0.4;
    if (t > 400 && t < 900) v += 3 * Math.sin((t - 400) / 500 * Math.PI);
    frames.push({ t, v });
  }
  const hits = countStrikes(frames);
  assert.ok(hits.length <= 1, `got ${hits.length}`);
});

console.log('calibration');

check('calibrate finds a window that yields the right count', () => {
  // peaks as the detector would see them: strike + rebound per keystroke
  const peaks = [];
  for (let i = 0; i < 12; i++) {
    peaks.push({ at: i * 300, strength: 9 });
    peaks.push({ at: i * 300 + 55, strength: 5 });
  }
  const cal = StrikeListener.calibrate(12, peaks);
  assert.ok(cal, 'no calibration returned');
  assert.strictEqual(cal.err, 0, `error ${cal.err}`);
});

check('calibration result actually applies', () => {
  const l = new StrikeListener();
  l.apply({ refractoryMs: 123, reboundRatio: 0.7 });
  assert.strictEqual(l.opt.refractoryMs, 123);
  assert.strictEqual(l.opt.reboundRatio, 0.7);
});

console.log(failures ? `\n${failures} failed` : '\nall green');
process.exit(failures ? 1 : 0);
