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
- **Lettering** → words, or several lines of them, drawn from scratch
  (see *Lettering* below)
- **Landscape** → the sheet goes in on its long edge when the motif will not
  fit upright. Not a rotation of the artwork: type bars strike one way only,
  so the *paper* turns, not the letters. A4 at pica goes from 82 columns to
  116
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

Forty-one styles, built from five hand-drawn faces and a set of transforms:
hollowing, shearing, stencil bridges, doubling, shadows, relief, oblique
projection, draughted and rounded outlines, mark painting, half-tone screens
and tonal bands — each in a compact and a large size where it makes sense.

A newline starts a second line of letters, so two short words can be stacked
where one long one will not fit; a blank line leaves a gap.

**Lines too wide for the sheet break at spaces**, to the margins of whichever
way round the sheet goes in — `GUTEN MORGEN LYON` in Block is 101 columns on
an SM7 at pica, against the 66 an upright A4 holds inside its margins and the
100 it holds sideways. The orientation is chosen, not worked out: it used to
turn the sheet by itself whenever that saved rows, which meant the same
settings produced different paper depending on the word. A single word too
wide to break is left whole rather than hyphenated: the setup instructions
then say what to change, which is more use than something unreadable.

**The calligraphic hand is drawn to one rule.** Hold a broad nib at an angle
and it draws a hairline exactly when it travels up and to the right, and a
thick stroke everywhere else. That is the entire face: `##` for stems, bowls
and down-strokes, `/` for the up-strokes of A, K, V, X, Y and Z, and for the
flourishes that enter every letter at the cap and leave it below the
baseline. `/` also happens to be the one diagonal a typewriter can be relied
on to have, so the rule that makes the letters right is the rule that makes
them typeable.

The flourishes are derived rather than drawn into each glyph: a body is
eleven rows of letter, and the face says which column the pen lifts from and
which foot it sweeps away from. Thirty-eight hand-drawn swashes would be
thirty-eight slightly different swashes, and a hand that varies its exit
stroke at random does not read as a hand. It is a large face — sixteen rows,
and `TYPE` is 59 columns of the 82 an upright A4 holds — and there is no
compact version, because a flourish shortened until it fits is just a serif.

**Most of a face is which characters it is drawn with.** A typewriter has no
shading and no half tones, but it has ninety-odd shapes, and a great deal of
typewriter art works by picking the shape that matches the *direction* of a
stroke rather than its darkness: `_` where a stroke ends flat, `(` and `)`
where it turns, `!` where it runs down the page, `8` and `o` for a body and
its ends. One reading of each cell — which of its four sides are open — is
handed to the face, and the face names its own marks. That is where the
roman, ruled, bracketed and rounded-caps faces come from, and none of them
costs a keystroke more than a solid one: a key is a key.

**Graded faces take the ramp from the machine.** A letter shaded from `B`
through `M` and `2` and `-` to `'` is the plainest demonstration of the whole
idea — those five characters are read off an SM7 keyboard by rank, not
wished for. Bands are cut across the whole block rather than per letter, so a
word shades together instead of putting the dark end of an `O` beside the
light end of a `T`. On a machine stripped to two keys it comes out in two
bands rather than failing.

**Faces are written in their own marks; the machine is met at the end.** The
peaks face really does say `^`, the ruled face `|`, the bracketed face `[`
and `]` — none of which an Olympia SM7 has. Baking the SM7's answers into the
glyph data was the first attempt and it was the wrong one: it put one
machine's keyboard inside every letterform, and a machine that *does* have a
pipe would still have got an exclamation mark.

So there is a stand-in engine instead, in two stages. The substitution table
first, because it carries judgements a measurement cannot make: `^` and `´`
do not look alike at all — one is a tent, the other a single stroke — and a
shape match would sooner offer `A`. But `´` is right, because what matters is
what the mark is *for*. Then, where the table is silent, a measured match of
the log-polar shape descriptors the atlas already keeps for tone work, which
means a mark nobody has ever written a table entry for still finds the
nearest thing this machine can strike. The table stops being a list that has
to be maintained and becomes a list of exceptions.

Measuring needs a rendered glyph, so on the command line there is no second
stage — and that is reported rather than worked around. A mark with no table
entry and no canvas gets a refusal, not a silent tone match, which is the
same bargain `tableAtlas()` makes about shapes.

What comes out is a face that adapts instead of disappearing. Bracketed on a
generic pica QWERTY types `_` as `-`, `|` as `!` and `]` as `)` and says so;
before the engine it was simply unavailable there, because that machine has
no underscore and eight of these faces are drawn with one. Only a mark with
nothing at all to stand in for it greys a face out. Switching a key off under
Characters counts as the machine not having it, and the hint names what you
will actually strike rather than what the face asked for.

Three tests hold it together: every mark a style strikes is declared, every
declared mark has a stand-in on both stock machines, and — the one that
matters — nothing reaches the sheet that the machine cannot type.

**Raised uses three weights, not two.** An outline drawn in one character
with the interior in another is a hollow letter with a fill — an edge lit
from every side at once has no light direction and nothing stands off the
page. Light from the top left, heaviest character on the top and left edges,
faintest on the bottom and right, body between.

