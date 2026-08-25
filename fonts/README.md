# The fonts, and whose they are

FIGlet font files (`.flf`). The command line sets type with them, pixel for
pixel as the TAAG site shows them:

    node tools/cli.mjs text "HELLO" --flf fonts/Roman.flf

Any `.flf` file you add to this folder works the same way. Characters your
machine has not got are typed as their stand-ins (`^` as `´` on the Olympia
SM7, and you are told); only a character with no stand-in at all is left
blank, named in a note.

## Provenance

These files are redistributed **as received** from the FIGlet font
collection — the same files that ship with
[figlet.js](https://github.com/patorjk/figlet.js) (the engine behind
[patorjk.com/software/taag](https://patorjk.com/software/taag)), with figlet
itself, and with every Linux distribution's figlet package, as they have
been since the 1990s. Their authors submitted them to the collection to be
distributed with FIGlet, and each file's header comment is preserved intact.

They are the work of their authors and remain so. **They are not covered by
this repository's MIT licence.** If you are an author and want a font
removed from here, open an issue and it will be.

## The authors

| File | Face | Author |
| ---- | ---- | ------ |
| `Caligraphy2.flf` | Calligraphy | Vinney Thai, 1994; modified by Paul Burton, 1996 |
| `Catwalk.flf` | Catwalk | Ron Fritz, 1994 |
| `Filter.flf` | Filter | Aaron Nolan, 2005 |
| `Fraktur.flf` | Fraktur | Philip Menke, 1995 |
| `Georgia11.flf` | Georgia 11 | Richard Sabey, 2003 |
| `Gradient.flf` | Gradient | Philip Menke, after a concept by Bob Allison, 1995 |
| `Henry 3D.flf` | Henry 3D | Henry Segerman; FIGlet conversion Markus Gebhard, 2001 |
| `Italic.flf` | Italic | Bas Meijer; fixes by Ryan Youck |
| `Kban.flf` | Kban | Randy Jae Weinstein, 1994 |
| `Konto.flf` | Konto | Markus Gebhard, 2001 |
| `Lean.flf` | Lean | Glenn Chappell, 1993 |
| `NV Script.flf` | NV Script | Normand Veilleux; compiled by Jerrad Pierce |
| `O8.flf` | O8 | Gordon Lee; figletization Tony Nugent |
| `OS2.flf` | OS2 | Kent Nassen, 1995 |
| `Peaks.flf` | Peaks | Ron Fritz, 1994 |
| `Poison.flf` | Poison | Vinney Thai and David Issel |
| `Roman.flf` | Roman | Nick Miners, 1994 |
| `Rowan Cap.flf` | Rowan Cap | Kent Nassen, 1995 |
| `S Blood.flf` | S Blood | Kent Nassen, after a rec.arts.ascii design |

And behind all of them: the FIGlet project (figlet.org), Glenn Chappell and
Ian Chai's program, and the contributors who kept the collection alive for
three decades.

## More fonts

- <https://github.com/patorjk/figlet.js/tree/main/fonts> — several hundred
- <http://www.figlet.org/fontdb.cgi> — the original font database
