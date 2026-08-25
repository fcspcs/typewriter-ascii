# Listening: what the research says, and what will actually happen

A decision document for the `listen` feature — counting keystrokes by ear on
an Olympia SM7 de Luxe (mechanical, 1962–64).

Everything here was measured or read. Claims are tagged:

- **[measured]** — I ran it and the numbers are reproducible
- **[source]** — stated in a paper I actually read, cited below
- **[inferred]** — reasoned from measurement or source, not directly tested
- **[guess]** — plausible, untested, flagged so nobody builds on it

Three of the hypotheses that motivated this research turned out to be
**wrong**. They are marked as such rather than quietly dropped, because
knowing they are wrong changes what to build.

---

## 1. The short version

`listen.js` is a competent implementation of the wrong measurement, driven by
the wrong clock.

The single most consequential finding is not about spectral flux at all:

> **The same audio, fed through the current detector twice with nothing
> changed but the arbitrary phase of the `requestAnimationFrame` clock,
> produces counts that differ by 9–19%.** [measured]

That is a floor on accuracy that no amount of threshold tuning can lift,
because the variation is not caused by the sound. A counter that miscounts
by 9% has drifted a full character within the first ten keystrokes.

The fix for that is structural and cheap: stop sampling the audio from the
animation loop. Everything else in this document is secondary to that.

Second finding, nearly as cheap to fix: `listen.js` throws away **62% of the
strike's energy** [measured] by ignoring everything below 7.2 kHz, and it
computes flux on **decibel** values, which makes the loudest and quietest
frequency bins count equally — 75% of the resulting number comes from the
quietest half of the spectrum [measured]. Both are departures from what the
literature does, in the direction that costs signal.

---

## 2. What will happen when Lorenz first switches it on

A prediction, from reading the code and running it against real typewriter
recordings. In rough order of how soon he will notice.

### 2.1 It will undercount, and the count will not be repeatable

Against real BBC recordings of manual typewriters, the current chain counts
101 events per minute on medium-paced typing and 245 on fast typing
[measured]. Re-running the identical audio at 20 different frame phases:

| recording | count range | spread |
|---|---|---|
| Manual, medium typing, 60 s | 99 – 108 | 8.7% of mean |
| Manual, fast, close mic, 60 s | 218 – 263 | 18.6% of mean |

[measured, `repeatability.py`]

Nothing about the audio changed between those runs. The only difference is
where the frame ticks happened to land. In a browser that phase is arbitrary
and drifts continuously, so this is not a one-off offset he can calibrate
away — it is ongoing noise.

It gets worse if the frame rate is not 60:

| frame rate | count on the same 60 s |
|---|---|
| 60 fps | 101 |
| 50 fps | 117 |
| 45 fps | 118 |
| 30 fps | 126 |

[measured] A phone that thermally throttles, or a browser that drops to
30 fps because the sheet is being redrawn, silently changes the answer by
25%.

### 2.2 The root cause is in `_loop()`, not in the maths

```js
const tick = () => {
  if (!this.running) return;
  this.step();
  requestAnimationFrame(tick);
};
```

`AnalyserNode.getFloatFrequencyData()` returns *the most recent `fftSize`
samples at the moment you call it* (Web Audio API 1.1 §1.8.5–1.8.6). It is a
snapshot, not a stream. Calling it from `requestAnimationFrame` means the
analysis windows are spaced by whatever interval the compositor delivers.

With `fftSize: 1024`:

| sample rate | window | at 60 fps | at 30 fps |
|---|---|---|---|
| 48 kHz | 21.3 ms | 4.7 ms overlap | **blind 12.0 ms in every 33.3** |
| 44.1 kHz | 23.2 ms | 6.6 ms overlap | **blind 10.1 ms in every 33.3** |

[measured, `coverage.py`] At 30 fps the detector never examines 36% of the
incoming audio. A typebar strike whose entire useful transient is 5–10 ms
long can fall wholly inside that gap and be *invisible* — not "below
threshold", not seen at all.

Even at a healthy 60 fps the effective frame rate is 16.7 ms. For comparison:

- Dixon 2006: 46 ms window, **10 ms hop**, 78.5% overlap [source]
- Böck & Widmer 2013 (SuperFlux): **5 ms** frame rate [source]
- Zhuang et al. 2005: sliding windows, **10 ms** shift [source]
- Compagno et al. 2017: energy over **10 ms** windows [source]
- `librosa.onset_detect` defaults: hop 512 @ 22.05 kHz ≈ 23 ms [source, code]

`listen.js` is 2–3× coarser than any of them, *and* its hop is not constant.

There is a second, subtler bug in the same loop: `step()` uses
`performance.now()` as the event time, i.e. **when JavaScript got round to
looking**, not when the sound arrived. The refractory and rebound logic all
operate on those times.

### 2.3 Clean, well-separated strikes get dropped

Sweeping only the phase between a single isolated strike and the frame clock,
with no noise at all: **3 of 12 phases detect nothing whatsoever** [measured,
`miss_diagnosis.mjs`]. The mechanism is the slope gate

```js
const jump = flux - (this.lastFlux ?? flux);
if (flux > threshold && jump > threshold * o.minSlope) {
```

