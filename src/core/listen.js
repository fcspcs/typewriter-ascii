/**
 * listen.js — count keystrokes by ear.
 *
 * WHY THE FIRST ATTEMPT DOUBLE-COUNTED
 *
 * A typewriter key is not one sound. Pressing it produces at least two:
 *
 *   1. the type bar hitting the platen  — sharp, loud, broadband
 *   2. the type bar falling back        — softer, slightly later
 *   3. on the space bar and on release, the mechanism settling
 *
 * A plain "is it loud enough" detector fires on both, so one keystroke gets
 * counted twice. Worse, the gap between the two varies with how hard you
 * strike, so no single fixed hold-off works for everyone.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Three stages, cheap enough to run in a browser at 60 fps:
 *
 *   a) ONSET DETECTION, not level detection.
 *      Spectral flux over the upper spectrum: sum of *positive* frame-to-
 *      frame energy changes. A strike is a sudden broadband rise. Steady
 *      noise, hum, a voice, or the carriage sliding produce little flux.
 *
 *   b) ADAPTIVE THRESHOLD.
 *      Compares against a running median of recent flux plus a sensitivity
 *      offset, so a quiet room and a noisy café both work without fiddling.
 *
 *   c) PEAK PICKING WITH A REFRACTORY WINDOW.
 *      This is the part that fixes double counting. Once over threshold we
 *      do not fire immediately — we wait for the flux to actually peak, then
 *      lock out further triggers for a refractory period, and additionally
 *      suppress any later peak that is much weaker than the one that opened
 *      the window. The rebound is always quieter than the strike, so it gets
 *      swallowed.
 *
 * WHY NOT MACHINE LEARNING
 *
 * It would work, but it is the wrong tool here. It needs labelled recordings
 * from every machine, ships megabytes of model, drains the battery, and when
 * it miscounts nobody can tell why. Onset detection is the standard approach
 * for percussive events in audio, it is a few dozen lines, it runs anywhere,
 * and every parameter has a meaning you can explain and adjust.
 *
 * If it ever proves not to be enough, the honest next step is not a neural
 * net but a per-machine calibration: record a dozen known strikes, measure
 * the actual rebound delay and relative loudness, and set the refractory
 * window and rebound ratio from that. `calibrate()` below does exactly this.
 */

export const DEFAULTS = {
  fftSize: 1024,
  /** Ignore the bottom of the spectrum: hum, rumble, voices live there. */
  bandStart: 0.30,
  /** Sensitivity, 0…1. Higher means it takes less to trigger. */
  sensitivity: 0.55,
  /**
   * Minimum gap between two counted strikes, ms.
   * This does most of the work: the type bar rebounds within roughly 30–70 ms,
   * so a window of ~85 ms swallows it while still allowing 11 strikes a
   * second — faster than anyone types.
   */
  refractoryMs: 85,
  /** Longest a peak may take to develop before we give up on it, ms. */
  peakWindowMs: 25,
  /**
   * Backstop for machines whose rebound arrives later than the refractory
   * window: a peak within `reboundMs` is dropped if it is much weaker than
   * the strike that opened the window.
   *
   * Keep both numbers modest. Measured strike strength varies a lot — a
   * sharp transient can fall between two analysis frames and read at half
   * its true height. An aggressive ratio here (0.85 was the first attempt)
   * throws away every second *real* keystroke as soon as someone types
   * quickly. Test `fast typing still resolves each strike` guards this.
   */
  reboundMs: 120,
  reboundRatio: 0.5,
  /**
   * How fast the burst must rise, in threshold units per frame.
   *
   * A strike is a transient: it goes from nothing to peak within one or two
   * analysis frames. The carriage return, by contrast, is a rumble that
   * swells over hundreds of milliseconds and can easily sit above the
   * threshold the whole time — which produced two phantom strikes before
   * this check existed. Requiring a steep rise separates the two without
   * needing to know anything about the machine.
   */
  minSlope: 0.9,
};

/** Running median over a small window — robust against the strikes themselves. */
class Median {
  constructor(size = 64) { this.size = size; this.buf = []; this.i = 0; }
  push(v) {
    if (this.buf.length < this.size) this.buf.push(v);
    else { this.buf[this.i] = v; this.i = (this.i + 1) % this.size; }
  }
  get value() {
    if (!this.buf.length) return 0;
    const s = [...this.buf].sort((a, b) => a - b);
    return s[s.length >> 1];
  }
}

