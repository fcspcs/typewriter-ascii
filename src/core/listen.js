/**
 * listen.js — count keystrokes by ear.
 *
 * WHAT WENT WRONG THE FIRST TIME, AND WHY IT WAS REBUILT
 *
 * The first version was a competent implementation driven by the wrong
 * clock. It read the spectrum from inside `requestAnimationFrame`, and
 * `AnalyserNode` hands you *the most recent fftSize samples at the moment
 * you ask* — a snapshot, not a stream. So the analysis windows were spaced
 * by whatever interval the compositor happened to deliver, which is
 * arbitrary, drifts continuously, and collapses to 30 fps whenever the page
 * is busy drawing. At 30 fps a 1024-point window at 48 kHz leaves 12 ms of
 * every 33 ms unexamined, and a type bar's transient is 5–10 ms long: a
 * strike could fall in the gap and be invisible, not merely below threshold.
 *
 * Measured, and this is the number that forced the rewrite: the same
 * recording, replayed through the old chain with nothing changed but the
 * arbitrary phase of the frame clock, produced counts differing by 9% on
 * medium typing and 19% on fast typing. That is a floor on accuracy that no
 * threshold tuning can lift, because the variation is not caused by the
 * sound. `docs/listening-research.md` has the measurements and the sources.
 *
 * WHAT THIS DOES INSTEAD
 *
 *   a) A FIXED HOP ON THE AUDIO CLOCK.
 *      An AudioWorklet hands us every block of samples, contiguously, and we
 *      cut it into 10 ms hops ourselves. Nothing is skipped, the spacing
 *      never varies, and event times come from counting samples rather than
 *      from `performance.now()` — i.e. when the sound happened, not when
 *      JavaScript got round to looking. 10 ms is what the onset-detection
 *      literature uses (Dixon 2006; Zhuang et al. 2005; Compagno et al.
 *      2017), and it is 2–3x finer than a frame.
 *
 *   b) SPECTRAL FLUX ON LINEAR MAGNITUDES, 500 Hz – 12 kHz.
 *      The old code differenced decibels, and a difference of decibels is a
 *      *ratio*: a near-silent bin that doubles contributed exactly as much
 *      as the loudest bin of the strike doubling. Measured, 75% of the old
 *      flux value came from the quietest half of the spectrum. Dixon 2006
 *      tested precisely this choice and rejected the logarithmic function in
 *      favour of linear magnitude. The band is now stated in hertz and
 *      converted with the real sample rate — the old `bandStart: 0.30` was a
 *      fraction of Nyquist, so it meant 6.6 kHz on one device and 7.2 kHz on
 *      another, and it discarded 62% of the strike's energy either way.
 *
 *   c) A ROBUST ADAPTIVE THRESHOLD AND A MINIMUM INTERVAL.
 *      Flux is scored against a running median and a running median absolute
 *      deviation, so the number that matters is "how far above the room is
 *      this, in units of how much the room normally wobbles". An onset is a
 *      local maximum of that score above the threshold, at least
 *      `minIntervalMs` after the last one — the recipe aubio, librosa and
 *      SuperFlux all converge on.
 *
 *   d) CARRIAGE-RETURN DETECTION.
 *      This is worth more than any amount of detector polish. A counter
 *      integrates its own errors without bound: even at 99.9% correct per
 *      strike, the column is wrong 40% of the time by the end of a page.
 *      Resetting at every line end caps the damage at one line. The carriage
 *      return is the loudest and longest event in normal typing — measured
 *      on real recordings, events of 250 ms or more sit 13 dB above ordinary
 *      strikes — so duration plus level identifies it without needing to
 *      know anything about the machine.
 *
 * WHY NOT MACHINE LEARNING
 *
 * It would work, but it is the wrong tool here. It needs labelled recordings
 * from every machine, ships megabytes of model, drains the battery, and when
 * it miscounts nobody can tell why. Onset detection is the standard approach
 * for percussive events, it is a few hundred lines, it runs anywhere, and
 * every parameter has a meaning you can explain and adjust.
 *
 * WHAT IS STILL UNPROVEN
 *
 * Every number here was fitted against public recordings of *other* manual
 * typewriters. Nobody has yet pointed this at an Olympia SM7. The refractory
 * interval, the carriage-return thresholds and the band edges are the
 * literature's values, not this machine's. `calibrate()` exists to replace
 * the first of them with a measurement.
 */

