# Typewriter ASCII

Turn images and text into ASCII art you can actually type on a mechanical
typewriter.

Not "ASCII art you look at on a screen". Art you sit down and type, one
keystroke at a time, on a machine with no undo. That constraint changes
everything about how it has to work.

Runs entirely in your browser. Nothing is uploaded.

## Why this is not a normal ASCII generator

A generator that ignores the machine produces art that cannot be typed:

- **Every space is a keystroke.** Lose count in a run of eighteen spaces and
  everything after it shifts by one column. So spaces are counted, grouped in
  fives, and shown as explicitly as the characters.
- **Machines lack characters.** The Olympia SM7 has no zero — you type a
  capital `O`. No `@`, `#`, `$`, `*`, `[`, `]`, `<`, `>` either. Art using
  them is art you cannot type.
- **The margin stop has limits.** When a motif starts further left than the
  stop reaches, you do not move the stop — you move the *paper*, using the
  paper guide. The setup instructions work this out for you.
- **A two-colour ribbon is one pass per colour.** All the black first, then
  switch. The first strike after a switch smears, so strike twice on scrap.

## What it does

- **Images** → shape-matched characters, tone-matched characters, outline
  only, or a repeating sentence that reads continuously through the picture
- **Lettering** → words in four faces, drawn from scratch (see *Fonts* below)
- **Existing art** → paste it in; characters your machine lacks are swapped
  for the nearest shape it has, and you are told what changed
- **Setup instructions** → paper guide, margin stops, how far to wind on
- **A sheet you can follow** → the current line opens in place and shows what
  to type; the rest stays as motif so you always see where you are
- **Listening** → it counts your keystrokes by ear, and resets at every
  carriage return

## Keeping your hands on the machine

The whole point is that you never reach for the screen. Two ways:

**A Bluetooth camera shutter remote**, the ten-euro kind sold for phone
selfies. It enumerates as a keyboard, and the app already advances the line on
Space, Enter or ↓. Pair it, tape it where your wrist rests or put a foot
switch under the desk, press it at the end of each line. Nothing to install.
This is the reliable option, and it is worth using even alongside the
microphone.

**Listening**, described below, which counts the strikes within a line.

## Listening: how it works, and what it is worth

A keystroke is not one sound: the type bar hits the platen and then falls
back. A detector that only asks "was that loud enough" counts every keystroke
twice.

1. **A fixed 10 ms hop on the audio clock.** An `AudioWorklet` hands over
   every block of samples in order and the detector frames them itself, so
   nothing is skipped and the spacing never varies. Event times are counted
   from the samples, not read off the wall clock. The first version analysed
   from `requestAnimationFrame`, and the same recording counted 9–19%
   differently depending on nothing but where the frames happened to land.
2. **Spectral flux on linear magnitudes, 500 Hz to 12 kHz.** The sum of
   *positive* frame-to-frame changes in magnitude. A strike is a sudden
   broadband rise; hum, voices and the carriage sliding produce very little.
   The band follows Zhuang et al. 2005 and is stated in hertz, so it means
   the same thing on a device that records at 44.1 kHz and one that records
   at 48 kHz.
3. **A threshold relative to the room.** Flux is scored against a running
   median and a running median absolute deviation, so a quiet room and a
   noisy café both work and the recording level does not matter.
4. **The carriage return resets the count.** This matters more than any of
   the above. A counter accumulates its own errors, so even a very good one
   is wrong about the column by the end of a page; resetting at each line end
   confines a mistake to the line it happened on.
5. **It says when it is lost.** If the count at a line end disagrees with
   what the line holds, it says so and asks you to click where you are,
   instead of showing a column it cannot stand behind. You are looking at the
   paper, not the screen, and the machine has no undo — a display that is
   quietly one column out is worse than no display at all.

**Machine learning would work, and it is the wrong tool here.** It would need
labelled recordings from every make of typewriter, ship megabytes of model,
drain the battery, and when it miscounts nobody could say why. Onset detection
is the standard approach for percussive events in audio, it runs anywhere, and
every parameter means something you can explain.

If the defaults do not suit your machine, **calibrate** measures it: type
twenty characters and it fits the minimum interval to the rebound delay of
that particular typewriter. That is the honest version of "learning from
data" — a few numbers you can read, not a black box.