export class StrikeListener {
  /**
   * @param {Object} [opt] see DEFAULTS
   * @param {(info: {strength:number, at:number}) => void} [opt.onStrike]
   * @param {(info: {flux:number, threshold:number}) => void} [opt.onFrame]
   */
  constructor(opt = {}) {
    this.opt = { ...DEFAULTS, ...opt };
    this.onStrike = opt.onStrike ?? (() => {});
    this.onFrame = opt.onFrame ?? (() => {});

    this.ctx = null;
    this.stream = null;
    this.running = false;

    this.prev = null;
    this.floor = new Median(72);
    this.lastStrikeAt = -1e9;
    this.lastStrength = 0;

    // peak-picking state
    this.rising = false;
    this.peak = 0;
    this.peakAt = 0;

    /** Set when calibrate() has measured this machine. */
    this.calibration = null;
  }

  get sensitivity() { return this.opt.sensitivity; }
  set sensitivity(v) { this.opt.sensitivity = Math.min(1, Math.max(0, v)); }

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // All three would smooth away exactly what we are looking for.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.opt.fftSize;
    this.analyser.smoothingTimeConstant = 0;  // we want the raw frames
    src.connect(this.analyser);

    this.bins = new Float32Array(this.analyser.frequencyBinCount);
    this.from = Math.floor(this.analyser.frequencyBinCount * this.opt.bandStart);
    this.prev = null;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.stream = null;
  }

  /** One analysis frame. Returns the flux, mostly for testing. */
  step(now = performance.now()) {
    this.analyser.getFloatFrequencyData(this.bins);

    let flux = 0;
    if (this.prev) {
      for (let i = this.from; i < this.bins.length; i++) {
        // dB values; only rises count. A fall is the sound decaying.
        const d = this.bins[i] - this.prev[i];
        if (d > 0) flux += d;
      }
      flux /= (this.bins.length - this.from);
    }
    this.prev = this.bins.slice();

    this.floor.push(flux);
    const base = this.floor.value;
    const offset = (1 - this.opt.sensitivity) * 6 + 0.6;
    const threshold = base + offset;

    this.onFrame({ flux, threshold });
    this._pick(flux, threshold, now);
    return flux;
  }

  /**
   * Peak picking. The whole point: do not fire on crossing the threshold,
   * fire on the *maximum* of the burst, then stay deaf for a while.
   */
  _pick(flux, threshold, now) {
    const o = this.opt;

    if (!this.rising) {
      // Only open a burst on a genuine transient: the jump into it must be
      // steep. Slow swells (carriage return, someone talking) never qualify.
      const jump = flux - (this.lastFlux ?? flux);
      if (flux > threshold && jump > threshold * o.minSlope) {
        this.rising = true;
        this.peak = flux;
        this.peakAt = now;
      }
      this.lastFlux = flux;
      return;
    }
    this.lastFlux = flux;

    // still climbing?
    if (flux >= this.peak) {
      this.peak = flux;
      this.peakAt = now;
      return;
    }

    // past the peak, or waited long enough — decide now
    if (flux < threshold || now - this.peakAt > o.peakWindowMs) {
      this.rising = false;
      const gap = this.peakAt - this.lastStrikeAt;

      if (gap < o.refractoryMs) return;                       // too soon
      if (gap < o.reboundMs &&
          this.peak < this.lastStrength * o.reboundRatio) {   // the rebound
        return;
      }

      this.lastStrikeAt = this.peakAt;
      this.lastStrength = this.peak;
      this.onStrike({ strength: this.peak, at: this.peakAt });
    }
  }

  async _loop() {
    const tick = () => {
      if (!this.running) return;
      this.step();
      requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * Learn this machine from a known number of strikes.
   *
   * Ask the user to type, say, 20 characters, record every candidate peak,
   * then work out the refractory window that yields exactly 20 events. This
   * beats any fixed default because it measures the actual rebound delay of
   * that particular machine.
   *
   * @param {number} expected how many strikes the user actually typed
   * @param {{at:number, strength:number}[]} peaks all candidates seen
   */
  static calibrate(expected, peaks) {
    if (!peaks.length || expected < 2) return null;

    const count = (refractory, ratio) => {
      let n = 0, lastAt = -1e9, lastS = 0;
      for (const p of peaks) {
        const gap = p.at - lastAt;
        if (gap < refractory) continue;
        if (gap < DEFAULTS.reboundMs && p.strength < lastS * ratio) continue;
        n++; lastAt = p.at; lastS = p.strength;
      }
      return n;
    };

    let best = null;
    for (let r = 40; r <= 260; r += 5) {
      for (let ratio = 0.5; ratio <= 1.0; ratio += 0.05) {
        const err = Math.abs(count(r, ratio) - expected);
        if (!best || err < best.err || (err === best.err && r < best.refractoryMs)) {
          best = { refractoryMs: r, reboundRatio: +ratio.toFixed(2), err };
        }
      }
      if (best?.err === 0) break;
    }
    return best;
  }

  /** Apply what calibrate() found. */
  apply(cal) {
    if (!cal) return;
    this.opt.refractoryMs = cal.refractoryMs;
    this.opt.reboundRatio = cal.reboundRatio;
    this.calibration = cal;
  }
}