export const DEFAULTS = {
  /** Analysis window. 2048 at 48 kHz is 43 ms, in line with Dixon 2006. */
  fftSize: 2048,
  /** Distance between analysis windows, ms. The whole point of the rewrite. */
  hopMs: 10,
  /**
   * The band the keystroke actually lives in, in hertz.
   * Zhuang et al. 2005: "the energy of keystroke durations is mainly in the
   * frequencies between 400Hz and 12KHz". Below 500 Hz is hum, rumble and
   * voices; above 12 kHz there is little left and some microphones roll off.
   */
  bandLowHz: 500,
  bandHighHz: 12000,
  /** Sensitivity, 0…1. Higher means it takes less to trigger. */
  sensitivity: 0.55,
  /**
   * Minimum gap between two counted strikes, ms.
   *
   * aubio uses 50 ms, librosa 30 ms. This is longer because a type bar
   * rebounds off the platen, which a computer keyboard does not do. On real
   * recordings only 1.5% of detected intervals fall below this even during
   * fast typing, so it costs little. The rebound delay of *this* machine is
   * a measurement waiting to be made — see `calibrate()`.
   */
  minIntervalMs: 90,
  /**
   * How far below the recent strike level a sound may fall and still count,
   * dB. Above this it is a strike; below it, mechanism noise.
   *
   * This is the parameter that fixes the 2.5x over-count measured on a real
   * Olympia SM7 recording (22 strikes typed, 56 counted). Deliberately slow
   * typing, so every key had time to rebound before the next: 61 acoustic
   * events for 22 keystrokes. The 39 extras sat 6-20 dB below the strike
   * that caused them, 15-190 ms later - key returning, type bar falling
   * back, carriage advancing.
   *
   * A refractory window cannot separate those: measured on the same
   * recording, even 450 ms only reached 25, and 450 ms would make ordinary
   * typing impossible. Loudness can, because the mechanism is driven by the
   * strike and is always the quieter of the two.
   *
   * Honest caveat: fitted to ONE labelled recording. It is the only labelled
   * recording in existence for this project.
   */
  reboundDb: 8,
  /**
   * Half-life of the strike-level reference, seconds.
   *
   * Without decay the reference is set by the hardest strike ever heard and
   * everything softer is thrown away; measured, that gave 19 of 22. Decaying
   * it lets the detector follow a typist easing off, or the microphone being
   * moved, without opening the gate to mechanism noise inside a single
   * keystroke.
   */
  strikeRefHalfLifeS: 5,
  /**
   * How much history the running floor and spread are computed over, ms.
   *
   * Too short and the floor climbs into the typing itself: during sustained
   * fast typing more than half the recent frames contain strike energy, the
   * median rises with them, and the detector goes deaf exactly when it is
   * needed most. Two seconds keeps a majority of quiet frames in the window
   * at any realistic typing speed.
   */
  floorWindowMs: 2000,
  /** Threshold in units of median absolute deviation above the floor. */
  deltaLow: 3,
  deltaHigh: 14,

  /* ── carriage return ─────────────────────────────────────────── */

  /**
   * Resolution of the loudness envelope the carriage-return test runs on, ms.
   *
   * Deliberately much finer than the analysis hop. The first attempt reused
   * the level of the 43 ms FFT frame and it failed for a reason worth
   * recording: a window that long smears each strike across its whole width,
   * so five quick strikes read as one continuous 600 ms roar and every burst
   * of fast typing announced itself as a line end.
   */
  envelopeMs: 5,
  /** A loud stretch must last this long to be a line end, ms. */
  returnMinMs: 250,
  /**
   * Longest quiet gap tolerated inside one loud stretch, ms.
   *
   * Small on purpose. A carriage return is genuinely continuous — lever,
   * travel, margin stop — whereas consecutive keystrokes have real silence
   * between them even at speed. This is the number that decides whether the
   * two are told apart, so it is kept below the shortest gap typing leaves.
   */
  returnGapMs: 25,
  /**
   * How far above the room counts as "loud", dB.
   *
   * Swept on three real recordings. At 10 dB the reverberant tail of one
   * strike never falls back below the gate before the next arrives, so a run
   * of typing merges into one long stretch and the detector reports a line
   * end every two or three seconds — which no typist produces. At 14 dB the
   * reported count settles at roughly one every ten seconds, which is the
   * same order as the count of events of 250 ms or more that the research
   * measured by a completely separate route. At 18 dB it finds almost
   * nothing. Honest caveat: none of those recordings is labelled, so this is
   * a plausibility argument, not a hit rate.
   */
  returnLoudDb: 14,
  /**
   * How far above an ordinary strike the stretch has to peak, dB.
   *
   * Measured separation between events of 250 ms or more and events of
   * 100 ms or less, on real manual-typewriter recordings, is 13 dB. Rather
   * less than that is asked for, because the point of the test is only to
   * reject the one thing duration alone cannot: a long quiet noise, such as
   * a chair moving. Fast typing is rejected by the gap rule above.
   */
  returnLevelDb: 4,
  /** A loud stretch this short is taken as an ordinary strike, for scale. */
  strikeMaxMs: 150,
  /**
   * How many ordinary strikes must have been heard before any line end is
   * reported at all.
   *
   * Nothing can be "louder than an ordinary strike" until ordinary strikes
   * have been heard, and guessing at an absolute level instead would make
   * the answer depend on the microphone and on how far away the phone is
   * lying. Costs nothing in practice: a line of typing supplies forty of
   * them before its own carriage return arrives.
   */
  strikesBeforeReturn: 5,
};

