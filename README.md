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
- **Listening** → it counts your keystrokes by ear and advances on its own

## Listening: how it works, and why not machine learning

A keystroke is not one sound. The type bar hits the platen, then falls back;
the space bar clicks going down and coming up. A detector that only asks "was
that loud enough" counts every keystroke twice. That was the first version's
bug.

What it does instead, in three stages:

1. **Onset detection, not level detection.** Spectral flux over the upper
   spectrum — the sum of *positive* frame-to-frame energy changes. A strike is
   a sudden broadband rise. Hum, voices and the carriage sliding produce very
   little flux.
2. **Adaptive threshold.** Compared against a running median of recent flux,
   so a quiet room and a noisy café both work.
3. **Peak picking with a refractory window.** Do not fire on crossing the
   threshold — wait for the burst to actually peak, then stay deaf for ~85 ms.
   The rebound is always quieter and lands inside that window.

A **slope test** keeps the carriage return out: it swells over hundreds of
milliseconds, where a strike jumps within one or two frames.

**Machine learning would work, and it is the wrong tool here.** It would need
labelled recordings from every make of typewriter, ship megabytes of model,
drain the battery, and when it miscounts nobody could say why. Onset detection
is the standard approach for percussive events in audio, it is a few dozen
lines, it runs anywhere, and every parameter means something you can explain.

If the defaults do not suit your machine, **calibrate** measures it: type
twenty characters and it fits the refractory window to the rebound delay of
that particular typewriter. That is the honest version of "learning from
data" — a few numbers you can read, not a black box.

## Adding your own machine

Machine profiles are plain data in [`src/profiles/index.js`](src/profiles/index.js).
Copy the closest entry, change what differs, open a pull request. No other
code needs to know.

Full instructions, including how to measure a machine you know nothing about:
**[docs/adding-a-machine.md](docs/adding-a-machine.md)**.

If you would rather not think about layouts at all, the **characters** dialog
has *learn from typing*: press every key your machine has and it records what
they produce.

## Things the machine can do that a printer cannot

Half spacing sideways and downwards, typing outside the margin stops, the
invisible ribbon setting for rehearsing a line, and why the underscore prints
black when you have selected red: **[docs/machine-tricks.md](docs/machine-tricks.md)**.

## Fonts

The lettering faces are drawn from scratch and MIT-licensed like the rest of
the project.

They are deliberately **not** the classic FIGlet collection. Those fonts are
wonderful, but their licences are a patchwork — some public domain, some
free-but-no-redistribution, a few with no stated terms at all. Bundling them
would push that mess onto everyone who forks this.

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

Tests:

```sh
npm test
```

## Licence

MIT. See [LICENSE](LICENSE).