The reasoning, the measurements and the sources are written up in
**[docs/listening-research.md](docs/listening-research.md)**, including what
remains unproven. Everything above was fitted against public recordings of
*other* manual typewriters; nobody has yet pointed it at an Olympia SM7.

## Adding your own machine

Machine profiles are plain data in [`src/profiles/index.js`](src/profiles/index.js).
Copy the closest entry, change what differs, open a pull request. No other
code needs to know.

Full instructions, including how to measure a machine you know nothing about:
**[docs/adding-a-machine.md](docs/adding-a-machine.md)**.

The pitch — how far the carriage steps for each character — is worth
measuring even on a machine already listed, because the same model was often
built in both. **Your machine → measure your machine** walks you through it:
type forty capital M, measure first letter to last, and the page resizes
itself around the answer. It refuses to guess when the reading falls between
the two standard pitches, rather than rounding a mistake into every sheet you
ever type.

If you would rather not think about layouts at all, the **characters** dialog
has *learn from typing*: press every key your machine has and it records what
they produce.

## Things the machine can do that a printer cannot

Half spacing sideways and downwards, typing outside the margin stops, the
invisible ribbon setting for rehearsing a line, and why the underscore prints
black when you have selected red: **[docs/machine-tricks.md](docs/machine-tricks.md)**.

## Lettering

Twenty-one styles, built from two hand-drawn faces and a set of transforms:
hollowing, shearing, stencil bridges, doubling, shadows, relief, oblique
projection, draughted and rounded outlines — each in a compact and a large
size where it makes sense.

**Every style is checked against the machine.** The classic isometric and
relief FIGlet faces all need a backslash, and a great many typewriters —
the Olympia SM7 among them — have no backslash key, nor a pipe, nor a tilde.
So the three-dimensional face here uses *oblique* projection rather than
isometric: every depth line runs at the same 45-degree angle, so one `/`
does the work of `/` and `\`. Draughtsmen used oblique for the same reason,
because it is easier to draw. The rounded face draws its edges with
brackets, and the draughted face uses `!` for verticals — an old typewriter-
art habit that exists precisely because there is no pipe.

A test renders every style in every letter and digit and fails if a single
character is not on the machine.

Keystrokes vary a lot between them. On the same word, hollow faces cost
roughly a third of what solid ones do, which matters when you are the printer.

The letterforms are drawn from scratch and MIT-licensed like the rest of the
project. They are *informed* by the classic FIGlet faces — anyone who has
seen `banner` or `slant` will spot the family resemblance, because there are
only so many ways to draw a capital A out of blocks — but no glyph data is
copied.

That is deliberate. The FIGlet collection has a patchwork of licences: some
public domain, some free-but-no-redistribution, a few with no stated terms at
all. Bundling them would push that problem onto everyone who forks this.

To use them anyway, point [`figlet`](https://github.com/patorjk/figlet.js) at
your own copy of the `.flf` files. They are worth having; they just are not
ours to ship.

Credit where due: the FIGlet format and its font collection come from the
FIGlet project (figlet.org) and decades of contributors.

## Prior art

The shape-matching mode follows Xu, Zhang and Wong, *Structure-based ASCII
Art* (SIGGRAPH 2010). The insight worth stealing: match the **shape** of a
character against the shape of the cell, not just its darkness. Tone matching
alone gives you halftone mush; shape matching gives you something that reads
as a drawing.

## Running it

No build step. It is ES modules and one stylesheet.

```sh
python3 -m http.server 8000     # or any static server
```

Then open `http://localhost:8000`.

**The microphone needs `https` or a locally-opened file.** Browsers refuse it
over plain `http` on a network address — that is a browser rule, not a bug
here.

## From the command line

Same modules, no browser:

```sh
node tools/cli.mjs machines
node tools/cli.mjs text "HELLO" --style outline
node tools/cli.mjs file rose.txt --paper a4 --red 0-15 --pdf out.pdf
```

Picture conversion is web-only: measuring glyph shapes needs a canvas, and
faking one on the command line would mean maintaining a second version of
the part that matters most.

Tests:

```sh
npm test          # core, sheet, pdf, strike detection
npm run test:browser   # loads the real page in jsdom and drives it
```

## Licence

MIT. See [LICENSE](LICENSE).