/**
 * The meter in the UI is drawn in these units: score, in median absolute
 * deviations above the running floor. A solid strike lands around 30–60.
 */
export const METER_FULL_SCALE = 60;

/**
 * A real FFT, because the browser does not offer one outside AnalyserNode
 * and AnalyserNode is the thing we are getting away from.
 *
 * Iterative radix-2 Cooley-Tukey, twiddles and bit-reversal precomputed once.
 * At a 10 ms hop this runs 100 times a second on 2048 points, which is
 * nothing on any device made this century.
 */
class FFT {
  constructor(n) {
    this.n = n;
    const levels = Math.round(Math.log2(n));
    if (1 << levels !== n) throw new Error('fftSize must be a power of two');

    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let x = i, r = 0;
      for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }

  /**
   * Magnitude spectrum of `input` (length n) after windowing, into `out`
   * (length n/2 + 1). Linear magnitudes: no decibels anywhere.
   */
  magnitudes(input, window, out) {
    const { n, re, im, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      re[i] = input[j] * window[j];
      im[i] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.hypot(re[i], im[i]);
  }
}

/**
 * A sliding window with robust statistics.
 *
 * Median and median absolute deviation rather than mean and standard
 * deviation, because the strikes are in the window too and they are exactly
 * the outliers a mean would chase.
 */
class Robust {
  constructor(size) {
    this.size = Math.max(4, size | 0);
    this.buf = new Float64Array(this.size);
    this.n = 0;
    this.i = 0;
    this.scratch = new Float64Array(this.size);
  }

  push(v) {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.size;
    if (this.n < this.size) this.n++;
  }

