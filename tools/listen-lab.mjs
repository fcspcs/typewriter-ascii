/**
 * listen-lab.mjs — point the real strike detector at real recordings.
 *
 * The research document ends on an honest admission: every number in
 * `listen.js` was fitted to recordings of *other* machines, and the one
 * labelled recording of the actual Olympia SM7 is a single 22-strike take.
 * This tool exists for the day that changes — a folder of WAV files, each
 * with a known count typed into `labels.json`, is a dataset, and fitting
 * the detector's few readable parameters against it is the honest version
 * of "training".
 *
 *   node tools/listen-lab.mjs count recordings/twenty-M.wav --expect 20
 *   node tools/listen-lab.mjs eval  recordings
 *   node tools/listen-lab.mjs fit   recordings
 *
 * `count` runs one file and shows every event, so a miscount can be traced
 * to the event that caused it. `eval` scores the whole folder against its
 * labels. `fit` searches sensitivity, the minimum interval and the rebound
 * gate for the combination that gets the counts right — and then re-runs
 * the winner through the untouched detector, because a fast search that
 * quietly diverged from the real code path would be worse than a slow one.
 *
 * Labels are plain JSON, one entry per file:
 *
 *   {
 *     "twenty-M.wav":  { "strikes": 20, "returns": 0, "notes": "same key, slow" },
 *     "full-line.wav": { "strikes": 40, "returns": [0, 1] }
 *   }
 *
 * `strikes` is what was actually typed — spaces are keystrokes too. Strikes
 * the detector counts during a carriage return's own clatter are subtracted
 * before comparing, the same correction `LineTracker.lineEnd()` applies.
 * `returns` may be exact, a [min, max] range when memory is honest about
 * its limits, or null to leave it unscored.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrikeDetector, StrikeListener, DEFAULTS } from '../src/core/listen.js';
import { readWav } from './wav.mjs';

/* ── running the real detector ───────────────────────────────── */

/** Feed a recording to an untouched StrikeDetector. The ground truth path. */
function direct(samples, sampleRate, opt = {}) {
  const strikes = [];
  const returns = [];
  const d = new StrikeDetector(sampleRate, {
    ...opt,
    onStrike: (e) => strikes.push(e),
    onReturn: (e) => returns.push(e),
  });
  for (let i = 0; i < samples.length; i += 4096) {
    d.push(samples.subarray(i, Math.min(i + 4096, samples.length)));
  }
  // The recording is over; a return still being gathered is complete now.
  d.flush();
  return { strikes, returns };
}

/** Strikes counted inside a return's clatter are mechanism, not typing. */
function effective(strikes, returns) {
  let inside = 0;
  for (const r of returns) {
    inside += strikes.filter((s) => s.at >= r.at && s.at <= r.at + r.durationMs).length;
  }
  return strikes.length - inside;
}

/* ── the fast path for fitting ───────────────────────────────── */

/**
 * One capture pass per file: run the full detector once and record what
 * `_score` and `_carriage` were given — flux, level, peak-hold and time on
 * the analysis grid, level and time on the envelope grid. Everything
 * upstream of those two (the FFT, the band, the RMS envelope) does not
 * depend on any parameter the fit searches, so it need only run once.
 */
function capture(samples, sampleRate) {
  const frames = [];
  const env = [];
  const returns = [];
  const strikes = [];
  const d = new StrikeDetector(sampleRate, {
    onStrike: (e) => strikes.push(e),
    onReturn: (e) => returns.push(e),
  });
  const score = d._score.bind(d);
  d._score = (flux, level, at, ...rest) => {
    frames.push({ flux, level, peakHold: d.peakHold, at, rest });
    score(flux, level, at, ...rest);
  };
  const carriage = d._carriage.bind(d);
  d._carriage = (level, at) => {
    env.push({ level, at });
    carriage(level, at);
  };
  for (let i = 0; i < samples.length; i += 4096) {
    d.push(samples.subarray(i, Math.min(i + 4096, samples.length)));
  }
  d.flush();
  // The capture ran with DEFAULTS, so its counts are a known answer the
  // replay must reproduce exactly. If it cannot, the replay has diverged
  // from the real code and nothing it reports can be trusted.
  return {
    frames, env, returns,
    defaultCount: strikes.length,
    defaultReturns: returns.length,
    sampleRate,
  };
}

