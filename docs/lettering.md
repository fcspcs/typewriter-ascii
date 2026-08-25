# Lettering: real fonts, and one face no font file can be

The lettering tab sets a word in one of the nineteen FIGlet fonts that ship
in [`fonts/`](../fonts/) — or in the drawn three-dimensional face, which is
the one face a font file cannot provide. That is the whole list, and it is
deliberately not longer: this project used to carry forty-one faces redrawn
*in the style of* the classic FIGlet ones, and redrawn is simply not as good
as the real thing. The redrawings went; the originals stayed.

## The real fonts

The fonts are read and set with the real layout algorithm — full width,
kerning, and smushing with the six controlled rules of the FIGfont standard
— so the output is pixel for pixel what the TAAG site shows, before the
machine has its say. They are redistributed **as received** and credited to
their authors in [`fonts/README.md`](../fonts/README.md); they are not
covered by this project's MIT licence.

In the browser they lead the face picker; the file is fetched the first
time a font is chosen. On the command line:

```sh
node tools/cli.mjs text "HELLO" --flf fonts/Roman.flf
```

Any `.flf` you drop into the folder works with `--flf` as it is, and joins
the browser's picker once it is named in
[`fonts/index.json`](../fonts/index.json).

Credit where due: the FIGlet format and its font collection come from the
FIGlet project (figlet.org) and decades of contributors.

## The stand-in engine

**Fonts are set in their own marks; the machine is met at the end.**
Caligraphy2 really does say `#`, and an Olympia SM7 has no `#` key. Baking
one machine's answers into the setting would be the wrong fix — a machine
that *does* have the mark should get it — so there is a stand-in engine
instead, in two stages.

The substitution table first, because it carries judgements a measurement
cannot make: `^` and `´` do not look alike at all — one is a tent, the
other a single stroke — and a shape match would sooner offer `A`. But `´`
is right, because what matters is what the mark is *for*. Then, where the
table is silent, a measured match of the log-polar shape descriptors the
atlas already keeps for tone work, which means a mark nobody has ever
written a table entry for still finds the nearest thing this machine can
strike. The table stops being a list that has to be maintained and becomes
a list of exceptions.

Measuring needs a rendered glyph, so on the command line there is no second
stage — and that is reported rather than worked around. A mark with no
table entry and no canvas gets a refusal, not a silent tone match, which is
the same bargain `tableAtlas()` makes about shapes.

Either way you are told what changed — `Typed # as +` — and only a mark
with nothing at all to stand in for it is left blank, by name. Switching a
key off under Characters counts as the machine not having it. Nothing
reaches the sheet that the machine cannot type; a test holds that promise.

## The three-dimensional face

The one face still drawn by hand, in two sizes, and the reason is a key
that is not there: the classic isometric FIGlet faces all need a backslash,
and a great many typewriters — the Olympia SM7 among them — have no
backslash, nor a pipe, nor a tilde.

So the drawn face uses *oblique* projection rather than isometric: a real
drafting projection in which every depth line runs at the same 45-degree
angle, so one `/` does the work of `/` and `\`. Draughtsmen used oblique
for the same reason — it is easier to draw. The letter itself is filled
with the heaviest character the machine has, picked by rank from its keys
rather than wished for; the depth is drawn in `/` and `_`, and the picker
warns if the machine has no stand-in for either.

## Fitting the paper

**How wide** is one control, and it governs a word exactly as it governs a
picture: a picture is scaled to reach it, a line of lettering breaks at
spaces to reach it. That is what makes a sentence unable to overrun the
sheet, however long it is — whatever the control is set to is inside the
paper, and the wrapping meets it.

One case is left over, and it cannot be wrapped away: a **single word wider
than the setting**. A break only ever happens at a space, because a
letterform split down the middle is unreadable, so `letter()` leaves such a
word whole and `setUp()` refuses the sheet with a reason. The browser says
so at the words box while you are typing into it — both numbers, the
offending word named — and offers the ways out as the buttons that take
them: the narrowest face that would hold it, and how many sheets across it
would need.

Measured, not guessed, because most of the obvious advice here is wrong.
Turning the sheet is the first thing anybody suggests and it makes the
problem worse: a turned A4 is 60 columns inside the margins where an
upright one is 66, since a turn buys millimetres and spends columns. It is
never offered, and neither is a face that does not in fact fit.

Pasted art is the one thing with no width to set. Its spacing is what makes
it the picture it is, so that tab states the numbers instead of offering a
control that would have to resample the art to mean anything.

## Sideways: the word becomes a picture

A typewriter cell is 2.54 mm wide and 4.23 mm tall. A quarter turn swaps
the two, so laying a finished block of letters down cell by cell stretches
it 2.77 times over — a word planned sideways used to come out as a long
smear of letterforms, which defeated the point of turning: the turned sheet
reads half again as wide (254 mm inside the margins against 168), and the
stretch ate all of it.

Fixed letterforms cannot be resampled the way a photograph can. So a word
planned sideways is *turned into a photograph of itself*: the finished
block becomes ink — in the browser each mark is drawn as the glyph it is,
so a hairline stays a hairline; on the command line and in the tests each
cell becomes a 3 × 5 patch of pixels, the cell's own shape — and the
ordinary picture pipeline takes it from there. Laid on its side, scaled
into the turned sheet, matched cell by cell against the machine's keys.

What that buys and what it costs, measured — `Type` in Caligraphy2 on an
SM7:

|  | typed | as read | keystrokes |
| --- | --- | --- | --- |
| upright | 49 × 19 | 125 × 80 mm | 264 |
| planned sideways | 65 × 60 | 254 × 165 mm | 1,118 |

Twice the size as read, in proportion, for four times the typing. The marks
on the sideways sheet are chosen by the shape matcher rather than by the
font — that is the price of the resample, and the hint says so where the
face is picked. There are no stand-ins on this path: every mark was picked
from the machine's keys to begin with.

On the command line the same rule as for pictures applies: shape matching
needs rendered glyphs, so without `--atlas` the marks are matched by tone,
and it is said.

## What it costs

`TYPE` on an SM7 upright: 327 keystrokes in the three-dimensional face;
`Type` in Caligraphy2 is 264. Fonts differ a lot — hollow and stroke-built
fonts cost a fraction of what solid ones do, which matters when you are the
printer.

## What happened to the drawn faces

Thirty-nine redrawn faces — calligraphic hands, hollows, slants, shadows,
graded ramps — were removed in favour of the real fonts they were informed
by. The machinery they proved stays and serves the fonts: the stand-in
engine, the tone ramp read off the machine's keys by rank, the wrapping
that breaks lines at spaces and refuses to hyphenate a letterform, and the
rule that every mark on the sheet is one the machine can strike.