  /** @param {number} p 0…1 */
  quantile(p) {
    const n = this.n;
    if (!n) return 0;
    const s = this.scratch.subarray(0, n);
    s.set(this.buf.subarray(0, n));
    Array.prototype.sort.call(s, (a, b) => a - b);
    return s[Math.min(n - 1, Math.floor(p * n))];
  }

  get median() { return this.quantile(0.5); }

  /** Median absolute deviation from the median. */
  mad() {
    const n = this.n;
    if (!n) return 0;
    const m = this.median;
    const s = this.scratch.subarray(0, n);
    for (let k = 0; k < n; k++) s[k] = Math.abs(this.buf[k] - m);
    Array.prototype.sort.call(s, (a, b) => a - b);
    return s[n >> 1];
  }
}

/**
 * The detector proper: audio in, events out. Deliberately knows nothing
 * about the Web Audio API, so the tests can push a synthesised recording
 * through the identical code path the microphone uses.
 *
 * Feed it contiguous samples with `push()`. It frames them itself, so the
 * hop is exact regardless of how the caller chops up the stream.
 */
export class StrikeDetector {
  /**
   * @param {number} sampleRate
   * @param {Object} [opt] see DEFAULTS, plus:
   * @param {(e:{strength:number, at:number, level:number}) => void} [opt.onStrike]
   * @param {(e:{at:number, durationMs:number, level:number, strikesInside:number}) => void} [opt.onReturn]
   * @param {(e:{flux:number, threshold:number, level:number}) => void} [opt.onFrame]
   */
  constructor(sampleRate, opt = {}) {
    this.opt = { ...DEFAULTS, ...opt };
    this.sampleRate = sampleRate;
    this.onStrike = opt.onStrike ?? (() => {});
    this.onReturn = opt.onReturn ?? (() => {});
    this.onFrame = opt.onFrame ?? (() => {});

    const n = this.opt.fftSize;
    this.fft = new FFT(n);
    // Hann, the conventional choice for overlapping analysis. AnalyserNode
    // used to impose Blackman on us; owning the window is part of the point.
    this.window = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    }

    this.hop = Math.max(1, Math.round((sampleRate * this.opt.hopMs) / 1000));
    this.ring = new Float64Array(n);
    this.frame = new Float64Array(n);
    this.mag = new Float64Array(n / 2 + 1);
    this.prevMag = new Float64Array(n / 2 + 1);

    // Band edges as bin indices, from the real sample rate. The same code
    // therefore listens to the same *frequencies* on every device.
    const perBin = sampleRate / n;
    this.binLo = Math.max(1, Math.floor(this.opt.bandLowHz / perBin));
    this.binHi = Math.min(n / 2, Math.ceil(this.opt.bandHighHz / perBin));

    const frames = Math.max(8, Math.round(this.opt.floorWindowMs / this.opt.hopMs));
    this.fluxWindow = new Robust(frames);

    // The loudness envelope keeps its own, much finer, grid.
    this.envHop = Math.max(1, Math.round((sampleRate * this.opt.envelopeMs) / 1000));
    const envFrames = Math.max(8, Math.round(this.opt.floorWindowMs / this.opt.envelopeMs));
    this.envWindow = new Robust(envFrames);
    this.strikePeaks = new Robust(24);

    this.reset();
  }

  reset() {
    this.ring.fill(0);
    this.prevMag.fill(0);
    this.write = 0;
    this.sinceHop = 0;
    this.samples = 0;
    this.frames = 0;
    this.warm = false;

    // one-frame lookahead, so an onset is a genuine local maximum
    this.s1 = 0; this.t1 = 0; this.thr1 = 0;
    this.s2 = 0;
    this.lastStrikeAt = -1e9;
    this.lastMeterAt = -1e9;
    this.level = -200;

    // envelope accumulator
    this.envSum = 0;
    this.envN = 0;
    this.quiet = -200;
    this.quietDue = 0;

    // Reference level of a real strike, and when it was last updated.
    // null until the first strike has been heard.
    this.strikeRef = null;
    this.strikeRefAt = 0;
    // Short peak-hold of the envelope, so the level compared against the
    // reference is the strike's own peak and not whatever the envelope
    // happened to read on the exact frame the flux peaked.
    this.peakHold = -200;
    this.peakHoldAt = -1e9;

    // the loud stretch currently open, if any
    this.loudSince = null;
    this.loudLast = 0;
    this.loudPeak = -Infinity;
    this.loudStrikes = 0;
  }