/**
 * The floor and spread of the flux depend only on the flux itself — not on
 * sensitivity, not on the interval, not on the rebound gate. Computing them
 * once per file is what makes a parameter grid affordable. This mirrors the
 * Robust window in listen.js; `fit` verifies the mirror against the
 * original on every file before believing anything.
 */
function fluxStats(frames, opt) {
  const size = Math.max(8, Math.round(opt.floorWindowMs / opt.hopMs));
  const buf = [];
  const floors = new Float64Array(frames.length);
  const spreads = new Float64Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    buf.push(frames[i].flux);
    if (buf.length > size) buf.shift();
    const s = [...buf].sort((a, b) => a - b);
    floors[i] = s[Math.min(s.length - 1, Math.floor(0.5 * s.length))];
    const m = floors[i];
    const dev = buf.map((v) => Math.abs(v - m)).sort((a, b) => a - b);
    spreads[i] = dev[buf.length >> 1];
  }
  return { floors, spreads };
}

/**
 * Replay the captured series through the *real* `_score` and `_carriage`,
 * with the flux statistics served from precomputed arrays. The decision
 * logic — peak picking, refractory interval, rebound gate, loud-stretch
 * segmentation — is the untouched original; only the per-frame flux
 * sorting is bypassed. The envelope window is not even stubbed: its
 * statistics are cheap, so the real Robust window runs as-is.
 *
 * The two series are interleaved by time, envelope first on a tie, which
 * is the order `push()` produces them in. `framesToo: false` replays the
 * envelope alone — of limited use now that the return test's loudness
 * reference is fed by accepted strikes, but kept for experiments.
 */
function replay(cap, stats, opt, { framesToo = true } = {}) {
  const strikes = [];
  const returns = [];
  const d = new StrikeDetector(cap.sampleRate, {
    ...opt,
    onStrike: (e) => strikes.push(e),
    onReturn: (e) => returns.push(e),
  });
  let i = 0;
  d.fluxWindow = {
    push() {},
    get median() { return stats.floors[i]; },
    mad() { return stats.spreads[i]; },
  };
  // The first captured frame was the detector's second (_analyse skips the
  // very first, having no previous spectrum). Start the counter one on, so
  // the warm-up guard in _score fires at the same frames as in the original.
  d.frames = 1;
  let fi = 0;
  for (let ei = 0; ei < cap.env.length || fi < cap.frames.length;) {
    const e = ei < cap.env.length ? cap.env[ei] : null;
    const f = framesToo && fi < cap.frames.length ? cap.frames[fi] : null;
    if (e && (!f || e.at <= f.at)) {
      StrikeDetector.prototype._carriage.call(d, e.level, e.at);
      ei++;
    } else if (f) {
      i = fi;
      d.frames++;
      d.level = f.level;
      d.peakHold = f.peakHold;
      StrikeDetector.prototype._score.call(d, f.flux, f.level, f.at, ...f.rest);
      fi++;
    } else break;
  }
  d.flush();
  return {
    count: strikes.length,
    returns: returns.length,
    returnEvents: returns,
    effective: effective(strikes, returns),
  };
}

/* ── labels ──────────────────────────────────────────────────── */

function loadLabels(dir) {
  const path = join(dir, 'labels.json');
  if (!existsSync(path)) {
    console.error(`No ${path}. See recordings/README.md for the format.`);
    process.exit(1);
  }
  const labels = JSON.parse(readFileSync(path, 'utf8'));
  const files = Object.keys(labels).filter((f) => {
    if (existsSync(join(dir, f))) return true;
    console.error(`  (skipping ${f}: labelled but not found)`);
    return false;
  });
  if (!files.length) {
    console.error('No labelled recordings found.');
    process.exit(1);
  }
  return { labels, files };
}

/**
 * Return labels may be exact (10), a range ([0, 1] — "I may or may not have
 * pulled the lever at the end"), or null for "no idea, do not score it".
 * A range is honest ground truth too: it forbids 13 as firmly as 10 does.
 */
function returnBounds(v) {
  if (v == null) return null;
  return Array.isArray(v) ? v : [v, v];
}

function boundsErr(n, b) {
  if (!b) return 0;
  return n < b[0] ? b[0] - n : n > b[1] ? n - b[1] : 0;
}

function boundsStr(b) {
  if (!b) return '?';
  return b[0] === b[1] ? String(b[0]) : `${b[0]}–${b[1]}`;
}

/* ── commands ────────────────────────────────────────────────── */

