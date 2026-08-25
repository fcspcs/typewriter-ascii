# The command line

Everything the page does, without the page. No build step, no dependencies —
Node 20 or newer and the repository.

This exists for three kinds of caller: someone scripting a batch of sheets,
an agent driving the tool without a browser, and anyone trying to work out
why a picture came out wrong. The third one is why `inspect` is here.

```sh
node tools/cli.mjs <command> [target] [options]
```

## Commands

| Command | What it does |
| --- | --- |
| `image <path.png>` | Turn a picture into something typeable |
| `inspect <path.png>` | Report what each step of the picture pipeline did |
| `file <path.txt>` | Lay out ASCII art that already exists |
| `text <word>` | Render a word as large letters |
| `machines` | List machine profiles |
| `papers` | List paper sizes |

## Options

Everywhere:

| Option | Default | |
| --- | --- | --- |
| `--machine <id>` | `olympia-sm7` | from `machines` |
| `--paper <id>` | `a4` | from `papers` |
| `--align <centre\|topleft>` | `centre` | |
| `--turn <none\|left\|right>` | `none` | which way you turn the finished sheet |
| `--across <1-4>` | `1` | sheets side by side |
| `--down <1-4>` | `1` | rows of them |
| `--red <lines>` | none | e.g. `0-15,20`, for a two-colour ribbon |
| `--pdf <path>` | none | also write a printable PDF |
| `--json` | off | the whole result as one object on stdout |
| `--quiet` | off | skip the line-by-line typing instructions |

`text` only:

| Option | Default | |
| --- | --- | --- |
| `--flf <path.flf>` | none | set the word in a FIGlet font; nineteen ship in `fonts/` |
| `--style <oblique\|obliqueBig>` | `oblique` | the drawn three-dimensional face |
| `--width <n>` | `60` | columns to break lines at, capped by the sheet |