  get sensitivity() { return this.opt.sensitivity; }
  set sensitivity(v) { this.opt.sensitivity = Math.min(1, Math.max(0, v)); }

  /** Threshold in MAD units, from the sensitivity slider. */
  get delta() {
    const { deltaLow, deltaHigh, sensitivity } = this.opt;
    return deltaHigh + (deltaLow - deltaHigh) * sensitivity;
  }

  /**
   * Contiguous audio. Any length; the framing is ours, not the caller's.
   * @param {Float32Array|Float64Array|number[]} samples
   */
  push(samples) {
    const n = this.opt.fftSize;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      this.ring[this.write] = s;
      this.write = (this.write + 1) % n;
      this.samples++;

      this.envSum += s * s;
      if (++this.envN >= this.envHop) {
        const at = (this.samples / this.sampleRate) * 1000;
        this.level = 10 * Math.log10(this.envSum / this.envN + 1e-20);
        this.envSum = 0;
        this.envN = 0;
        // Peak-hold over the last 40 ms. The onset test runs one frame
        // behind the audio, so by the time a strike is judged its true peak
        // has already passed through here.
        if (this.level > this.peakHold || at - this.peakHoldAt > 40) {
          this.peakHold = this.level;
          this.peakHoldAt = at;
        }
        this._carriage(this.level, at);
      }

      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        // Only analyse once the ring holds a full window of real audio,
        // otherwise the first frames measure the silence we started with.
        if (this.samples >= n) this._analyse();
      }
    }
  }

  /** One analysis window, ending at the newest sample in the ring. */
  _analyse() {
    const n = this.opt.fftSize;
    for (let i = 0; i < n; i++) this.frame[i] = this.ring[(this.write + i) % n];
    this.fft.magnitudes(this.frame, this.window, this.mag);

    let flux = 0;
    for (let i = this.binLo; i < this.binHi; i++) {
      // Half-wave rectified difference of *linear* magnitudes. A fall is the
      // sound decaying, and decay is not an onset.
      const d = this.mag[i] - this.prevMag[i];
      if (d > 0) flux += d;
    }
    const tmp = this.prevMag; this.prevMag = this.mag; this.mag = tmp;

    // The window ends at the newest sample, so this timestamp lags the sound
    // by up to one window. It is a constant offset on the audio clock, so
    // intervals — which is all the counting uses — are unaffected.
    const at = (this.samples / this.sampleRate) * 1000;

    this.frames++;
    if (this.frames === 1) { this.warm = false; return; }  // no previous frame
    this.warm = true;
    this._score(flux, this.level, at);
  }

  /**
   * Score one flux value and decide. Separate from the FFT so tests can
   * drive the peak picker directly with a made-up detection function.
   */
  _score(flux, level, at) {
    this.fluxWindow.push(flux);

    const floor = this.fluxWindow.median;
    const spread = this.fluxWindow.mad() || 1e-12;
    const score = (flux - floor) / spread;
    const threshold = this.delta;

    if (at - this.lastMeterAt >= 50) {
      this.lastMeterAt = at;
      this.onFrame({ flux: score, threshold, level });
    }

    // Peak picking with one frame of lookahead: the frame we are judging is
    // the previous one, and it only counts if it is higher than both of its
    // neighbours. A sharp transient that straddles two frames used to defeat
    // the old one-frame slope test entirely — measured, it dropped the
    // strike outright at 3 of 12 phases.
    const prev = this.s1;
    const prevAt = this.t1;
    const prevThr = this.thr1;
    const before = this.s2;
    this.s2 = this.s1;
    this.s1 = score;
    this.t1 = at;
    this.thr1 = threshold;

    if (this.frames < 4) return;
    if (prev <= prevThr) return;
    if (!(prev > before && prev >= score)) return;
    if (prevAt - this.lastStrikeAt < this.opt.minIntervalMs) return;

    /*
     * Is this a strike, or the machine coming back to rest?
     *
     * Spectral flux answers "did something start here", and a key returning
     * starts a sound just as definitely as a key being struck. Only loudness
     * tells them apart: the mechanism is driven by the strike and is always
     * the quieter of the two.
     */
    const peak = Math.max(this.peakHold, this.level);
    if (this.strikeRef !== null) {
      const elapsed = (prevAt - this.strikeRefAt) / 1000;
      const ref = this.strikeRef
        - (6 * elapsed) / this.opt.strikeRefHalfLifeS;
      if (peak < ref - this.opt.reboundDb) return;
      this.strikeRef = Math.max(ref, peak);
    } else {
      this.strikeRef = peak;
    }
    this.strikeRefAt = prevAt;

    this.lastStrikeAt = prevAt;
    if (this.loudSince !== null) this.loudStrikes++;
    this.onStrike({ strength: prev, at: prevAt, level });
    return prev;
  }

  /**
   * Carriage return: a stretch of loud that is far too long to be a strike.
   *
   * Reported when the stretch *ends*, which is also when the carriage has
   * arrived and the next line is ready — so the delay is honest rather than
   * awkward. `strikesInside` lets the caller undo whatever the clatter of
   * the return added to the count before resetting it.
   */
  _carriage(level, at) {
    const o = this.opt;
    this.envWindow.push(level);
    // The 20th percentile rather than the median, because during steady
    // typing the median of the envelope is already halfway up a keystroke.
    // Recomputed a few times a second rather than every 5 ms: sorting the
    // window is the most expensive thing in the file, and a room does not
    // change its noise floor within a tenth of a second.
    if (--this.quietDue <= 0) {
      this.quietDue = Math.max(1, Math.round(100 / o.envelopeMs));
      this.quiet = this.envWindow.quantile(0.2);
    }
    const quiet = this.quiet;

    if (level > quiet + o.returnLoudDb) {
      if (this.loudSince === null) {
        this.loudSince = at;
        this.loudPeak = -Infinity;
        this.loudStrikes = 0;
      }
      this.loudLast = at;
      if (level > this.loudPeak) this.loudPeak = level;
      return;
    }

    if (this.loudSince === null) return;
    if (at - this.loudLast < o.returnGapMs) return;   // a gap, not the end

    const durationMs = this.loudLast - this.loudSince;
    const start = this.loudSince;
    const strikes = this.loudStrikes;
    const peak = this.loudPeak;
    this.loudSince = null;

    // Short stretches are what an ordinary keystroke looks like on this
    // envelope. Remembering how loud they are gives the long-stretch test
    // something to be measured against that is specific to this machine, this
    // microphone and this distance — none of which we can know in advance.
    if (durationMs <= o.strikeMaxMs) {
      if (peak > quiet + o.returnLoudDb) this.strikePeaks.push(peak);
      return;
    }
    if (durationMs < o.returnMinMs) return;
    if (this.strikePeaks.n < o.strikesBeforeReturn) return;
    if (peak < this.strikePeaks.median + o.returnLevelDb) return;

    this.onReturn({ at: start, durationMs, level: peak, strikesInside: strikes });
  }
}