function fmtMs(ms) {
  return `${(ms / 1000).toFixed(2).padStart(7)}s`;
}

function cmdCount(file, flags) {
  const { samples, sampleRate, seconds } = readWav(file);
  const opt = optFromFlags(flags);
  const { strikes, returns } = direct(samples, sampleRate, opt);
  const eff = effective(strikes, returns);

  console.log(`${file}: ${seconds.toFixed(1)} s at ${sampleRate} Hz`);
  if (flags.events) {
    for (const s of strikes) {
      console.log(`  strike ${fmtMs(s.at)}  score ${s.strength.toFixed(1).padStart(6)}`
        + `  level ${s.level.toFixed(1)} dB`);
    }
    for (const r of returns) {
      console.log(`  RETURN ${fmtMs(r.at)}  ${r.durationMs.toFixed(0)} ms, ${r.strikesInside} strikes inside`);
    }
  }
  console.log(`  strikes counted:   ${strikes.length}${eff !== strikes.length ? ` (${eff} outside carriage returns)` : ''}`);
  console.log(`  carriage returns:  ${returns.length}`);

  if (flags.expect != null) {
    const err = eff - flags.expect;
    console.log(`  expected:          ${flags.expect}  →  ${err === 0 ? 'exact' : (err > 0 ? `+${err} over` : `${err} under`)}`);
    // With the gates open, every candidate peak is visible; calibrate() can
    // then say which minimum interval would have produced the right count.
    if (flags.raw) {
      const cal = StrikeListener.calibrate(flags.expect, strikes);
      if (cal) {
        console.log(`  calibrate():       minIntervalMs ${cal.minIntervalMs}`
          + (cal.err ? ` (still ${cal.err} off — the interval alone cannot fix this take)` : ' reproduces the count exactly'));
      }
    }
  }
}

function cmdEval(dir, flags) {
  const { labels, files } = loadLabels(dir);
  const opt = optFromFlags(flags);
  let totalErr = 0;
  let exact = 0;

  // Say what was measured. A table of numbers that does not name the
  // parameters behind them invites exactly the mistake this line was added
  // to end: eval used to build no options at all, so it answered for the
  // defaults however it was called, and two runs that should have differed
  // came out identical.
  const named = Object.keys(opt).map((k) => `${k} ${opt[k]}`).join(', ');
  console.log(named
    ? `With ${named}; everything else as it stands in listen.js.\n`
    : 'With the values as they stand in listen.js.\n');

  console.log('file                              expected   heard   error   returns');
  for (const f of files) {
    const want = labels[f];
    const { samples, sampleRate } = readWav(join(dir, f));
    const { strikes, returns } = direct(samples, sampleRate, opt);
    const eff = effective(strikes, returns);
    const err = eff - (want.strikes ?? 0);
    totalErr += Math.abs(err);
    if (err === 0) exact++;
    const rb = returnBounds(want.returns);
    const rMark = boundsErr(returns.length, rb) === 0
      ? `${returns.length} ✓`
      : `${returns.length} (wanted ${boundsStr(rb)})`;
    console.log(
      f.padEnd(34)
      + String(want.strikes ?? 0).padStart(8)
      + String(eff).padStart(8)
      + (err === 0 ? '       ✓' : String(err > 0 ? `+${err}` : err).padStart(8))
      + '   ' + rMark,
    );
  }
  console.log(`\n${exact} of ${files.length} files exact; total miscount ${totalErr} strikes.`);
  if (exact < files.length) {
    console.log('Run `node tools/listen-lab.mjs fit ' + dir + '` to search for better parameters.');
  }
}

