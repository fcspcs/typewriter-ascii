/**
 * keyboard.js — pick the characters your machine can type.
 *
 * Three ways in, because people arrive from different directions:
 *   1. click keys on a picture of your keyboard   (you can see your layout)
 *   2. type them into a field                     (fast, and pasteable)
 *   3. let it learn from you typing               (no layout knowledge needed)
 *
 * The third one is the honest answer for anyone with an unusual machine:
 * sit at the keyboard, press every key your typewriter has, done.
 */

import { charset } from '../core/machine.js';

/**
 * Draw the keyboard.
 * @param {HTMLElement} host
 * @param {import('../core/machine.js').Machine} m
 * @param {Set<string>} chosen   mutated as the user clicks
 * @param {() => void} onChange
 */
export function renderKeyboard(host, m, chosen, onChange) {
  const rows = [];

  // Unshifted and shifted rows are drawn as pairs, so a key shows both of
  // the characters it can strike — that is how the machine actually works.
  (m.rows ?? []).forEach((row, i) => {
    const shift = m.shiftRows?.[i] ?? '';
    rows.push({ indent: i, keys: [...row].map((ch, j) => [ch, shift[j]]) });
  });

  const extra = [...(m.extra ?? '')];
  if (extra.length) rows.push({ indent: 0, keys: extra.map((ch) => [ch, undefined]) });

  host.innerHTML = rows.map((r) => {
    const keys = r.keys.map(([lo, hi]) => {
      const cells = [lo, hi].filter((c) => c && c !== ' ');
      return cells.map((c) =>
        `<button type="button" class="key" data-ch="${esc(c)}">${esc(c)}</button>`
      ).join('');
    }).join('');
    return `<div class="krow${r.indent ? ' ind' : ''}">${keys}</div>`;
  }).join('');

  const paint = () => {
    host.querySelectorAll('.key').forEach((b) => {
      b.classList.toggle('on', chosen.has(b.dataset.ch));
    });
  };

  host.onclick = (e) => {
    const b = e.target.closest('.key');
    if (!b) return;
    const ch = b.dataset.ch;
    if (chosen.has(ch)) chosen.delete(ch); else chosen.add(ch);
    paint();
    onChange();
  };

  paint();
  return paint;
}

const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Preset selections. */
export function pick(which, m, chosen) {
  const all = charset(m);
  chosen.clear();
  if (which === 'none') return;
  if (which === 'all') { all.forEach((c) => chosen.add(c)); return; }
  if (which === 'letters') {
    all.filter((c) => /\p{L}|\d/u.test(c)).forEach((c) => chosen.add(c));
    return;
  }
  if (which === 'marks') {
    // Punctuation and symbols only. Surprisingly good for line work: the
    // shapes are simple and the tones are light.
    all.filter((c) => !/\p{L}|\d/u.test(c)).forEach((c) => chosen.add(c));
  }
}

/**
 * Learn a character set from someone typing it.
 *
 * Returns a handle with `stop()`. Every printable key pressed while active
 * is added. This sidesteps every question about layouts and dead keys,
 * because the browser reports what the key actually produced.
 */
export function learnByTyping(chosen, onChange, onCount) {
  const seen = new Set();

  const onKey = (e) => {
    // Ignore modifiers and anything that is not a single printable character.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const ch = e.key;
    if (ch.length !== 1) return;
    e.preventDefault();
    if (ch !== ' ') {
      chosen.add(ch);
      seen.add(ch);
    }
    onCount?.(seen.size);
    onChange?.();
  };

  window.addEventListener('keydown', onKey, true);
  return {
    stop() { window.removeEventListener('keydown', onKey, true); return seen; },
    seen,
  };
}
