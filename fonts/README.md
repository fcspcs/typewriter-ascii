# Fonts live here — yours, not ours

Put FIGlet font files (`.flf`) in this folder and the command line can set
type with them, pixel for pixel:

    node tools/cli.mjs text "HELLO" --flf fonts/Roman.flf

The app can read them too, through its import button on the lettering tab.

## Why the folder ships empty

The FIGlet collection's licences are a patchwork: a few fonts state terms,
most state none at all. A font with no licence is not ours to redistribute,
and bundling it would push that problem onto everyone who forks this
repository. So `.gitignore` keeps `*.flf` out of version control the same
way it keeps the audio recordings out — the program ships the ability to
read a font, never the font.

## Where to get them

- <https://github.com/patorjk/figlet.js/tree/main/fonts> — the collection
  behind the TAAG site (patorjk.com/software/taag), several hundred files
- <http://www.figlet.org/fontdb.cgi> — the original FIGlet font database

Download the `.flf` files you want into this folder. What you may do with
each one is between you and its header comment.

## What happens to characters your machine has not got

Nothing is refused outright: the rendered art goes through the same
stand-in engine as everything else. A character the machine lacks is typed
as its stand-in (`^` as `´` on the Olympia SM7, and you are told), and a
character with no stand-in at all is left blank, named in a note.