/**
 * Line bookkeeping: how far along the line we think we are, and how much we
 * should be believed.
 *
 * The failure mode here is asymmetric and severe. The typist is looking at
 * the paper, not at the screen, and the machine has no undo — so a display
 * that is quietly one column out is worse than no display at all, while one
 * that says "lost" is merely annoying. This is the piece that refuses to
 * guess.
 */
export class LineTracker {
  /**
   * @param {Object} [opt]
   * @param {number} [opt.tolerance] strikes of disagreement at a line end
   *   that are still forgiven
   */
  constructor(opt = {}) {
    this.tolerance = opt.tolerance ?? 1;
    this.expected = 0;
    this.count = 0;
    this.lost = false;
    /** Signed error at each completed line: heard minus expected. */
    this.errors = [];
  }

  /** Start a line of `expected` strikes. */
  begin(expected) {
    this.expected = expected;
    this.count = 0;
    return this;
  }

  /** One strike heard. Returns the column we believe we are at. */
  strike(n = 1) {
    this.count = Math.max(0, this.count + n);
    return this.count;
  }

  /**
   * The carriage came back. Compare what we heard against what the line
   * actually holds, then reset regardless — that reset is the whole reason
   * carriage-return detection is worth building, because it turns an error
   * that would otherwise accumulate over a page into one confined to a line.
   *
   * @param {number} [inside] strikes counted during the return itself,
   *   which were mechanism noise rather than typing
   */
  lineEnd(inside = 0) {
    const heard = Math.max(0, this.count - inside);
    const error = heard - this.expected;
    this.errors.push(error);
    this.lost = Math.abs(error) > this.tolerance;
    this.count = 0;
    return { expected: this.expected, heard, error, lost: this.lost };
  }