**The characters come from your machine, not from a wish.** A generator that
reaches for `#` and falls back to `H` produces a flat grey wall on a machine
with no `#` — and on an Olympia SM7 `H` is not even the darkest key: measured
at the sampling cell it covers 0.171 against 0.204 for `B` and 0.196 for `M`.
So the tones are picked from what the machine actually has, by **rank** rather
than by coverage. The arithmetic midpoint of the SM7's range selects `t`, a
thin vertical with a bar, because 60 of its 88 characters sit in the top half
of the range; by rank the middle is `2`, which really is a middle grey in a
block. Three tones on an SM7 come out as `B` `2` `-`.

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
only so many ways to draw a capital A out of blocks, and the calligraphic
hand is informed by `caligraphy` and `caligraphy2` in the same way — but no
glyph data is copied.

That is deliberate. The FIGlet collection has a patchwork of licences: some
public domain, some free-but-no-redistribution, a few with no stated terms at
all. Bundling them would push that problem onto everyone who forks this.

To use them anyway, point [`figlet`](https://github.com/patorjk/figlet.js) at
your own copy of the `.flf` files. They are worth having; they just are not
ours to ship.

Credit where due: the FIGlet format and its font collection come from the
FIGlet project (figlet.org) and decades of contributors.

Several faces here answer a particular FIGlet one. They are redrawn, not
converted, and they keep the marks the originals were built from — where your
machine has not got one, the stand-in engine answers for it:

| FIGlet          | Here                    | What changed |
| --------------- | ----------------------- | ------------ |
| Caligraphy2     | Calligraphic            | 20 rows down to 16, so a word fits a sheet |
| NV Script       | Calligraphic, inked     | the same hand, painted in `8` `d` `b` `P` `Y` |
| Fraktur         | Gothic                  | redrawn: a broken hand, not a bold roman |
| Konto           | Miniature               | three rows rather than two, to stay legible |
| O8              | Rings                   | — |
| OS2             | Rings on a rule         | — |
| Roman           | Roman                   | — |
| Georgia11       | Roman, heavy            | — |
| Rowan Cap       | Rounded caps            | — |
| Kban            | Ruled                   | the feet are `,`: `.` means paper in glyph data |
| Henry 3D        | Bracketed               | — |
| Catwalk         | Catwalk                 | — |
| Peaks           | Peaks                   | — |
| Lean            | Leaning strokes         | — |
| Italic          | Italic outline          | — |
| Gradient        | Graded                  | the ramp comes from your machine, not from `@ # % &` |
| Poison          | Corroded                | likewise, and the corrosion is deterministic |
| S Blood         | Running ink             | likewise; the drips are decided by column, so it types the same twice |
| Filter          | Screened                | a real two-weight checker instead of a fixed mark set |

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

Same modules, no browser, no dependencies:

```sh
node tools/cli.mjs machines
node tools/cli.mjs text "HELLO" --style relief
node tools/cli.mjs text 'PIANO\nSTIMMER' --style block
node tools/cli.mjs file rose.txt --paper a4 --red 0-15 --pdf out.pdf
node tools/cli.mjs image drawing.png --mode tone --pdf out.pdf
```

`--json` on any command puts the whole result on stdout as one object —
size, keystrokes, margin stops, warnings, and the lines themselves — so a
script or an agent never has to parse the human output. Failures use the
same shape (`{"ok": false, "error": …}`) and exit non-zero, rather than a
stack trace where the answer should be. Full reference, including the JSON
shapes: [docs/command-line.md](docs/command-line.md).

Pictures are PNG only. Silhouettes and line drawings are what survives the
trip to a typewriter, and that material is already PNG; a JPEG decoder would
be several hundred lines of DCT earning its keep on photographs, which do
not survive the trip anyway. Anything else is turned away by name, with the
conversion command in the message.

### Why did my picture come out like that?

```sh
node tools/cli.mjs inspect drawing.png
```

`inspect` reports what each step of the pipeline did to the ink, and says
what it makes of the result:

```
strokes 2.2 px across 1.6% of the frame — a drawing, so the blur is held to 1.1 px

stage       size        strongest   average   inked
ink         900×900         1.000    0.0089    1.63%
blur        900×900         0.612    0.0089    4.10%
normalise   900×900         1.000    0.0325    4.83%
contrast    900×900         1.000    0.0316    3.91%
crop        721×664         1.000    0.0535    6.62%

grid 60 × 33, 482 of 1980 cells inked, 536 keystrokes
```

**strongest** is the darkest single pixel; under `0.04` nothing is typed at
all, so a value below that means an empty sheet and the finding will name the
step that caused it. **average** should stay roughly level across the blur —
a drop there means ink was destroyed rather than spread. Too *much* ink is
reported as well, because a sheet that is 97% inked is a negative nobody
turned round, and that one looks like it worked until you sit down to type it.

`--preview out.png` writes the prepared image, which answers the other half
of the question: the numbers say the ink survived, the picture says whether
it still looks like the drawing.

### Shapes on the command line

"Follow the shapes" compares each cell against a *rendered* copy of every
character, and rendering needs a canvas. Without one the command line matches
by tone instead and says so — it does not quietly hand back a shape match
that is really a tone match. Three of the four styles are unaffected.

To get the real thing, measure the glyphs once in a browser and pass them
along:

```sh
python3 -m http.server 8000      # then open /tools/atlas.html
node tools/cli.mjs image drawing.png --mode shape --atlas atlas-olympia-sm7.json
```

Tests:

```sh
npm test          # core, pictures, png, the cli itself, sheet, pdf, strikes
npm run test:browser   # loads the real page in jsdom and drives it
```

## Licence

MIT. See [LICENSE](LICENSE).
