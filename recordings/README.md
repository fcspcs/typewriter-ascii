# Recordings

Labelled audio of the actual machine — the dataset every number in
`src/core/listen.js` has been waiting for. The full reasoning behind the
session plan is `docs/listening-research.md` §6.3; this file is the short
version you can follow with the phone already propped up.

## How to record

- **WAV if the recorder offers it**, otherwise the highest quality it has.
  A phone's voice-memo m4a works after one conversion:
  `ffmpeg -i take.m4a take.wav`
- Phone or laptop **~30 cm from the machine**, in the room you actually
  type in. Do not touch the recording level between takes.
- **Say the label out loud at the start of each take** — "twenty, same
  key" — that spoken count *is* the ground truth, and it costs nothing.
- One file per take. Count what you type; the count is the label.

## The takes, in order of value

1. **Room tone, 20 s.** Nothing at all.
2. **Twenty single strikes, slow** (~1 s apart), same key. The most
   valuable take of the set: it isolates the strike/rebound structure.
3. **Twenty strikes, varied** — light and heavy, keys from the edges of
   the keyboard too.
4. **Twenty space bar presses, slow.** Then twenty alternating
   space/letter. Settles whether spaces sound different.
5. **Five carriage returns**, a couple of seconds of silence around each.
6. **A full line of exactly 40 characters**, typed normally, then the
   return. The end-to-end case.
7. **Type until the bell rings**, twice.
8. **One line as fast as you can.** Measures the true minimum interval
   between strikes on this machine.
9. **Take 6 again from 2–3 m away**, and once with background noise
   (radio, window open).
10. **Backspace ×5, shift ×5** — the remaining mechanism sounds.

## Labelling

`labels.json` in this folder, one entry per file. `strikes` is the number
of keystrokes actually typed — **spaces and backspaces are keystrokes**;
carriage returns are not, they go in `returns`:

```json
{
  "02-twenty-M.wav":   { "strikes": 20, "returns": 0, "notes": "same key, ~1/s" },
  "06-full-line.wav":  { "strikes": 40, "returns": 1 }
}
```

## Using them

```sh
node tools/listen-lab.mjs eval  recordings           # score everything
node tools/listen-lab.mjs count recordings/02-twenty-M.wav --expect 20 --events
node tools/listen-lab.mjs fit   recordings           # fit the parameters
```

Audio files are not committed — `.gitignore` covers them, and this folder
stays as README + labels. A take worth keeping forever as a test fixture
can be added deliberately with `git add -f`.