  /** The user said where they are. Believe them. */
  resolve(count = 0) {
    this.count = Math.max(0, count);
    this.lost = false;
    return this.count;
  }

  /**
   * How wrong the count has been lately, in strikes per line. Meant for
   * telling the user what to expect, and — once there is real data behind
   * it — for adapting the threshold.
   */
  get drift() {
    if (!this.errors.length) return 0;
    const last = this.errors.slice(-5);
    return last.reduce((a, b) => a + b, 0) / last.length;
  }
}

/**
 * The microphone end: acquire the stream, get the samples onto a fixed grid,
 * hand them to a StrikeDetector.
 */
export class StrikeListener {
  constructor(opt = {}) {
    this.opt = { ...DEFAULTS, ...opt };
    this.onStrike = opt.onStrike ?? (() => {});
    this.onReturn = opt.onReturn ?? (() => {});
    this.onFrame = opt.onFrame ?? (() => {});

    this.ctx = null;
    this.stream = null;
    this.detector = null;
    this.running = false;
    /** Set if the browser refused to give us the raw signal. */
    this.warning = null;
    /** 'worklet' or 'script', useful when something is wrong in the field. */
    this.path = null;
    /** Set when calibrate() has measured this machine. */
    this.calibration = null;
  }

  get sensitivity() { return this.opt.sensitivity; }
  set sensitivity(v) {
    this.opt.sensitivity = Math.min(1, Math.max(0, v));
    if (this.detector) this.detector.sensitivity = this.opt.sensitivity;
  }

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // All three would smooth away exactly what we are looking for, and
        // there is direct evidence for the middle one: Harrison et al. 2023
        // found keystroke isolation became much harder with Zoom's noise
        // suppression on, because it moved the levels around unpredictably.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    // Asking is not the same as getting: a source that cannot turn a feature
    // off is allowed to report it as still on. Worth knowing about, because
    // it explains a whole class of "it counts nothing" reports.
    const settings = this.stream.getAudioTracks?.()[0]?.getSettings?.() ?? {};
    const refused = ['echoCancellation', 'noiseSuppression', 'autoGainControl']
      .filter((k) => settings[k] === true);
    this.warning = refused.length
      ? `This browser insisted on ${refused.join(', ')}. Counting will be less reliable.`
      : null;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    // iOS starts every context suspended and only lets a user gesture wake
    // it. start() is always called from the listen button, so this is that
    // gesture.
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.detector = new StrikeDetector(this.ctx.sampleRate, {
      ...this.opt,
      onStrike: (e) => this.onStrike(e),
      onReturn: (e) => this.onReturn(e),
      onFrame: (e) => this.onFrame(e),
    });