A sharp transient that straddles two analysis frames reads at roughly half
height in each, so neither the level test nor the one-frame jump test passes.
The code comment for `reboundRatio` already anticipates exactly this failure
("a sharp transient can fall between two analysis frames and read at half its
true height") — but the same effect defeats `minSlope`, and that was not
accounted for.

Cost of the gate on real audio: it removes 42% of otherwise-detected events
(174 → 101) [measured]. Some of those are genuine rejections. Many are not.

### 2.4 The tests cannot catch any of this

`test/listen.test.mjs` calls `_pick()` directly with hand-built flux traces
and a **hard-coded threshold of 2.0**. It therefore exercises the peak picker
in isolation and never touches:

- `step()` — the flux computation itself
- the `Median` floor and the real adaptive threshold
- the FFT, the band selection, the dB conversion
- the frame timing, which is where the dominant error lives

The carriage-return test models it as `3 * Math.sin(...)` — a smooth swell
over 500 ms. A real carriage return is a lever throw, escapement clatter, and
a hard slam into the margin stop: a *train of transients*. Modelled that way
and fed to the real `_pick()`, one carriage return produces 1 counted strike
[measured, `realistic_test.mjs`], so the test's `<= 1` assertion passes while
demonstrating nothing about the real event.

This is the honest summary: **the green test suite is evidence about the test
generator, not about typewriters.**

### 2.5 Where it will *not* fail, contradicting expectations

Worth stating plainly, because two of these were my starting assumptions:

- **Phantom strikes in a quiet room: no.** 30 s of pure noise at −90 to
  −50 dBFS produced **0** false strikes at every level [measured]. The slope
  gate does its job here.
- **Carriage return counted as strikes: mostly no.** In 120 s of real typing,
  the 12 longest loud events (285–400 ms) contained **0** counted strikes
  between them; across all 27 events ≥250 ms, 0.07 counts each [measured,
  `find_cr.py`]. The slope gate genuinely suppresses it. **My hypothesis that
  the carriage return would be counted as multiple strikes was wrong.**

The real risk is the opposite of what the code's comments worry about. It is
tuned hard against false positives and consequently misses real strikes.

---

## 3. Was spectral flux the right choice?

Partly. The family is right; three implementation choices inside it are not.

### 3.1 The keystroke literature does not use spectral flux

This is the most useful thing the side-channel papers have to say, and it is
unanimous. Every one of them had to solve exactly our problem — find the
keystrokes in a recording — before they could start classifying keys. **None
of them uses spectral flux.** They all use **band-limited energy**:

| work | segmentation method |
|---|---|
| Asonov & Agrawal 2004 | time-FFT over 2 ms Hanning windows; locate the push peak; features from a 2–3 ms window at the touch peak [source] |
| Zhuang et al. 2005 | windowed FFT, **sum coefficients over 0.4–12 kHz**, threshold the resulting curve to find each keystroke start [source] |
| Compagno et al. 2017 | normalise to RMS 1, sum FFT coefficients over **10 ms** windows, threshold for the press peak [source] |
| Harrison et al. 2023 | "executed in a majority of recent literature via a similar method: performing the FFT on the recording and summing the coefficients across frequencies to get 'energy'. An energy threshold is then defined" [source] |

Zhuang et al. state the band explicitly: *"the energy of keystroke durations
is mainly in the frequencies between 400Hz and 12KHz"* [source]. Asonov &
Agrawal report that *"higher frequencies are generally less informative"* and
that even the 300–3400 Hz telephone band retained useful information [source].

`listen.js` uses `bandStart: 0.30`, discarding everything below 30% of
Nyquist — **7200 Hz at 48 kHz, 6615 Hz at 44.1 kHz**. That is above the band
the entire literature identifies as carrying the keystroke.

Measured on a real BBC manual-typewriter recording:

| band | share of strike energy | strike-vs-quiet contrast |
|---|---|---|
| 0–500 Hz | 1.5% | 7.3 dB |
| 500–1000 Hz | 2.9% | 27.8 dB |
| 1000–2000 Hz | 6.8% | 33.3 dB |
| 2000–4000 Hz | 21.6% | 41.0 dB |
| 4000–6600 Hz | 24.7% | 43.1 dB |
| 6600–9000 Hz | 16.9% | 43.6 dB |
| 9000–12000 Hz | 15.5% | **44.9 dB** |
| 12000–16000 Hz | 9.8% | 41.7 dB |

**62.4% of the strike's energy is below 7200 Hz and is thrown away**
[measured, `spectrum.py`].

Note the second column carefully: contrast is roughly *flat* from 2 kHz to
16 kHz (41–45 dB). The high band is not a bad place to listen — it is a fine
place. It is just needlessly narrow, and it discards the majority of the
signal for no measured benefit. The band that maximises contrast is
~4–12 kHz, which is essentially Zhuang's band shifted up slightly.

Caveat, stated because it matters: the BBC recordings are 1960s–70s tape.
Only 0.25% of strike energy sits above 16 kHz, which is consistent with tape
bandwidth limiting rather than with the machine. A live SM7 into a modern mic
may well have more high content [inferred]. This is one of the things
Lorenz's own recordings (§7) would settle.

### 3.2 Flux on decibels is not flux

```js
this.analyser.getFloatFrequencyData(this.bins);   // dB values
const d = this.bins[i] - this.prev[i];            // difference of dB
if (d > 0) flux += d;
```

The spec defines the output as `Y[k] = 20·log₁₀|X[k]|`. A difference of two
dB values is a **ratio**, not a change in energy: it is `20·log₁₀(Aₙ/Aₙ₋₁)`.
A near-silent bin that happens to double contributes exactly 6.02, the same
as the single loudest bin of the strike doubling.

Consequence, measured directly: **75.3% of the total dB-flux value comes from
the quietest half of the bins** [measured, `flux_experiment.py`]. The
detection function is dominated by the part of the spectrum containing the
least information.

Both Dixon 2006 and Böck & Widmer 2013 define spectral flux on magnitudes,
and Dixon tested this specific choice: *"Empirical tests favoured the use of
the L1-norm here over the L2-norm used in [7, 2], and the **linear magnitude
over the logarithmic** (relative or normalised) function proposed by
Klapuri"* [source]. The current code took the logarithmic option that Dixon's
experiments rejected.

Separation of a strike from the room, same simulated signal both ways:

| room noise | dB-domain flux | linear-magnitude flux |
|---|---|---|
| −70 dBFS | 112 σ above floor | 11898 σ |
| −60 dBFS | 108 σ | 3895 σ |
| −50 dBFS | 65 σ | 1165 σ |
| −40 dBFS | 33 σ | 378 σ |

[measured] Both work in a quiet room. The dB version degrades far faster as
the room gets noisier.

This also explains the noise sensitivity: adding broadband room noise to real
typing audio costs the current detector 37% of its counts at −50 dBFS and 77%
at −40 dBFS [measured, `agc_noise.py`]. A café, or a fan, or a window onto a
street, and it stops counting.

### 3.3 What about HFC, complex domain, phase deviation, SuperFlux?

Checked, and the answer is that none of them is worth the complexity here.

Dixon 2006 compared spectral flux, phase deviation, weighted phase deviation,
complex domain, and others on a large piano corpus, and concluded that
spectral flux and complex domain were "marginally better" than the phase
methods, with the differences between the best algorithms **not statistically
significant** [source]. He also notes SF has a slight advantage in onset
*timing* precision.

SuperFlux (Böck & Widmer 2013) exists specifically to suppress **vibrato** —
it applies a maximum filter along the frequency axis so that a slowly
wandering partial does not read as a series of onsets [source]. A typewriter
has no vibrato. The mechanism it defends against does not occur here.
`librosa` adopted it as the default (`max_size`) but for our signal it solves
a non-problem [inferred].

Phase-based methods need reliable phase, which is exactly what a broadband
impulsive click does not provide.

**Conclusion:** the detection-function family is not the lever. Aubio's own
defaults quietly agree — plain `energy` mode is offered alongside all the
sophisticated descriptors, and for HFC it sets `threshold 0.058`, for
specflux `0.18`, i.e. the descriptor choice mostly changes what threshold you
need, not what you can detect [source, aubio `src/onset/onset.c`].

### 3.4 The peak-picking recipe everyone converges on

Three independent implementations, one shape:

- **Dixon 2006**: normalise the detection function to mean 0, sd 1; onset if
  it is a local max over ±3 frames, exceeds the local mean over a window
  extended backwards (m=3) plus δ, and exceeds a decaying threshold `gα`
  [source]
- **Böck & Widmer 2013** (also used by `librosa`): local max over
  `pre_max`/`post_max`, above local mean over `pre_avg`/`post_avg` plus δ,
  and at least `combination_width` since the last onset. Values:
  pre_max 30 ms, post_max 30 ms, pre_avg 100 ms, post_avg 70 ms,
  combination_width 30 ms. **In online mode `post_max` and `post_avg` are
  set to 0** [source]
- **aubio**: median-based adaptive threshold over a window of
  `win_post=5, win_pre=1`, `threshold` default 0.1, plus a **minimum
  inter-onset interval** (`minioi`), default **50 ms** [source, code]
- **`librosa.onset_detect`** defaults, "found by large-scale search":
  pre_max 30 ms, post_max 0 ms, pre_avg 100 ms, post_avg 100 ms,
  **wait 30 ms**, delta 0.07 [source, code]

`listen.js` has the right *idea* — median floor, refractory window — but its
refractory is **85 ms**, against 30 ms (SuperFlux/librosa) and 50 ms (aubio).

Is 85 ms too long? On real fast typing, only 1.5% of detected inter-onset
intervals fall under 85 ms [measured], so it is not the main cost. But it is
built on a premise worth checking, discussed next.

### 3.5 The rebound premise

The file's opening comment says a keystroke produces "the type bar hitting
the platen — sharp, loud, broadband" then "the type bar falling back —
softer, slightly later", and sets `refractoryMs: 85` because "the type bar
rebounds within roughly 30–70 ms".

*(Quoted as it stood when this section was written. The setting is called
`minIntervalMs` now, defaults to 90, and is what `calibrate()` fits.)*

The literature describes a two-peak structure, but a *different* one. Asonov
& Agrawal: the click "lasts for approximately 100 ms" with two peaks
corresponding to **pushing** and **releasing the key**, with relative silence
between; the push peak itself splits into a **touch peak** (finger contacting
the key) and a **hit peak** (key hitting the supporting plate) about 10 ms
apart [source]. Zhuang et al. confirm ~100 ms push-to-release and note that
this leaves >100 ms between consecutive keystrokes [source].

Their answer to the two-peak problem is not a refractory window. It is
simpler: **only ever use the press peak**, because it is louder and easier to
isolate. Compagno et al. state it explicitly: *"we only use the press peak to
segment the data and ignore the release peak. This is because the former is
generally louder than the latter and is thus easier to isolate, even in very
noisy scenarios"* [source].

For a typebar machine there is a real mechanical rebound too, so the concern
is not imaginary. But the numbers 30–70 ms appear to be assumed rather than
measured — I found no source for them, and no measurement in the repo. The
`calibrate()` routine is the right instinct precisely because it would
measure them. **[inferred]**

---

## 4. Is counting the right idea at all?

No. Counting is the weakest possible use of the information available, and
the framing in the brief — score following — is essentially correct.

### 4.1 A counter throws away the thing that makes this problem easy

We know **exactly** what is supposed to be typed. The app generated it. A
pure counter reduces that rich prior to a single integer and then integrates
detector noise without bound.

How bad is unbounded integration? Monte Carlo, 20 000 runs, where each strike
has probability *p* of being miscounted (half missed, half doubled):

| p | after 60 chars (1 line) | after 600 chars (10 lines) |
|---|---|---|
| 0.001 | 5.7% chance of being ≥1 off | 39.5% |
| 0.005 | 23.9% | 75.4% |
| 0.01 | 40.1% | 83.0% |
| 0.05 | 76.2% | 92.7% |
| 0.10 | 83.3% | 95.1% |

[measured, Monte Carlo] Even a detector that is 99.9% correct per strike is
wrong about the position of the cursor 40% of the time by the end of a page.
And the current detector is nowhere near 99.9% — its *phase noise alone* is
9–19%.

**This is the argument that decides the design.** Not "the detector needs to
be better" — it needs to be better *and* the errors must not accumulate.

### 4.2 Score following is the right frame — with one caveat

Confirmed. The task is: given a known reference sequence and a live audio
stream, maintain an estimate of the current position, in real time, robust to
the performer making mistakes. That is the textbook statement of score
following.

The relevant work:

- **Dixon 2005**, on-line time warping: DTW is unusable live because it needs
  both sequences complete and is quadratic. He gives an incremental algorithm
  with **linear time and space**, aligning as the audio arrives, "each frame
  of audio represented by a positive spectral difference vector, emphasising
  note onsets" — average alignment error 59 ms, median 20 ms on 22 pianists
  playing Chopin [source]
- **Arzt, Widmer & Dixon 2008**, automatic page turning: the same problem
  shape as ours (advance a display for a performer who must not take their
  hands off the instrument). They report that Dixon's original algorithm "has
  severe problems" with less-than-perfect performances and add a
  **backward-forward strategy** that periodically re-computes a backward path
  from the current position to correct the forward estimate. Their strategy 2
  is "very effective at correcting errors between 0.02 and 0.2 seconds"
  [source]
- **Cont 2010**, coupled duration-focused architecture (Antescofo), a
  probabilistic/HMM treatment of the same problem [source: DOI
  10.1109/TPAMI.2009.106 — found via OpenAlex, abstract only, **I did not
  read the full paper**]

**The caveat, and it is important.** Score following works because a musical
score is *discriminative*: different notes sound different, so the alignment
has something to lock onto. Our reference is a string of characters, and the
evidence that a typewriter's characters are acoustically distinguishable is
weak for our purposes:

- Asonov & Agrawal got key recognition working, but with a **parabolic
  microphone**, a trained neural net **per keyboard**, and on computer
  keyboards where each key sits at a different place on a resonant plate
  [source]
- Zhuang et al. needed **10 minutes** of audio plus English-language
  statistics to reach 96% [source]
- A typebar machine is acoustically *less* differentiated than a computer
  keyboard in the relevant respect: every typebar strikes the **same
  platen at the same point**. The variation is in the type slug and the
  lever geometry [inferred]

So: **full character-level alignment is not realistic.** But that is not what
we need. We need a *coarse* observation model — and there the prospects are
good, because the events that matter most are the ones that differ most.

### 4.3 What the alignment can realistically use

Ranked by how confidently I can support them:

**(a) Carriage return as a line-end anchor — yes, and it is the big win.**

The carriage return is the loudest and longest event in normal typing. In
120 s of real audio, the longest events are 285–400 ms, against a median
event length of 35 ms [measured]. Sorting events by duration puts carriage
returns cleanly at the top. And unlike a strike, it is *long* — you have
hundreds of milliseconds of evidence, not five.

This is worth far more than its detection cost, because it converts
unbounded drift into bounded drift. Resetting the count at each line end:

| p | drift within a line, mean | 99th percentile |
|---|---|---|
| 0.01 | 0.47 | 2 |
| 0.05 | 1.32 | 5 |
| 0.10 | 1.91 | 6 |

[measured] Compare against the 10-line column of the table in §4.1. **The
hypothesis that the carriage return is the natural line-end signal is
correct, and it is the highest-value single feature in this document.**

Better still: we know the expected count for the line. If the carriage return
arrives and the counter reads 58 where the line was 60 characters, that is a
*measurement of the error rate*, usable to adapt the threshold — and the
counter resets regardless, so the error does not propagate.

**(b) Space bar vs typebar — plausible, unverified.**

Mechanically these are genuinely different: the space bar advances the
carriage via the escapement without a typebar striking the platen. It should
be quieter and lack the platen impact [inferred]. The repo's own test
("space bar (two mechanical clicks) counts once") assumes it is *similar
enough* to a strike to be handled by the same path, which is an untested
assumption in the other direction.

I could not verify this without labelled audio. **Rated [guess] pending
Lorenz's recordings**, and it is exactly what recording 4 in §7 is for. If
the space bar is measurably quieter, that is valuable: our reference lines
contain long runs of spaces, and knowing "the next 18 events should be
quiet ones" is a strong alignment constraint.

**(c) The bell as a position anchor — real, and cheaply detectable.**

The bell rings a fixed number of characters before the right margin, so it is
a *known position*, not just a nuisance. Measured on a real typewriter bell
(Freesound 318687, CC0): strong partials at ~7.2 kHz and ~11.7 kHz, spectral
flatness **0.57** at onset, −20 dB decay **220 ms** [measured]. Compare
against typebar strikes in the BBC recordings: flatness 0.75–0.85 (median
0.795), decay 130–180 ms [measured].

Spectral flatness separates tonal from broadband and is a few lines of code.
The tonality gap (0.57 vs ~0.80) is workable. **[measured, though on a bell
from a different machine than the SM7]**

**(d) Long/loud vs short/quiet — measured, usable.**

Events ≥250 ms have median peak level 69.8 dB against 56.3 dB for events
≤100 ms [measured] — a 13 dB separation. Duration and level alone separate
"mechanism event" from "ordinary strike" quite well.

**(e) Character identity — no. Do not attempt it.**

See §4.2. **[inferred, moderately confident]**

### 4.4 So what should the model be?

A three-state picture, in increasing order of ambition:

1. **Counter + carriage-return reset.** Bounded drift. Small change.
2. **Counter + reset + event classification** (strike / space / bell / return
   / other) with the classes used as soft evidence against the expected line.
3. **Full forward-DTW or HMM** over the event sequence, in the style of Dixon
   2005 with Arzt's backward-forward correction, where the observation model
   is the coarse class from (2).

Level 3 is the theoretically correct answer and level 1 captures most of the
practical benefit. **[inferred]**

One thing level 3 buys that levels 1–2 do not: it can represent *uncertainty*.
It can say "I am 80% sure you are at column 34, 15% at 33". A UI that shows a
slightly hedged position when confidence drops is far kinder than one that
confidently shows the wrong column.

### 4.5 How much drift is tolerable?

I found no research on this and it is a UX question, not a signal-processing
one. My reasoning **[guess]**:

The failure mode is asymmetric and severe. The machine has no undo. A wrong
column means a ruined sheet. So the display is only worth having if it is
*right more reliably than the person counting themselves*.

- **0 characters off** — the only genuinely useful state
- **1 off** — actively dangerous; looks right, produces a wrong sheet
- **≥3 off** — obviously broken, so the user stops trusting it, which is
  paradoxically safer than 1 off

The dangerous zone is small errors. This argues strongly for **displaying
confidence and stopping** rather than silently guessing: on any ambiguity,
show "lost — click where you are" instead of a plausible wrong number. It
also argues for the line-end reset, which converts a fatal accumulating error
into a recoverable per-line one.

---

## 5. What actually works in the browser

### 5.1 The constraints are already correct — my hypothesis was wrong

The brief suspected `listen.js` might not set the audio constraints. **It
does, correctly:**

```js
audio: {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
}
```

All three default to `true` (mediacapture-main, `MediaTrackSupportedConstraints`)
[source], so turning them off is the right call and the code already made it.

But the *reasoning* for why matters, and my assumed reasoning was wrong too.
I predicted AGC would break the adaptive threshold by moving levels around.
Tested directly:

- Static gain from −24 dB to +12 dB: **the count does not change at all**
  (101 events at every gain) [measured]
- Simulated time-varying AGC (5 ms attack, 300 ms release): 100 events vs
  101 baseline, **−1%** [measured]

The reason is the dB-domain flux from §3.2: because a dB difference is a
ratio, the current detector is *inherently gain-invariant*. So one of the two
serious flaws in the flux computation happens to immunise it against one of
the three things the constraints protect against. **My AGC hypothesis was
wrong.**

The constraints should still stay off, for a reason I can support: Harrison
et al. 2023 found that with Zoom's noise suppression active, "the volume of
keystrokes varied massively, making the setting of a threshold value
difficult" — they had to add an iterative search that adjusted the threshold
until the keystroke count came out right [source]. That is direct evidence
that noise suppression harms keystroke segmentation. Note it is about
`noiseSuppression`, not `autoGainControl`.

Caveat: setting these to `false` is a *request*. The spec allows a source
that cannot turn a feature off to report only `true` [source]. Worth checking
`track.getSettings()` after acquisition and warning if the browser refused.
[inferred]

### 5.2 AnalyserNode vs AudioWorklet

This is the change that matters most. `AnalyserNode` is designed for drawing
meters and spectrograms — it hands you *the current state* when asked.
`AudioWorklet` hands you *every block*, 128 frames at a time, on the audio
thread, with no gaps and no dependence on rendering.

The whole class of errors in §2.1–2.3 disappears with a fixed hop, because
the frame phase stops being random.

To check that this is not just theory, I implemented the recommended chain
(fixed 10 ms hop, linear magnitude, band 0.5–12 kHz, causal median threshold,
90 ms minimum inter-onset interval) and ran the identical phase sweep:

| recording | current: spread | proposed: spread |
|---|---|---|
| Manual, medium typing | **8.7%** | **3.9%** |
| Manual, fast, close | **18.6%** | **2.8%** |
| Manual, 4 m away | (not run) | **2.4%** |

[measured, `proposed.py`] Phase noise drops by roughly a factor of 5 on the
hard case. That residual 2–4% is mostly events genuinely near threshold.

Notes on AudioWorklet in practice:

- Render quantum is **128 frames** by default (Web Audio API 1.1); at 48 kHz
  that is 2.67 ms — accumulate 4 quanta for a 10 ms hop [source]
- The worklet runs on the audio thread; post only detected events to the main
  thread, never per-frame data
- `AnalyserNode` also applies a **Blackman window** and, by default,
  `smoothingTimeConstant = 0.8` — an exponential average across frames that
  would smear transients badly. `listen.js` correctly sets it to 0 [source]
- Doing your own FFT in a worklet means you choose the window; Hann with 50%+
  overlap is the conventional choice [source: Dixon 2006 uses Hamming-family
  windowing with 78.5% overlap]

If a full worklet rewrite is not wanted immediately, there is a cheap
intermediate: keep `AnalyserNode` but drive it from a fixed-interval timer
rather than `requestAnimationFrame`, and raise `fftSize` so windows overlap
even at low frame rates. That fixes the blindness but not the phase jitter.
**[inferred]**

### 5.3 Sample rate, band, and iOS

- `bandStart: 0.30` is a *fraction of Nyquist*, so the actual band moves with
  the hardware: above 6615 Hz at 44.1 kHz, above 7200 Hz at 48 kHz
  [measured]. The same code listens to a different band on different devices.
  Bands should be specified in **Hz** and converted using the real
  `ctx.sampleRate`.
- **iOS Safari**: `getUserMedia` requires a secure context and a user
  gesture; `AudioContext` starts `suspended` and needs `resume()` from a
  gesture. The existing UI toggles listening from a button click, which
  satisfies this. I did **not** verify iOS behaviour empirically — no device.
  **[guess]**
- Screen-lock / backgrounding on mobile will suspend audio. For a feature
  where the phone sits next to the machine for many minutes, this is a real
  operational issue that needs a wake-lock or at least a clear warning.
  **[inferred]**

---

## 6. Testing this honestly

### 6.1 Public data that actually exists and is usable

Verified by downloading and analysing, not by assuming:

**BBC Sound Effects** — `https://sound-effects.bbcrewind.co.uk/`
- **52 results** for "typewriter"; all 44.1 kHz stereo WAV, MP3 previews free
  to download [measured — I fetched and analysed four of them]
- The relevant set is a systematic Foley session with **explicit perspective
  labels**, which is exactly what testing needs:

  | id | duration | description |
  |---|---|---|
  | `07029109` | 148.8 s | Manual Typewriter: Live Acoustic, medium typing |
  | `07029102` | 161.0 s | Manual Typewriter: Close Perspective, fast typing |
  | `07029105` | 158.0 s | Manual Typewriter: Rec. **4 metres away**, fast typing |
  | `07029111` | 6.0 s | Manual Typewriter: Close perspective, tabulating |
  | `07029113` | 5.9 s | Manual Typewriter: Live Acoustic, tabulating |
  | `07029114` | 19.2 s | Manual Typewriter: loading and unloading |
  | `07029126`–`07029131` | 7–11 s | **Portable** Typewriter: close/live, tabulating, spacing |
  | `07071111` | 194.2 s | Single typewriter, 1968 |

  The close/live/4-metre triplet of the *same* machine is genuinely valuable:
  it tests distance and reverberation as controlled variables.
- MP3s fetch from
  `https://sound-effects-media.bbcrewind.co.uk/mp3/<id>.mp3` [measured]
- **Licence: RemArc / personal and educational use.** Fine for local
  development testing. **Not** redistributable — do not commit them to the
  repo. [source: BBC licensing page]

**Freesound** — `https://freesound.org/`
- Many typewriter sounds; licences are per-sound and must be checked
  individually. Verified examples [measured]:
  - `https://freesound.org/s/318687/` "Typewriter Bell.wav" by ramsamba —
    **CC0**
  - `https://freesound.org/s/170548/` "Longest Sound Typewriter" by
    fellwell5 — **CC0**
  - `https://freesound.org/s/47049/` "Single Typewriter Paper Yank #2" by
    lonemonk — **CC BY 4.0**
- CC0 items can be committed as fixtures if desired. The bell recording above
  is genuinely useful as a positive example for bell detection.

**What I did not find:** any labelled dataset of typewriter keystrokes with
per-strike ground truth timing, and no acoustic dataset for the Olympia SM
series specifically. The keystroke side-channel papers built their own data
and, as far as I could find, did not release it. Nothing that would let us
compute a proper F-measure without labelling audio ourselves. **This is a
real gap and it is why §6.2 matters.**

### 6.2 The ground-truth problem, and the test that avoids it

I want to be explicit about a limit in my own analysis. When I compared the
current detector against a reference detector on real audio, the reference
found roughly twice as many events. I initially read that as "listen.js
misses half the strikes". Checking the inter-onset histogram showed a large
cluster at 50–100 ms — consistent with the reference partly counting
**release peaks** as separate events, which is exactly the two-peak problem
Asonov & Agrawal describe. **So I cannot claim listen.js misses half the
strikes. I do not know the true count, and neither detector is ground truth.**

That is precisely why the phase-sweep test in §2.1 is the load-bearing
evidence in this document: **it needs no ground truth.** Feed identical audio,
vary only something that should not matter, and any change in output is
provably error. It is the strongest statement available without labels, and
it is damning on its own.

Recommended as the permanent regression test: assert that the count is stable
across frame phases, frame rates, and gain, on a fixed audio fixture. That
test would have caught every dominant problem described here, and unlike the
current suite it cannot be satisfied by a well-behaved synthetic generator.

### 6.3 The five-minute recording session for Lorenz

Phone or laptop, ~30 cm from the machine, in the room he actually works in.
Save as WAV or uncompressed if possible. **Say the label out loud at the start
of each take** — that is the ground truth, and it costs nothing.

1. **Room tone, 20 s.** Nothing at all. Establishes the noise floor.
2. **Twenty single strikes, slow.** Same key (say `M`), ~1 s apart, counting
   aloud. *This is the most valuable recording of the set* — it gives the
   press/rebound structure and settles the 30–70 ms assumption.
3. **Twenty strikes, varied.** Mix of light and heavy, different keys
   including a few that live at the edges of the keyboard.
4. **Twenty space bar presses, slow.** Then twenty alternating
   space/letter/space/letter. *Settles §4.3(b), currently a guess.*
5. **Five carriage returns**, with a couple of seconds of silence around each.
6. **A full line of exactly 40 characters**, typed normally, then the
   carriage return. Say "forty" first. This is the end-to-end test case.
7. **Type until the bell rings**, twice. Isolates the bell.
8. **One line typed as fast as he can.** Establishes the true minimum
   inter-onset interval on this machine — the thing `minIntervalMs` guesses.
9. **Repeat (6) with the phone across the room** (2–3 m), and once **with
   background noise** (radio, window open).
10. **Backspace ×5, shift ×5** — the remaining mechanism sounds.

Takes about five minutes. From it: the real refractory window, the real
press/rebound delay, the real spectrum of *this* machine, whether the space
bar is distinguishable, and a labelled end-to-end case with a known count.

---

## 7. If acoustics does not carry: the alternatives

Honest assessment. The ranking is by "works reliably" not by "is clever".

**Bluetooth camera shutter remote (~€10).** These enumerate as an HID
keyboard and send a keypress. A foot-operated one, or one taped where his
wrist rests, needs no new code at all — the app already has a
`keyboard.js` listening for keydown. **Most reliable option by a wide
margin**, close to 100% accurate, and it degrades gracefully. The cost is one
deliberate action per character, which for a 60-character line is 60 taps —
tolerable per *line*, tedious per *character*. **Best used as the line-advance
control combined with acoustic counting within the line.** [inferred, high
confidence]

**USB/Bluetooth foot switch.** Same idea, hands genuinely free, ~€20–40.
Same accuracy. Better ergonomics than the shutter remote for this specific
use. [inferred]

**Phone accelerometer on the desk.** `DeviceMotionEvent` is available in
browsers, **secure context only**, and on iOS requires an explicit
`DeviceMotionEvent.requestPermission()` call from a user gesture [source: W3C
DeviceOrientation spec; MDN]. The killer is the rate: the spec leaves the
sampling interval implementation-defined and notes an ongoing discussion
about capping maximum sampling frequency for fingerprinting reasons [source].
In practice browsers deliver around 60 Hz, and a typebar impact is a
sub-10 ms event. **Almost certainly too slow to resolve individual strikes,
and it would be sensitive to where the phone sits.** Might work as a coarse
"something happened" corroborating signal. **[inferred, would want testing
before relying on it]**

**Camera.** Watching the carriage move would give *absolute position*, not a
count — which is theoretically the best signal of all, since it cannot drift.
But it needs good light, a stable mount, and a clear view of the carriage,
and it is a large amount of work. Interesting, not next. [guess]

**The un-clever option worth stating:** the current sheet UI, advanced by
tapping anywhere on the screen with a knuckle, plus automatic advance to the
next line on carriage return. Most of the ergonomic benefit, none of the
signal processing.

---

## 8. Recommended order of work

Ranked by benefit per unit of effort.

### First — half a day, fixes the dominant error

1. **Move the analysis off `requestAnimationFrame`** to an `AudioWorklet`
   with a fixed 10 ms hop. Removes the 9–19% phase noise, the blindness at
   low frame rates, and the dependence on rendering load. Timestamp events
   from the audio clock, not `performance.now()`.
2. **Compute flux on linear magnitudes**, not dB. One-line change in
   principle (`10^(dB/20)` before differencing, or compute your own FFT in
   the worklet and never convert). Restores the level-weighting that makes
   the loud part of the strike dominate the measurement.
3. **Widen the band and specify it in Hz**: ~500 Hz to 12 kHz, following
   Zhuang et al., converted using the real `ctx.sampleRate`. Recovers the 62%
   of strike energy currently discarded.
4. **Add the phase-sweep regression test** (§6.2) against a fixed fixture.
   Without it, none of the above can be shown to have helped.

Expected: phase spread from 8.7%/18.6% down to ~3% [measured on the
prototype], plus much better behaviour in a noisy room.

### Second — a day, converts unbounded drift into bounded drift

5. **Detect the carriage return and reset the column counter at each line
   end.** Use duration + peak level (events ≥250 ms sit 13 dB above ordinary
   strikes [measured]). This is the highest-value *feature* in the document:
   it caps the damage from any counting error at one line.
6. **Compare the count at each line end against the expected line length**
   and surface the discrepancy — both as a confidence signal to the user and
   as an input for adapting the threshold.
7. **Make failure visible.** When the line-end count disagrees badly, say
   "lost — tap where you are" rather than showing a confident wrong column
   (§4.5).

### Third — needs Lorenz's recordings first

8. **Run the §6.3 session** and re-fit `minIntervalMs`, the rebound delay, and
   the band from real SM7 audio instead of assumptions. `calibrate()` is
   already the right idea; feed it real data.
9. **Test whether the space bar is separable** from a typebar strike. If it
   is, it becomes a strong alignment constraint given how many spaces our
   reference lines contain.
10. **Add bell detection** via spectral flatness (measured contrast 0.57 vs
    ~0.80 [measured]) as a second position anchor.

### Later, and only if the above proves insufficient

11. **Coarse event classification** (strike / space / bell / return) feeding
    a **forward alignment** against the known line, in the style of Dixon
    2005 with Arzt's backward-forward correction. Theoretically the right
    answer; substantially more work; only worth it once steps 1–7 are done
    and measured.

### In parallel, cheap and independent

12. **Support a Bluetooth shutter remote / foot switch** for line advance.
    Twenty lines of code, near-100% reliable, and it makes the acoustic
    counting a convenience rather than a dependency.

---

## 9. The case against this whole feature

Where acoustic counting is not worth having, stated plainly.

**It cannot be verified by the user in the moment.** The typist is looking at
the paper, not the screen. A display that is silently one column off is worse
than no display, because the machine has no undo and the error is only
discovered when the sheet is ruined. This asymmetry is the strongest argument
against the whole idea, and no improvement in detection removes it. It can
only be managed — by bounding drift (line reset) and by failing loudly
(§4.5).

**Rooms it will not work in.** Adding broadband noise to real typing audio at
−40 dBFS cost the current detector 77% of its counts [measured]. Fixing the
dB-flux issue will improve this substantially, but any detector will struggle
with a nearby conversation, music, or traffic. If Lorenz types with a radio
on, this feature is not for him.

**Very fast typing.** At sustained high speed, strikes overlap and the
mechanism sounds run together. In simulation, 30 strikes at 12.5/s counted as
13 [measured] — partly because the median floor rises when more than half the
frames contain strike energy, so the detector goes deaf during exactly the
passage it most needs to track. A median window of 72 frames = 1.2 s at 60 fps
is too short for sustained typing. (Fixable: use a longer window, or a
percentile lower than the median.)

**The overstrike case.** Typing onto an already-struck position — used
deliberately in this project for overlay effects — probably sounds different
(paper already compressed, ink layer present) but I have no measurement and
no source. **[guess]** It may matter precisely in the artistic passages where
accuracy matters most.

**The honest fallback.** If the recordings in §6.3 show the SM7 is
acoustically messy, or Lorenz's room is noisy, the €10 shutter remote solves
the actual problem — hands stay on the machine — with none of the
uncertainty. That should not be seen as a defeat. It would be the right
engineering answer, and it is worth building *first* so that the acoustic
path is always optional.

---

## 10. Sources

Read in full unless noted.

**Keystroke acoustic side channels**

- Asonov, D. & Agrawal, R. (2004). *Keyboard Acoustic Emanations.* IEEE
  Symposium on Security and Privacy. DOI 10.1109/SECPRI.2004.1301311.
  PDF: `https://agrawal-family.com/rakesh/papers/ssp04kba.pdf`
  — two-peak (push/release) structure, ~100 ms click, touch peak vs hit peak,
  2 ms FFT windows, high frequencies less informative.
- Zhuang, L., Zhou, F. & Tygar, J. D. (2005). *Keyboard Acoustic Emanations
  Revisited.* ACM CCS. DOI 10.1145/1102120.1102169.
  PDF: `https://ptolemy.berkeley.edu/projects/truststc/pubs/3/ZhaungZhouTygarKeyboardAcousticEmanationsRevisted.pdf`
  — segmentation by summed FFT energy over **0.4–12 kHz**; MFCC beat raw FFT;
  Appendix B gives the full extraction procedure.
- Compagno, A., Conti, M., Lain, D. & Tsudik, G. (2017). *Don't Skype & Type!
  Acoustic Eavesdropping in Voice-Over-IP.* ACM AsiaCCS. arXiv:1609.09359.
  — press peak only, 10 ms energy windows, 100 ms extraction.
- Harrison, J., Toreini, E. & Mehrnezhad, M. (2023). *A Practical Deep
  Learning-Based Acoustic Side Channel Attack on Keyboards.* arXiv:2308.01074.
  — energy-threshold isolation is "a majority of recent literature";
  **noise suppression made keystroke isolation much harder**.
- *A Survey on Acoustic Side Channel Attacks on Keyboards.* arXiv:2309.11012.
  — consulted; contains no typewriter-specific material.

**Onset detection**

- Dixon, S. (2006). *Onset Detection Revisited.* DAFx-06.
  PDF: `https://www.dafx.de/paper-archive/2006/papers/p_133.pdf`
  — 2048-sample window, **10 ms hop**; **linear magnitude beat logarithmic**;
  peak-picking recipe; differences between the best functions not significant.
- Böck, S. & Widmer, G. (2013). *Maximum Filter Vibrato Suppression for Onset
  Detection.* DAFx-13.
  PDF: `https://www.cp.jku.at/research/papers/Boeck_Widmer_DAFx_2013.pdf`
  — SuperFlux; online peak-picking parameters; **targets vibrato, which a
  typewriter does not have**.
- Bello, J. P. et al. (2005). *A Tutorial on Onset Detection in Music
  Signals.* IEEE TSAP. DOI 10.1109/TSA.2005.851998.
  — **could not obtain the full text** (the mirrors I tried were bot-blocked).
  Referenced only via Dixon 2006 and Böck & Widmer 2013, which describe its
  peak-picking method.

**Reference implementations (source code read)**

- `aubio`, `src/onset/onset.c`, `src/onset/peakpicker.c` —
  `minioi` default 50 ms; median-based adaptive threshold, `win_post=5`,
  `win_pre=1`; per-method thresholds (hfc 0.058, specflux 0.18, complex 0.15).
- `librosa`, `librosa/onset.py` — `onset_detect` defaults "found by
  large-scale search": pre_max 30 ms, post_max 0 ms, pre_avg 100 ms,
  post_avg 100 ms, wait 30 ms, delta 0.07.

**Score following / alignment**

- Dixon, S. (2005). *Live Tracking of Musical Performances Using On-Line Time
  Warping.* DAFx-05. PDF: `https://www.dafx.de/paper-archive/2005/P_092.pdf`
  — linear-time online DTW; mean alignment error 59 ms, median 20 ms.
- Arzt, A., Widmer, G. & Dixon, S. (2008). *Automatic Page Turning for
  Musicians via Real-Time Machine Listening.* ECAI.
  DOI 10.3233/978-1-58603-891-5-241.
  PDF: `https://www.cp.jku.at/research/papers/Arzt_etal_ECAI_2008.pdf`
  — backward-forward correction; the closest published analogue to our task.
- Cont, A. (2010). *A Coupled Duration-Focused Architecture for Real-Time
  Music-to-Score Alignment.* IEEE TPAMI. DOI 10.1109/TPAMI.2009.106.
  — **abstract only, not read in full.** Listed for completeness.

**Specifications**

- W3C, *Web Audio API 1.1*, `https://webaudio.github.io/web-audio-api/`
  — §1.8.5–1.8.6 AnalyserNode (Blackman window, `smoothingTimeConstant`
  default 0.8, dB conversion, "most recent fftSize frames"); render quantum
  128 frames.
- W3C, *Media Capture and Streams*,
  `https://w3c.github.io/mediacapture-main/getusermedia.html`
  — `echoCancellation`, `autoGainControl`, `noiseSuppression` all default
  `true`; a source may refuse to disable them.
- W3C, *Device Orientation and Motion*,
  `https://w3c.github.io/deviceorientation/`
  — secure context; `requestPermission()`; sampling interval
  implementation-defined, frequency cap under discussion.

**Historical note (asked for, and it does not help)**

The Soviet "Selectric bug" installed in US Embassy typewriters in Moscow in
the 1970s was **magnetic, not acoustic** — it sensed the magnetic field of
the mechanism rotating the print head, and only worked because the IBM
Selectric is an *electric* machine with a golfball element. Soviet embassies
reportedly used manual typewriters for classified work specifically because
they are immune to it. [source: Wikipedia, "Keystroke logging", history
section — a tertiary source; I could not retrieve the NSA history
*Learning from the Enemy: The GUNMAN Project*, which was 403/404 on every
mirror I tried.] **There is nothing technically transferable here**: the
SM7 is mechanical, there is no such field, and the technique has no bearing
on acoustic detection. Included because it was asked about, and the honest
answer is that it is a good story and a dead end.

---

## Appendix: reproducing the measurements

All analysis scripts were written to `/tmp/tw-research/` and are not part of
the repo. Nothing was committed except this document. The BBC audio used for
testing is licensed for personal/educational use and must not be added to the
repository.

Key scripts, for anyone repeating this:

- `repeatability.py` — the phase-sweep test (§2.1). **The important one.**
- `coverage.py` — window/hop arithmetic (§2.2)
- `miss_diagnosis.mjs` — imports the real `listen.js` and traces dropped
  strikes (§2.3)
- `flux_experiment.py` — dB vs linear flux, bin-contribution analysis (§3.2)
- `spectrum.py` — where strike energy actually lives (§3.1)
- `find_cr.py` — carriage-return behaviour on real audio (§2.5, §4.3a)
- `bell.py` — event feature distributions, bell vs strike (§4.3c)
- `agc_noise.py` — gain invariance and noise sensitivity (§5.1)
- `proposed.py` — the recommended chain, same phase sweep (§5.2)

---

## Appendix B: what happened when §8.1–8.7 were built

Added after implementation. Items 1–7 and 12 are done; 8–11 are not, because
they need Lorenz's recordings and guessing was not on offer.

### The headline number held up

Same phase sweep, now against the real `StrikeDetector` in the repo rather
than a Python model of it (`/tmp/tw-research/sweep_new.mjs`, 20 phases over
one hop, 60 s of each recording):

| recording | before | after |
|---|---|---|
| Manual, medium typing | 8.7% | **3.0%** |
| Manual, fast, close | 18.6% | **1.4%** |
| Manual, 4 m away | (not run) | **1.7%** |

[measured] Close to the 3.9% / 2.8% / 2.4% the `proposed.py` prototype
predicted in §5.2. Two things the prototype did not test also came out
exactly invariant — the count does not move at all across delivery block
sizes from 128 to 4096 samples, nor across ±12 dB of recording level.

The gain result is worth a note, because §5.1 credited the *old* detector's
gain invariance to its dB-domain flux, and predicted that fixing the flux
would cost it. It did not: scoring against a running median absolute
deviation restores the invariance by a different route.

### Noise sensitivity improved more than expected

§9 measured the old chain losing 37% of its counts with broadband noise at
−50 dBFS and 77% at −40 dBFS. The rebuilt chain, same recordings, same noise
(`noise_new.mjs`): **+8%** at −50 dBFS and **+11%** at −40 dBFS on medium
typing, +2% and +3% on fast typing [measured]. The sign flipped: it now gains
a few false positives rather than losing most of its true ones. That is the
better failure, but it is still a failure, and it is not a claim that a noisy
room is solved.

### One recommendation was wrong as written

§4.3(d) proposes duration plus level to find the carriage return, on the
strength of a 13 dB separation between events ≥250 ms and events ≤100 ms.
That measurement is sound, but `find_cr.py` obtained it from a **5 ms RMS
envelope**, and the obvious implementation — reusing the level of the
analysis frame — does not reproduce it. A 2048-point window at 48 kHz is
43 ms long, so it smears each strike across its own width; five quick strikes
merge into one continuous 600 ms "event", and every burst of fast typing
reads as a line end. The document does not say this, and it cost an hour.

The working version runs the carriage-return test on its own 5 ms envelope,
independent of the FFT grid. The parameter that actually separates typing
from a return is not duration or level but the **maximum gap tolerated inside
one loud stretch**: consecutive keystrokes have real silence between them,
and a carriage return does not.

The "loud" gate needed measuring too. At floor+10 dB the reverberant tail of
one strike never falls back before the next arrives, and the detector reports
a line end every two or three seconds — which no typist produces. At
floor+14 dB the rate settles to roughly one per ten seconds, the same order
as the count of ≥250 ms events found by the separate route in §2.5. At
floor+18 dB it finds almost nothing. 14 dB was chosen on that basis.

**This is a plausibility argument, not a hit rate.** None of the BBC
recordings is labelled, so there is still no measurement of how many carriage
returns are found and how many are invented. §6.3 recording 5 is what would
settle it, and until then carriage-return detection is the least evidenced
part of the implementation despite being the highest-value one.

### Detail worth recording

- Comparing a stretch against "an ordinary strike" requires having heard
  ordinary strikes first. The detector therefore reports no line end until it
  has measured a handful, rather than falling back on an absolute level that
  would really be measuring how far away the phone is lying.
- `calibrate()` now fits the minimum inter-onset interval only. The old
  `reboundRatio` searched a second axis that the new peak picker does not
  have, and fitting a parameter that no longer exists would have been theatre.
- The synthetic carriage return in the old test file (`3 * Math.sin(...)`,
  a smooth swell over 500 ms) was replaced by a train of clatter at 4x the
  amplitude of a strike, per the 13 dB measurement. The first attempt made it
  merely *as loud* as a keystroke, and the test failed — correctly. The
  fixture was wrong, not the detector.

### Still unproven

Everything in §6.3 remains undone, and nothing here has met an Olympia SM7.
The band edges, the 90 ms minimum interval, and every carriage-return
threshold are the literature's numbers or numbers fitted to recordings of
other machines. The phase-sweep result is the one claim that does not depend
on any of that, because it compares the detector against itself.

---

## Appendix C: the SM7 finally speaks (2026-08-24)

Lorenz recorded seven labelled takes on the actual machine, phone ~30 cm
away: five sentences typed normally — 276 keystrokes over six typed lines,
with one carriage return mid-sentence where line one wrapped — plus ten
space-bar presses alone, and ten carriage returns alone. Ground truth is a
photograph of the typed sheet, counted character by character. The fitting
harness is `tools/listen-lab.mjs`; labels sit next to the audio in
`recordings/`. This appendix records what those takes settled, in the order
the guesses were made above.

### The space bar, §4.3(b), resolved — and the answer is yes

Two findings, and they point in opposite directions.

**Loudness and timing do not separate a space from its own echo.** The
space bar produces two clicks, press and release, the release 4.5–9 dB
quieter and 90–500 ms later [measured, take 6: 10 presses, 22 events
counted]. The release sits inside the loudness range of a genuinely soft
strike — the "varying strike force" test requires an 8 dB swing to
survive — and its delay sits inside ordinary typing intervals. A
time-window on the rebound gate was tried and made everything worse
(total miscount 39 → 64), because the release arrives later than any
window a fast typist would tolerate; the attempt is recorded at
`reboundDb` in the source so it is not re-invented.

**The spectrum separates a space from a letter cleanly.** §4.3(b)
reasoned mechanically that it should: a typebar ends its travel against
the platen, metal on hard rubber through paper, and the space bar drives
the escapement with no such impact. Measured, as a share of 0.5–12 kHz
energy falling below 2 kHz [measured, `features.mjs`]:

| events | q10 | median | q90 |
|---|---|---|---|
| space presses (take 6, spaces alone) | 0.68 | **0.72** | 0.75 |
| letter strikes (takes 1–5) | 0.08 | **0.13** | 0.62 |

Two clusters, far apart, and the histograms barely touch. How the reading
is taken matters more than the threshold does — four ways were compared
against the number of spaces on the photographed sheet:

| reading | spaces found (43 typed) |
|---|---|
| total energy, at the frame the flux peaks in | 30 |
| total energy, at the frame after | 36 |
| **new energy (flux), at the frame after** | **44** |
| new energy, unsquared | 21 |

[measured, `variants.mjs`, threshold 0.45] The winner is the principled
one: the room and the tail of the previous keystroke are in the total but
not in the difference, and by the following frame the whole transient has
entered the window. Squaring matters because a share of *energy* is what
is meant — unsquared, the high band wins on bin count alone, spanning
10 kHz against the low band's 1.5.

The detector now reports `lowShare` and `space` on every strike. Nothing
in the counting path acts on them, deliberately: the take that would
settle how to act — spaces with per-press ground-truth *timing*, so
press and release can be told apart individually — does not exist. What
this unlocks is level 2 of §4.4, where the app contributes what the
detector cannot know: where the spaces are in the line. For a motif with
a run of eighteen spaces, that is the difference between counting them
and merely knowing when the run has ended.

### The carriage return, §4.3(a), was two sounds all along

Ten labelled returns each produced a short loud stretch (~300 ms) and a
long one (700–1200 ms), **0.7–2.3 s apart**, peaking 10–15 dB above the
typing [measured, take 7]. The single-stretch model counted most of them
twice — or, mid-typing, not at all. The detector now gathers return-grade
stretches (long for a strike, louder than one) into a *cluster* and
reports once, when `returnClusterMs` has passed without another part.
Three hard lessons from the same take:

- The loudness reference must come from **accepted strikes**, not from
  loud envelope blips: twenty seconds of speech before one take set the
  blip-fed reference so low that the typing itself graded as returns, and
  the cluster swallowed half the recording as one thirty-second "return".
  `returnMaxMs` is the safety wall against any recurrence.
- A return's clatter trips the onset detector; strikes heard *between*
  the parts of a train are attributed to it only if another part follows.
- A recording that ends, or listening that stops, must `flush()` — a
  return in the last two seconds otherwise never reports.

### The fitted numbers, and what they verify to

Returns fitted to a 26-neighbour plateau; the winning values are now the
defaults (`returnGapMs` 25 → 80, `returnClusterMs` 1800). Strikes fitted
to `sensitivity 0.75, minIntervalMs 120, reboundDb 13` — kept in
`recordings/fit.json` as this machine's tuning rather than as defaults,
because the winner sat alone in the grid and 13 dB all but disarms the
gate that the 22-strike take of Appendix B motivated. Verified through
the untouched detector, typing takes: **−1, +2, +1, +2, 0** of 63+13, 51,
44, 58, 47 expected; every return in the typing takes found, including
the mid-sentence one. The two mechanism-only takes carry the rest: +11 on
spaces (releases), +22 on returns-only (clatter outside reported
windows), and returns-only cold-starts by design — nothing can be louder
than a strike before strikes exist (§"strikesBeforeReturn").

### What the session did not settle

- **Fast typing.** The "one line as fast as you can" take was never
  recorded, so `minIntervalMs 120` is unproven against speed. It is the
  first thing the next session should capture.
- **Spaces, individually.** Take 6 gives 22 events for 10 presses but no
  per-press timing, so which events are presses and which releases is not
  recoverable — five pairs sit 90–140 ms apart and look conclusive, the
  remaining twelve events do not pair up at all. A take that counts each
  press aloud as it happens would settle it.
- **Speech near the microphone.** Spoken labels cost little here but did
  produce sub-threshold events; the app should expect the first seconds
  after the button press to be unclean.
- **Whether ±1 per line suffices in use.** The LineTracker forgives one;
  the typing takes fit inside that per line, but only live use on the
  sheet will say whether the resets land where the typist needs them.
