# A pass through the whole app

Every control on the page followed to whatever it actually does, plus the
question the interface exists to answer: does the preview, the PDF and the
typing sheet all describe the same sheet of paper?

Line numbers are as of the commit that fixed each item.

Two files are deliberately untouched: `src/core/listen.js` and
`src/core/tap-worklet.js`. Anything found in them is listed under *Not
touched* at the end.

---

## Real faults, fixed

### 1. Lettering was drawn with a character the machine does not have

`src/ui/app.js:262` (before)

```js
const fill = have.includes('#') ? '#' : have.includes('H') ? 'H' : (have[0] ?? '#');
```

The Olympia SM7 has no `#`. Every lettering style on the machine this project
was written for fell through to `H` — and `H` is not the heaviest key it has
either. Measured at the atlas cell (16 × 27 px, 21 px DejaVu Sans Mono):

| key | coverage |
|-----|----------|
| `B` | 0.2043 |
| `M` | 0.1955 |
| `N` | 0.1927 |
| `W` | 0.1896 |
| `H` | 0.1708 |

Every word came out as a flat grey wall because it was being drawn in a
mid-weight character and nothing else. **Real fault, and the one that was
most visible on paper.**

**Done:** new `src/core/ink.js` builds a ramp of *n* characters from whatever
the machine actually has. Picked by **rank**, not by weight — the arithmetic
midpoint of the SM7's coverage range is 0.110, which selects `t`, a thin
vertical with a bar, because 60 of its 88 characters sit in the top half of
the range and only 28 in the bottom. By rank the middle is `2`, which is
genuinely a middle grey in a block.

Ties within three ranks (under 4% of the weight range, below what the eye
separates on paper) go to the character whose ink sits nearest the middle of
the cell. That is why the faint end is `.` and not `` ` ``: both are 0.017,
identical to any eye, but `` ` `` sits at 0.21 of the cell height and a block
of it reads as ticks floating over the letter rather than a pale surface.

Ramps produced for the SM7:

```
1 tone   B
2 tones  B -
3 tones  B 2 -
5 tones  B b 2 z -
```

Tests: `test/core.test.mjs`, section *choosing characters for a tone* — six
checks, including that the heaviest tone is not `H`.

### 2. The word box could not hold a second line, and did not wrap

`index.html:120` (before): `<input type="text" maxlength="40">`

No way to ask for two short words stacked, which fit a sheet that one long
one does not. A long word ran off the right of a box with no visible end.
**Real fault.**

**Done:** a wrapping `<textarea>`. A newline starts a second line of
lettering, stacked with a gap of a quarter of the block height — 2 rows under
BIG, 1 under BLOCK. One row under BIG crowds the caps of the next line;
three under BLOCK reads as two separate motifs. A blank input line survives
as a blank block, so it works as deliberate spacing rather than collapsing
away. `letter()` renders line by line and stacks the results.

### 3. "Raised" had no light direction

`src/core/lettering.js:302` (before)

The whole outline in one character, the interior in another. That is a hollow
letter with a fill: an edge lit from every side at once carries no light
direction, so nothing stands off the page. **Real fault — the style did not
do what its name says.**

**Done:** three tones. Light from the top left, as in any drawing that wants
to look solid — top and left edges heaviest, bottom and right edges faintest,
body between. On an SM7 that is `B` / `2` / `-`. `letter()` gained a third
placeholder `~`, and a machine with only two usable characters degrades to
the old two-tone version rather than failing; the faint tone falls back to
the *body*, never to the lit edge, because that would paint both edges the
same and give a solid blob.

Before (2 tones, `B`/`=`) and after (3 tones, `B`/`2`/`-`), same word:

```
BBBBBB                BBBBBB
B====B                B2222-
B====B                B2222-
B====B                B2222-
B=====BBBBBBBBBBBB    B22222BBBBBBBBBBBB
B================B    B2222222222222222-
BBBBBBBBBBBBBBBBBB    B-----------------
```

### 4. The ribbon's shadow scheme tested a fixed list of characters

`src/core/runs.js:285` (before)