    const src = this.ctx.createMediaStreamSource(this.stream);
    this.running = true;
    try {
      await this._viaWorklet(src);
    } catch {
      // Worklets need a fetchable module, which rules out pages opened
      // straight off the disk, and older browsers do not have them at all.
      // ScriptProcessorNode is deprecated but it delivers every block
      // contiguously, which is the only property that actually matters here.
      this._viaScriptProcessor(src);
    }
  }

  /** The intended path: samples arrive from the audio thread, gap-free. */
  async _viaWorklet(src) {
    if (!this.ctx.audioWorklet) throw new Error('no AudioWorklet');
    // Resolved against this module rather than against the page, so the
    // worklet is found wherever the app is deployed. `addModule` is
    // specified to take a string, so the URL is stringified here rather
    // than relying on every engine to do it.
    await this.ctx.audioWorklet.addModule(
      new URL('./tap-worklet.js', import.meta.url).href);
    const node = new AudioWorkletNode(this.ctx, 'strike-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { block: this.detector.hop },
    });
    node.port.onmessage = (e) => {
      if (this.running) this.detector.push(new Float32Array(e.data));
    };
    src.connect(node);
    this.node = node;
    this.path = 'worklet';
  }

  /** The fallback. Same contiguity guarantee, older machinery. */
  _viaScriptProcessor(src) {
    const size = 1024;
    const node = this.ctx.createScriptProcessor(size, 1, 1);
    node.onaudioprocess = (e) => {
      if (this.running) this.detector.push(e.inputBuffer.getChannelData(0));
    };
    // Some browsers only run a ScriptProcessor if its output goes somewhere,
    // so it feeds a silent gain node rather than the speakers.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    src.connect(node);
    node.connect(mute);
    mute.connect(this.ctx.destination);
    this.node = node;
    this.mute = mute;
    this.path = 'script';
  }

  stop() {
    this.running = false;
    if (this.node) {
      this.node.onaudioprocess = null;
      if (this.node.port) this.node.port.onmessage = null;
      this.node.disconnect();
    }
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.detector = null;
  }

  /**
   * Learn this machine from a known number of strikes.
   *
   * Ask the user to type, say, 20 characters with the interval gate wide
   * open, record every candidate peak, then find the shortest interval that
   * yields exactly 20 events. That measures the actual rebound delay of that
   * particular typewriter, which is the one number in here that no amount of
   * reading the literature can supply — computer keyboards, which is what
   * every paper measured, do not have type bars that bounce off a platen.
   *
   * @param {number} expected how many strikes the user actually typed
   * @param {{at:number}[]} peaks all candidates seen
   */
  static calibrate(expected, peaks) {
    if (!peaks.length || expected < 2) return null;

    const count = (interval) => {
      let n = 0, lastAt = -1e9;
      for (const p of peaks) {
        if (p.at - lastAt < interval) continue;
        n++; lastAt = p.at;
      }
      return n;
    };

    let best = null;
    for (let ms = 20; ms <= 300; ms += 5) {
      const err = Math.abs(count(ms) - expected);
      if (!best || err < best.err) best = { minIntervalMs: ms, err };
      if (best.err === 0) break;
    }
    return best;
  }

  /** Apply what calibrate() found. */
  apply(cal) {
    if (!cal?.minIntervalMs) return;
    this.opt.minIntervalMs = cal.minIntervalMs;
    if (this.detector) this.detector.opt.minIntervalMs = cal.minIntervalMs;
    this.calibration = cal;
  }
}