function cmdFit(dir, flags) {
  const { labels, files } = loadLabels(dir);

  console.log(`Capturing ${files.length} recordings through the full detector…`);
  const caps = files.map((f) => {
    const { samples, sampleRate, seconds } = readWav(join(dir, f));
    const cap = capture(samples, sampleRate);
    const stats = fluxStats(cap.frames, DEFAULTS);
    // The replay must reproduce the capture's own counts under DEFAULTS
    // before its answers under any other parameters mean anything.
    const check = replay(cap, stats, {});
    if (check.count !== cap.defaultCount || check.returns !== cap.defaultReturns) {
      console.error(`  ${f}: replay says ${check.count} strikes / ${check.returns} returns, `
        + `detector said ${cap.defaultCount} / ${cap.defaultReturns} — fast path is wrong, refusing to fit.`);
      process.exit(1);
    }
    console.log(`  ${f}: ${seconds.toFixed(1)} s, ${cap.defaultCount} strikes, ${cap.defaultReturns} returns under current defaults`);
    return { f, cap, stats, want: labels[f].strikes ?? 0, bounds: returnBounds(labels[f].returns) };
  });

  /** Every combination of the given axes: [['key', [values]], …]. */
  const grid = (axes) => axes.reduce(
    (combos, [key, values]) => combos.flatMap((c) => values.map((v) => ({ ...c, [key]: v }))),
    [{}],
  );

  const around = (v, steps, lo, hi) => [...new Set(
    steps.map((s) => Math.min(hi, Math.max(lo, v + s))),
  )];

  /**
   * Lowest cost wins; among ties, prefer the middle of a plateau — a
   * parameter set whose neighbours also get the counts right will survive
   * the next recording — and then the least movement from the defaults,
   * because numbers should only change when the recordings say they must.
   */
  const pick = (results, near, churn) => {
    const bestErr = Math.min(...results.map((r) => r.err));
    const winners = results.filter((r) => r.err === bestErr);
    for (const w of winners) {
      w.support = winners.filter((v) => v !== w && near(v.opt, w.opt)).length;
      w.churn = churn(w.opt);
    }
    winners.sort((a, b) => b.support - a.support || a.churn - b.churn);
    return { best: winners[0], ties: winners.length };
  };

  /* ── stage one: the carriage return ──────────────────────────── */

  // The return fit runs first, with the strike parameters at their current
  // defaults: the loudness reference a return is judged against comes from
  // accepted strikes, and which loud strikes are accepted barely moves
  // across the strike grid. It must come first regardless — the effective
  // strike count subtracts whatever was heard inside a detected return, so
  // the strike fit is only meaningful once the returns are settled.
  const rCost = (opt) => {
    let sum = 0;
    for (const c of caps) {
      if (!c.bounds) continue;
      sum += boundsErr(replay(c.cap, c.stats, opt).returns, c.bounds);
    }
    return sum;
  };

  const rCoarse = grid([
    ['returnMinMs', [250, 400, 550, 700, 900]],
    ['returnGapMs', [25, 50, 80, 120]],
    ['returnLoudDb', [10, 14, 18, 22]],
    ['returnLevelDb', [4, 8, 12]],
    ['returnClusterMs', [1200, 1800, 2400, 3000]],
  ]);
  console.log(`\nFitting the carriage return: ${rCoarse.length} coarse combinations…`);
  let rResults = rCoarse.map((opt) => ({ opt, err: rCost(opt) }));
  const rBest = rResults.reduce((a, b) => (b.err < a.err ? b : a));

  const rFine = grid([
    ['returnMinMs', around(rBest.opt.returnMinMs, [-100, -50, 0, 50, 100], 150, 1200)],
    ['returnGapMs', around(rBest.opt.returnGapMs, [-25, -12, 0, 12, 25], 10, 200)],
    ['returnLoudDb', around(rBest.opt.returnLoudDb, [-2, 0, 2], 6, 26)],
    ['returnLevelDb', around(rBest.opt.returnLevelDb, [-2, 0, 2], 0, 16)],
    ['returnClusterMs', around(rBest.opt.returnClusterMs, [-300, 0, 300], 600, 4000)],
  ]);
  console.log(`Refining over ${rFine.length} nearby combinations…`);
  rResults = rResults.concat(rFine.map((opt) => ({ opt, err: rCost(opt) })));

  const rPick = pick(
    rResults,
    (a, b) => Math.abs(a.returnMinMs - b.returnMinMs) <= 101
      && Math.abs(a.returnGapMs - b.returnGapMs) <= 26
      && Math.abs(a.returnLoudDb - b.returnLoudDb) <= 2.1
      && Math.abs(a.returnLevelDb - b.returnLevelDb) <= 2.1
      && Math.abs(a.returnClusterMs - b.returnClusterMs) <= 601,
    (o) => Math.abs(o.returnMinMs - DEFAULTS.returnMinMs) / 50
      + Math.abs(o.returnGapMs - DEFAULTS.returnGapMs) / 12
      + Math.abs(o.returnLoudDb - DEFAULTS.returnLoudDb) / 2
      + Math.abs(o.returnLevelDb - DEFAULTS.returnLevelDb) / 2
      + Math.abs(o.returnClusterMs - DEFAULTS.returnClusterMs) / 300,
  );
  const ropt = rPick.best.opt;

  console.log(`Best return fit (miscount ${rPick.best.err}, ${rPick.ties} equally good, ${rPick.best.support} neighbours agree):`);
  for (const k of ['returnMinMs', 'returnGapMs', 'returnLoudDb', 'returnLevelDb', 'returnClusterMs']) {
    console.log(`  ${k.padEnd(14)} ${String(ropt[k]).padStart(4)}   (default ${DEFAULTS[k]})`);
  }

  /* ── stage two: the strikes, with the returns settled ────────── */

  const sCost = (opt) => {
    let sum = 0;
    for (const c of caps) {
      sum += Math.abs(replay(c.cap, c.stats, { ...ropt, ...opt }).effective - c.want);
    }
    return sum;
  };

  // minIntervalMs is capped at 140: beyond that the gate stops guarding
  // against the rebound and starts eating real fast typing, which trades a
  // usable detector for a better-looking total on these particular takes.
  const sCoarse = grid([
    ['sensitivity', [0.35, 0.45, 0.55, 0.65, 0.75]],
    ['minIntervalMs', [40, 60, 80, 100, 120, 140]],
    ['reboundDb', [4, 6, 8, 10, 12, 999]],   // 999: gate effectively off
  ]);
  console.log(`\nFitting the strikes: ${sCoarse.length} coarse combinations…`);
  let sResults = sCoarse.map((opt) => ({ opt, err: sCost(opt) }));
  const sBest = sResults.reduce((a, b) => (b.err < a.err ? b : a));

  const sFine = grid([
    ['sensitivity', around(sBest.opt.sensitivity, [-0.1, -0.05, 0, 0.05, 0.1], 0.2, 0.9)
      .map((v) => Math.round(v * 100) / 100)],
    ['minIntervalMs', around(sBest.opt.minIntervalMs, [-20, -10, 0, 10, 20], 25, 150)],
    ['reboundDb', sBest.opt.reboundDb === 999
      ? [12, 14, 16, 20, 999]
      : around(sBest.opt.reboundDb, [-2, -1, 0, 1, 2], 2, 20)],
  ]);
  console.log(`Refining over ${sFine.length} nearby combinations…`);
  sResults = sResults.concat(sFine.map((opt) => ({ opt, err: sCost(opt) })));

  const sPick = pick(
    sResults,
    (a, b) => Math.abs(a.sensitivity - b.sensitivity) <= 0.051
      && Math.abs(a.minIntervalMs - b.minIntervalMs) <= 21
      && Math.abs(a.reboundDb - b.reboundDb) <= 2.1,
    (o) => Math.abs(o.sensitivity - DEFAULTS.sensitivity) / 0.05
      + Math.abs(o.minIntervalMs - DEFAULTS.minIntervalMs) / 10
      + Math.abs(Math.min(o.reboundDb, 25) - DEFAULTS.reboundDb),
  );
  const best = { ...ropt, ...sPick.best.opt };

  console.log(`Best strike fit (miscount ${sPick.best.err} strikes, ${sPick.ties} equally good, ${sPick.best.support} neighbours agree):`);
  for (const k of ['sensitivity', 'minIntervalMs', 'reboundDb']) {
    console.log(`  ${k.padEnd(14)} ${String(best[k]).padStart(4)}   (default ${DEFAULTS[k]})`);
  }

  // The winner is re-scored through the untouched detector. If this table
  // disagrees with the search, the search was wrong, and the table is the
  // one to believe — it is the code the microphone runs.
  console.log('\nVerified through the full detector:');
  console.log('file                              expected   heard   error   returns');
  let verifiedErr = 0;
  let verifiedRet = 0;
  for (const c of caps) {
    const { samples, sampleRate } = readWav(join(dir, c.f));
    const { strikes, returns } = direct(samples, sampleRate, best);
    const eff = effective(strikes, returns);
    const err = eff - c.want;
    verifiedErr += Math.abs(err);
    const rErr = boundsErr(returns.length, c.bounds);
    verifiedRet += rErr;
    // Where each return was heard, so an uncertain label — "maybe I pulled
    // the lever at the end" — can be settled by looking at the time.
    const at = returns.map((r) => `${(r.at / 1000).toFixed(1)}s`).join(' ');
    console.log(c.f.padEnd(34) + String(c.want).padStart(8) + String(eff).padStart(8)
      + (err === 0 ? '       ✓' : String(err > 0 ? `+${err}` : err).padStart(8))
      + '   ' + returns.length + (rErr === 0 ? ' ✓' : ` (wanted ${boundsStr(c.bounds)})`)
      + (at ? `  at ${at}` : ''));
  }
  if (verifiedErr !== sPick.best.err || verifiedRet !== rPick.best.err) {
    console.log(`\nWARNING: the search said ${sPick.best.err} strikes / ${rPick.best.err} returns of error, `
      + `the full detector says ${verifiedErr} / ${verifiedRet}. Believe the detector.`);
  } else if (verifiedErr === 0 && verifiedRet === 0) {
    console.log('\nEvery labelled count reproduced exactly.');
  } else {
    console.log(`\n${verifiedErr} strikes and ${verifiedRet} returns of miscount remain — `
      + 'these parameters cannot explain the recordings alone.');
    console.log('Run `count --events` on the worst file to see which events are wrong.');
  }

  if (flags.write) {
    const out = join(dir, 'fit.json');
    writeFileSync(out, JSON.stringify({
      ...best, strikeError: verifiedErr, returnError: verifiedRet,
      fittedAt: new Date().toISOString(),
    }, null, 2));
    console.log(`Written to ${out}.`);
  } else {
    console.log('\nTo adopt these numbers, change DEFAULTS in src/core/listen.js — with a comment saying they were fitted to these recordings.');
  }
}