```js
const SHADOW_CHARS = new Set(['+', '/', '_', '!', '(', ')', ':', '.', ',', '`']);
```

It named `+` and `:` because those were the only light characters the old
`app.js` could ever pick. Once the tones come from the machine the shadow is
`-` or `2`, neither of which was on the list, and the scheme reddened
nothing. **Real fault, and one that fault 1 would have introduced silently.**

**Done:** it asks the motif instead — anything lighter than the heaviest
character present. A list of characters cannot answer a question about *this*
motif; the motif can.

### 5. The reference table numbered its lines differently from everything else

`src/ui/sheet.js:135` and `src/ui/app.js:561` (before)

`renderTable(..., app.setup.advance)` added the paper feed. A word centred on
A4 wound on 31 lines, so the table called its first line **32** while the
sheet above it, the progress counter (`0 / 7 lines`) and the typing sheet in
the PDF all called it **1**. Four places, two schemes, and the odd one out was
the panel headed "for looking things up". **Real fault.**

**Done:** motif numbering everywhere. That is the checkable one — the paper
feed happens once, before typing, and afterwards nothing on the page or on
the machine tells you which absolute line of the sheet you are on. The
`startLine` parameter is gone rather than defaulted, so it cannot come back.

### 6. `draw()` re-read the current line from storage on every redraw

`src/ui/app.js:722` (before)

```js
const saved = load();
if (saved.at != null && saved.at < lines.length) app.at = saved.at;
```

At the end of *every* redraw. A stored number therefore outranked the running
one on any path that had not written to storage yet. **Real fault**, though
narrower than it looks: `go()` calls `save()`, so the common paths happen to
agree. A window resize with an unsaved position is the plain case.

**Done:** restored once at startup, in `fillSelects()`. `convert()` already
clamps it to the motif.

### 7. −1 moved the highlight but not the readout

`src/ui/app.js:975` (before)

`paintStrike()` redrew the line; `$('strikes')` was left showing the number
from before the correction. The button appeared to do nothing — on the one
control whose entire job is to correct a count that has gone wrong. **Real
fault.**

**Done:** the readout is updated with the highlight.

### 8. Learning a character set left the two views contradicting each other

`src/ui/app.js:1281` (before)

`app.chosen.clear(); repaint();` — the keyboard went dark, the text field
went on listing all 88 characters of the old machine. Measured: keys lit 0,
text field 88 characters, side by side in the same dialog. `sync()` was also
missing from the per-keystroke callback, so the field stayed stale for the
whole session and only caught up when learning stopped. **Real fault.**

**Done:** both views cleared, and both updated on every captured key.

### 9. The CLI printed `warning: [object Object]`

`tools/cli.mjs:126` (before)

```js
for (const w of setup.warnings) console.log(`warning: ${w}`);
```

`setUp()` returns `{ level, text }` so the interface can tell an
impossibility from an inconvenience. The web app handles both forms; the CLI
interpolated the object and lost the message entirely — including *"This will
not fit on A4"*, the one warning that matters. **Real fault.**

**Done:** the text is read out and the severity is printed as `CANNOT` or
`note`.

### 10. The character-swap warning outlived its motif

`src/ui/app.js:349`

`note()` is raised by the paste tab — *"Swapped out: @ — no equivalent on this
machine"* — and `#setupNote` sits beside the paper, **outside** the tab
panels. Switching to the lettering tab left it on screen for the rest of its
eight seconds, complaining about characters that nothing visible contained.
**Real fault, minor.**

**Done:** cleared on leaving the paste tab.

### 11. The width slider capped the picture before landscape could help

`src/ui/app.js:240`

Introduced by the landscape work rather than found: capping at the portrait
width first would crop a picture to 66 columns before anything asked whether
100 might fit sideways, making the new switch pointless.

**Done:** with landscape allowed the slider runs to whichever orientation
holds more, and `orient()` decides afterwards which one is used.

### 12. Imports that nothing calls