`\n` in the word starts a second line of letters, since a shell makes a
real newline awkward to type. Marks the machine has not got are typed as
their stand-ins and named; a mark with no stand-in is left blank, by name.
With `--turn` the word is set as a picture rather than laid down cell by
cell — see [lettering.md](lettering.md#sideways-the-word-becomes-a-picture)
— which means `--atlas` applies to it too.

`--width` is the same flag and the same default a picture is fitted to,
because the page offers one control for both. It is a real cap: lines break
at spaces to reach it, so a sentence cannot overrun the paper however long
it is. A single word wider than it is the one thing left over — a
letterform split down the middle is unreadable, so it is left whole and
`setUp()` refuses the sheet with a reason rather than hyphenating.

Pictures only:

| Option | Default | |
| --- | --- | --- |
| `--mode <shape\|tone\|outline\|sentence>` | `shape` | |
| `--contrast <50…300>` | `130` | the slider, as a percentage |
| `--detail <0…100>` | `45` | the slider; lower blurs more |
| `--invert <auto\|no\|yes>` | `auto` | light drawing on a dark ground |
| `--width <n>` | `60` | columns as you look at it, capped by the sheet; `text` reads it too |
| `--sentence "<text>"` | *she loved him…* | for `--mode sentence` |
| `--atlas <path.json>` | none | measured glyph shapes, see below |
| `--preview <path.png>` | none | write the prepared image out to look at |

Unknown ids, out-of-range modes and non-numeric sliders are refused rather
than defaulted. A typo that silently produces a plausible sheet for the wrong
machine costs more than an error does.

### Several sheets

`--across` and `--down` spread one motif over a grid of sheets, the same way
the *Compose* block does on the page. Each sheet is a separate visit to the
machine, so the output gives each one its own stops, its own wind-on and its
own listing with line numbers from one — and `--pdf` writes every sheet at
true size followed by its own ruled pages.

```
$ cli.mjs image cat.png --across 2 --down 2 --width 120
120 × 90 characters, 10800 keystrokes, 2 × 2 A4, Olympia SM7 de Luxe
4 sheets, 4 of them typed on.
```

The composite grid is the single sheet's grid multiplied, not the composite's
millimetres divided, so no cell ever lands across a join — see *Compose* in
the README for why that is the only arrangement in which every cell can be
struck. `--json` reports every sheet under `sheets`, each with the cell it
starts at and the lines that go on it.

### How wide, and which way it is read

Both used to decide themselves, and both now do what they are told.

`--turn` has had two predecessors and both were wrong in different ways.
`--landscape` meant "turn the sheet if that comes out shorter", so the same
command gave an upright sheet or a turned one depending on the motif.
`--orientation sideways` made it a stated choice but stated it about the
*paper* — feed the sheet in on its long edge — which is 297 mm of writing
line on a machine whose carriage scale ends at 249. Both meant "I want this
read sideways", which is still a thing you can ask for, so both now mean
`--turn left`.

The paper goes in upright either way. What `--turn` decides is that the motif
is laid on its side before it is typed, and which way you turn the finished
sheet to look at it. Turning buys millimetres rather than columns: on A4 at
pica the margins hold 66 × 60 cells upright and 60 × 66 turned, but those 60
reach 254 mm of paper against 168 for the 66.

`--width` stopped at the usable area, which on an upright A4 at pica is 66
columns. That made a perfectly typeable 78-column motif unaskable. The limit
is now the edge of the paper, and the margins are a note instead:

| A4 at 10 cpi | inside the margins | edge to edge |
| --- | --- | --- |
| upright | 66 | 82 |
| sideways | 100 | 116 |

Past the margins, `setUp()` returns a `note` saying the stops move in less.
Past the edge of the paper it returns a `stop`, because no margin technique
makes that fit.

## Output for programs

`--json` prints one object and nothing else. Success:

```json
{
  "ok": true,
  "size": { "width": 48, "height": 27 },
  "keystrokes": { "total": 486, "black": 486, "red": 0 },
  "paper": { "id": "a4", "name": "A4", "turn": "none" },
  "machine": { "id": "olympia-sm7", "name": "Olympia SM7 de Luxe" },
  "setup": { "left": 17, "paperGuide": null, "advance": 21, "marginRelease": false },
  "warnings": [{ "level": "note", "text": "…" }],
  "instructions": [{ "heading": "Left margin stop to 17", "body": "…" }],
  "notes": ["…"],
  "lines": ["  ,;:  ", "…"]
}
```

Failure uses the same door — an object, not a stack trace — and exits `1`:

```json
{ "ok": false, "error": "No machine called \"smith-corona-9000\". Try: cli.mjs machines" }
```

`warnings` carries `level: "stop"` when the motif will not physically fit;
that is the one worth branching on.

## Pictures are PNG

Silhouettes and line drawings are what survive the trip to a typewriter, and
that material is already PNG. A JPEG decoder would be several hundred lines
of DCT earning its keep on photographs, which do not survive the trip anyway.
Other formats are turned away by name, with the conversion command in the
message, rather than half-decoded into something confusing.

Interlaced (Adam7) PNGs are refused too. Re-save without interlacing.

## Finding out what happened to a picture

A blank sheet is not a bad character match. It is ink that stopped existing
somewhere, and the only question worth answering is where.

```sh
node tools/cli.mjs inspect drawing.png --contrast 171 --detail 44
```

```
strokes 2.2 px across 1.6% of the frame — a drawing, so the blur is held to 1.1 px

stage       size        strongest   average   inked
ink         900×900         1.000    0.0089    1.63%
blur        900×900         0.612    0.0089    4.10%
normalise   900×900         1.000    0.0325    4.83%
contrast    900×900         1.000    0.0316    3.91%
crop        721×664         1.000    0.0535    6.62%

grid 60 × 33, 482 of 1980 cells inked, 536 keystrokes, result 60 × 33

* 482 of 1980 cells carry enough ink to be typed, 536 keystrokes in all.
```

The pipeline runs `ink → blur → normalise → contrast → [outline] → crop`.
The columns:

- **strongest** — the darkest single pixel. Under `0.04` nothing is typed at
  all, so a value below that means an empty sheet.
- **average** — total ink over the whole frame. It should stay roughly level
  across the blur; a drop means ink was destroyed, not spread.
- **inked** — how much of the frame is above the blank threshold.

The header line is the blur's own reasoning. A picture sparse enough to be a
drawing has its blur radius held to half the measured stroke, because
smoothing by more than a line is thick does not soften it, it deletes it. A
photograph is dense, is not held back, and still loses the texture it needs
to lose.

Findings it will raise:

| When | What it says |
| --- | --- |
| Nothing is typed | which step the ink fell below `0.04` at |
| Ink vanished at the blur | measured stroke width against the radius used |
| Contrast clamped it | the floor `0.5 - 0.5/amount` against the actual peak |
| Normalise did nothing | the picture was left at its original peak |
| Nearly every cell inked | a negative nobody turned round — try `--invert` |
| `sentence` typed almost nothing | it fills areas, and lines have none |

`--json` gives the same as `stages`, `findings`, `strokes`, `cells` and
`grid`.

`--preview out.png` writes the prepared image. The numbers tell you the ink
survived; only the picture tells you it still looks like the drawing.

## Shapes without a browser

"Follow the shapes" compares each cell against a log-polar histogram of every
character *as rendered*. Rendering needs a canvas, and Node has not got one.

Rather than pretend, the command line says what it did:

```
note: No glyph shapes available without a canvas, so "shape" matched by tone
      instead. Pass --atlas <file.json> for a measured atlas.
```

`tone`, `outline` and `sentence` are unaffected — the weights they need are
measured and carried in `src/core/ink.js`, and `tableAtlas()` builds an atlas
from them. Coverage there is interpolated across the ranking rather than
measured per character, so tone mode is close to the browser, not identical
to it.

For the real thing, measure once where the canvas is:

```sh
python3 -m http.server 8000        # then open /tools/atlas.html
node tools/cli.mjs image drawing.png --mode shape --atlas atlas-olympia-sm7.json
```

## Recipes

```sh
# Batch a folder, one PDF each
for f in art/*.png; do
  node tools/cli.mjs image "$f" --mode tone --quiet --pdf "out/$(basename "$f" .png).pdf"
done

# Will it fit before committing to it?
node tools/cli.mjs image big.png --json | jq '.warnings[] | select(.level=="stop")'

# Search for settings that actually produce something
for c in 90 110 130 170; do
  echo -n "contrast $c: "
  node tools/cli.mjs inspect drawing.png --contrast $c --json | jq -r '.cells.inked'
done
```