/* ── argument plumbing ───────────────────────────────────────── */

function optFromFlags(flags) {
  const opt = {};
  if (flags.sensitivity != null) opt.sensitivity = flags.sensitivity;
  if (flags.minInterval != null) opt.minIntervalMs = flags.minInterval;
  if (flags.reboundDb != null) opt.reboundDb = flags.reboundDb;
  if (flags.returnMin != null) opt.returnMinMs = flags.returnMin;
  if (flags.returnGap != null) opt.returnGapMs = flags.returnGap;
  if (flags.returnLoud != null) opt.returnLoudDb = flags.returnLoud;
  if (flags.returnLevel != null) opt.returnLevelDb = flags.returnLevel;
  if (flags.raw) {
    // Gates open: every candidate peak surfaces, nothing is suppressed.
    // This is the input calibrate() wants, and the view that shows *why*
    // a count is wrong rather than only that it is.
    opt.minIntervalMs = 25;
    opt.reboundDb = 999;
  }
  return opt;
}

function parse(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--events') flags.events = true;
    else if (a === '--raw') flags.raw = true;
    else if (a === '--write') flags.write = true;
    else if (a === '--expect') flags.expect = Number(argv[++i]);
    else if (a === '--sensitivity') flags.sensitivity = Number(argv[++i]);
    else if (a === '--min-interval') flags.minInterval = Number(argv[++i]);
    else if (a === '--rebound-db') flags.reboundDb = Number(argv[++i]);
    else if (a === '--return-min') flags.returnMin = Number(argv[++i]);
    else if (a === '--return-gap') flags.returnGap = Number(argv[++i]);
    else if (a === '--return-loud') flags.returnLoud = Number(argv[++i]);
    else if (a === '--return-level') flags.returnLevel = Number(argv[++i]);
    else flags._.push(a);
  }
  return flags;
}

const flags = parse(process.argv.slice(2));
const [cmd, target] = flags._;

if (cmd === 'count' && target) cmdCount(target, flags);
else if (cmd === 'eval' && target) cmdEval(target, flags);
else if (cmd === 'fit' && target) cmdFit(target, flags);
else {
  console.log(`Usage:
  node tools/listen-lab.mjs count <file.wav> [--expect N] [--events] [--raw]
                                  [--sensitivity S] [--min-interval MS] [--rebound-db DB]
  node tools/listen-lab.mjs eval  <dir> [--sensitivity S] [--min-interval MS]
                                        [--rebound-db DB] [--return-* …]
  node tools/listen-lab.mjs fit   <dir> [--write]

count  one recording: every event, the total, and — with --expect — the error.
       --raw opens the gates so every candidate peak is visible.
eval   every labelled recording in <dir> against <dir>/labels.json. Takes
       the same tuning flags as count, so a candidate set of parameters can
       be tried across the whole set without editing listen.js.
fit    fit the carriage-return thresholds, then sensitivity, minimum
       interval and rebound gate, against the labels; verify the winner
       through the untouched detector.`);
  process.exit(cmd ? 1 : 0);
}
