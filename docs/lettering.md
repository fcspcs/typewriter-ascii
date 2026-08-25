# Lettering: forty-one faces for ninety-odd shapes

Forty-one styles, built from five hand-drawn faces and a set of transforms:
hollowing, shearing, stencil bridges, doubling, shadows, relief, oblique
projection, draughted and rounded outlines, mark painting, half-tone screens
and tonal bands — each in a compact and a large size where it makes sense.

A newline starts a second line of letters, so two short words can be stacked
where one long one will not fit; a blank line leaves a gap.

**Lines too wide for the sheet break at spaces**, to the margins of the way
the motif will be read — `GUTEN MORGEN LYON` in Block is 101 columns on an
SM7 at pica, against the 66 an upright A4 holds inside its margins and the 60
it holds when the motif is planned sideways. Sideways wraps *narrower*, not
wider: turning buys millimetres rather than columns (see *Sideways* in the
[README](../README.md#sideways)). How it will be read is chosen, not worked
out — it used to turn the sheet by itself whenever that saved rows, which
meant the same settings produced different paper depending on the word. A
single word too wide to break is left whole rather than hyphenated: the
setup instructions then say what to change, which is more use than something
unreadable.

## The calligraphic hand

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

## Direction, not darkness

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

## The stand-in engine

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

## Light has a direction

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

## What it costs

Keystrokes vary a lot between faces. On the same word, hollow faces cost
roughly a third of what solid ones do, which matters when you are the
printer. `TYPE` on an SM7: 24 keystrokes in Miniature, 44 in Block, 162 in
the calligraphic hand, 327 in the three-dimensional face.

## The FIGlet lineage

The letterforms are drawn from scratch and MIT-licensed like the rest of the
project. They are *informed* by the classic FIGlet faces — anyone who has
seen `banner` or `slant` will spot the family resemblance, because there are
only so many ways to draw a capital A out of blocks, and the calligraphic
hand is informed by `caligraphy` and `caligraphy2` in the same way — but no
glyph data is copied.

**Or set the real thing.** Redrawn is not identical, and sometimes identical
is the point. The program reads FIGlet's own `.flf` font files and sets type
with the real layout algorithm — full width, kerning, and smushing with the
six controlled rules of the FIGfont standard — so the output is pixel for
pixel what the TAAG site shows. Characters your machine has not got go
through the same stand-in engine as everything else, and you are told what
will be typed in their place; only a character with no stand-in at all is
left blank, by name.

Nineteen fonts ship in [`fonts/`](../fonts/), redistributed as received from
the [FIGlet collection](https://github.com/patorjk/figlet.js) the way figlet
itself, every Linux distribution and the TAAG site have redistributed them
for thirty years. They are the work of their authors, who are named in
[`fonts/README.md`](../fonts/README.md); they are **not** covered by this
project's MIT licence.

In the browser they sit in the face picker, under their own group; the file
is fetched the first time a font is chosen. On the command line:

```sh
node tools/cli.mjs text "HELLO" --flf fonts/Roman.flf
```

Any `.flf` you drop into the folder works with `--flf` as it is, and joins
the browser's picker once it is named in [`fonts/index.json`](../fonts/index.json).

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