`src/ui/app.js:16` — `edges` and `keystrokes` imported from `convert.js`,
never called. `keystrokes` appears in the file only inside strings and
comments, which is why a plain grep looked reassuring. **Cosmetic**, but on
a page with no build step every import is a real fetch.

**Done:** removed. Both are still exported and still used by the tests.

---

## Looked at, not a problem

### `modeHint` and `invertHint` go stale after a tab switch

`src/ui/app.js:626`. Both are set unconditionally on every draw, so after
switching from the picture tab to lettering they still describe an outline
setting. But both sit **inside** the picture panel, which the tab strip sets
to `display: none` (`styles.css:244`). Nobody can see them.

Deliberately left. Clearing them would be a change nobody can observe, and it
would cost the test that checks every picture style explains itself — which
does read them, with the picture panel shut. `setupNote` is the one that
genuinely leaks, because it is outside the panels; see fault 10.

### `charsetOk`, `inkSet`, `measure`, `stepHands`, `letterHint`

Ids in `index.html` that no JavaScript looks up. Each is a real anchor:
`charsetOk` gives the dialog button its `value="ok"` for `dlg.returnValue`,
`stepTable` is styled by two CSS rules, the rest are `<details>`/`<fieldset>`
grouping and hint text that is written once in HTML and never changed.
Cosmetic at worst.

### `contrastOut`, `detailOut` look unwired

They are reached through a template literal, `$(\`${id}Out\`)` at
`src/ui/app.js:933`, along with `widthOut` and `inkAmountOut`. Not a fault;
noted because grep says otherwise and the next person will grep.

### The `depth` slider on a single-colour motif

Already handled by `inkLevels()` (`src/core/runs.js:242`, `app.js:212`):
depth and accent are dropped from the menu when the motif has one ink level,
because there is nothing to grade. Verified after the lettering changes:

```
block   levels=1  depth red at 0.1:30 0.3:30 0.5:30  (offered? no)
shadow  levels=2  depth red at 0.1:23 0.5:23 0.9:53
relief  levels=3  depth red at 0.1:83 0.5:171 0.9:270
```

Raised now moves in three steps instead of one, which is a side effect of
fault 3 rather than a fix of its own.

### `back1` and `sens` with nothing listening

Both are inside `#ear`, which is `hidden` until the microphone starts.
Clicking `back1` with no listener is harmless — `app.tracker?.strike(-1)`
short-circuits — and unreachable anyway.

### The keyboard shortcut guard

`src/ui/app.js:962`: `if (e.target?.matches?.('input, textarea, select')) return;`
Checked against the new `<textarea>` for the word box: Space and Enter go to
the box and do not advance the line. Correct as it stands.

### `usesTwo`, `charsUsed`, `columnOfStrike`, `runsToText`, `colourMap`

Exported and unused by `app.js`. `usesTwo` is used (`app.js:193`);
`columnOfStrike`, `runsToText` and `colourMap` are used by the CLI and the
tests. `charsUsed` had no caller at all — it does now, in the style hint.

---

## Not touched

`src/core/listen.js` and `src/core/tap-worklet.js` are being worked on in
parallel. Nothing was changed in either, and nothing was found in them from
the outside: the only calls into them from `app.js` are `StrikeListener`,
`LineTracker` and `METER_FULL_SCALE`, all of which resolve.

One thing worth passing on rather than fixing: `calibrate()` in
`app.js:1243` reaches into `l.opt.minIntervalMs` and `l.detector.opt` to open
the gate, which means the calibration path depends on the listener's internal
shape rather than on its interface. If that internal shape is being changed,
calibration will break silently — `npm test` covers `StrikeListener.calibrate`
directly but nothing exercises the button.

---

## Not done

- **The picture path is untested end to end.** Measuring glyph shapes needs a
  canvas; the browser test stubs one that returns a blank field, so
  `toCharacters` runs but has nothing to see. Everything about landscape and
  the tone ramp was checked on lettering and on the arithmetic, not on a
  photograph.
- **Nothing has been typed on a real machine.** The claim that `B`/`2`/`-`
  reads as a raised surface rests on the rendered ASCII, which is in this
  document, and on measured coverage — not on an SM7.
