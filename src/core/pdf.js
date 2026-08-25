/**
 * pdf.js — a printable sheet, written by hand.
 *
 * No library. A PDF is a text file with an index at the end, and everything
 * we need is one built-in font and some line drawing. Pulling in 300 kB of
 * dependency to draw monospaced text would be silly.
 *
 * Three parts:
 *   1. the finished sheet, at true size
 *   2. how to set the machine up
 *   3. the typing sheet — ruled paper, one cell per keystroke
 *
 * Part 3 is the one that matters, and it is not a table of text. Copying a
 * picture character by character does not fail on the characters; it fails
 * on losing count inside a run of eighteen spaces, and from there every
 * remaining line is shifted. So the typing sheet is squared paper: every
 * keystroke has a cell, every cell has a place on a ruler, and the eye can
 * always find its way back.
 */

const PT_PER_MM = 72 / 25.4;

/* Ink for the typing sheet. Muted on purpose: the grid has to be readable
 * beside the characters without competing with them. */
const SHEET = {
  rule:     [0.79, 0.83, 0.89],   // writing line
  rule5:    [0.56, 0.64, 0.75],   // every fifth line, for counting down
  grid:     [0.89, 0.91, 0.94],   // verticals every 5 columns
  grid10:   [0.77, 0.81, 0.87],   // verticals every 10
  band:     [0.972, 0.978, 0.988], // every other row, to stop line-slipping
  runBox:   [0.874, 0.933, 0.878], // a repeated character
  runBoxRed:[0.980, 0.886, 0.878],
  spaceBox: [0.937, 0.949, 0.965], // a space you must actually type
  label:    [0.50, 0.54, 0.59],
  label5:   [0.27, 0.32, 0.38],
  ink:      [0.08, 0.08, 0.09],
  red:      [0.74, 0.15, 0.13],
};

/**
 * Turn text into a PDF literal string.
 *
 * Order matters: escape the structural characters FIRST, then emit the
 * octal codes for anything above ASCII. Doing it the other way round means
 * the backslash of an octal escape gets escaped again and the reader shows
 * a literal \344 instead of an a-umlaut.
 *
 * WinAnsi is what the built-in fonts use; characters outside it are folded
 * to something close rather than dropped.
 */
function toWinAnsi(s) {
  const fold = {
    '–': '-', '—': '-', '−': '-', '…': '...', '×': 'x',
    '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'", '‚': ',',
    ' ': ' ', '•': '.', '·': '.',
  };
  let out = '';
  for (const ch of String(s)) {
    const c = fold[ch] ?? ch;
    for (const one of c) {
      const code = one.codePointAt(0);
      if (one === '\\' || one === '(' || one === ')') out += '\\' + one;
      else if (code < 32) out += ' ';
      else if (code < 127) out += one;
      else if (code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
      else out += '?';
    }
  }
  return out;
}

class Page {
  constructor(wMm, hMm) {
    this.w = wMm * PT_PER_MM;
    this.h = hMm * PT_PER_MM;
    this.ops = [];
  }
  /**
   * y is measured from the top, like everything else people think in.
   * `colour` is [r,g,b] and wins over `grey` when both are given.
   */
  text(xMm, yMm, s, { size = 9, font = 'F2', grey = 0, colour = null,
                      align = 'left' } = {}) {
    const paint = colour ? `${colour.join(' ')} rg` : `${grey} g`;
    // Courier and Helvetica widths differ; only the monospaced ones need to
    // be centred exactly, and 0.6 em is Courier's advance.
    const w = font === 'F1' ? size * 0.5 : size * 0.6;
    const x = align === 'centre' ? xMm - (String(s).length * w) / 2 / PT_PER_MM
                                 : xMm;
    this.ops.push(
      `BT ${paint} /${font} ${size} Tf ` +
      `1 0 0 1 ${(x * PT_PER_MM).toFixed(2)} ` +
      `${(this.h - yMm * PT_PER_MM).toFixed(2)} Tm ` +
      `(${toWinAnsi(s)}) Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, { grey = 0.75, colour = null, width = 0.4 } = {}) {
    const paint = colour ? `${colour.join(' ')} RG` : `${grey} G`;
    this.ops.push(
      `${width} w ${paint} ` +
      `${(x1 * PT_PER_MM).toFixed(2)} ${(this.h - y1 * PT_PER_MM).toFixed(2)} m ` +
      `${(x2 * PT_PER_MM).toFixed(2)} ${(this.h - y2 * PT_PER_MM).toFixed(2)} l S`);
    return this;
  }
  rect(x, y, w, h, { grey = 0.9, colour = null, fill = true } = {}) {
    const paint = colour
      ? `${colour.join(' ')} ${fill ? 'rg' : 'RG'}`
      : `${grey} ${fill ? 'g' : 'G'}`;
    this.ops.push(
      `${paint} ` +
      `${(x * PT_PER_MM).toFixed(2)} ${(this.h - (y + h) * PT_PER_MM).toFixed(2)} ` +
      `${(w * PT_PER_MM).toFixed(2)} ${(h * PT_PER_MM).toFixed(2)} re ${fill ? 'f' : 'S'}`);
    return this;
  }
  get content() { return this.ops.join('\n'); }
}

/** Assemble the objects and the cross-reference table. */
function buildPdf(pages, title) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };

  const fontRegular = add('<< /Type /Font /Subtype /Type1 ' +
    '/BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontMono = add('<< /Type /Font /Subtype /Type1 ' +
    '/BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const fontMonoBold = add('<< /Type /Font /Subtype /Type1 ' +
    '/BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');

  const pagesId = objs.length + 1 + pages.length * 2;
  const kids = [];

  for (const p of pages) {
    const stream = p.content;
    const contentId = add(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R ` +
      `/MediaBox [0 0 ${p.w.toFixed(2)} ${p.h.toFixed(2)}] ` +
      `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontMono} 0 R ` +
      `/F3 ${fontMonoBold} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`);
    kids.push(`${pageId} 0 R`);
  }

  add(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);
  const infoId = add(`<< /Title (${toWinAnsi(title)}) ` +
    `/Producer (typewriter-ascii) >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let out = '%PDF-1.4\n';
  const offsets = [0];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R ` +
         `/Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}

/**
 * Build the whole document.
 *
 * @param {Object} a
 * @param {string[]} a.lines
 * @param {string[][]} a.colours
 * @param {Object} a.paper      from PAPERS
 * @param {Object} a.machine
 * @param {Object} a.setup      from setUp()
 * @param {[string,string][]} a.instructions
 * @param {Object} a.tally      from inkTally()
 * @param {'none'|'left'|'right'} [a.turn] which way the finished sheet is
 *   turned to be read. Page 1 is the sheet as it comes out of the machine
 *   either way — the motif is already lying down by the time it gets here —
 *   so all this does is say so on the page you read.
 * @param {(line:string, colours:string[]) => {ch:string,n:number,space:boolean,red:boolean}[]} a.runsOf
 * @param {Array<{name: string, lines: string[], colours: string[][],
 *   setup: Object, blank: boolean}>} [a.sheets] one entry per physical sheet
 *   of a composite. `paper` must then be the *single* sheet — that is the
 *   size this document is printed on, whatever size the finished picture is.
 *   Left out, the motif is treated as one sheet, which is what it is.
 */
export function buildSheetPdf({
  lines, colours, paper, machine, setup, instructions, tally, runsOf,
  turn = 'none', sheets = null, title = 'Typewriter ASCII',
}) {
  const turned = turn === 'left' || turn === 'right';
  const pages = [];
  const cw = 25.4 / machine.cpi;
  const ch = 25.4 / machine.lpi;

  /*
   * One sheet or many, the work below is the same work.
   *
   * A composite is not a different kind of document — it is this document,
   * once per piece of paper, because every piece of paper is a separate
   * visit to the machine with its own stops and its own line numbering. So
   * the single-sheet case is simply a list of one, and there is no second
   * code path to keep in step with the first.
   */
  const parts = (sheets ?? [{ name: paper.name, lines, colours, setup }])
    .filter((sh) => !sh.blank && sh.lines?.length && sh.setup);

  for (const part of parts) {
    pages.push(truePage(part, { paper, machine, cw, ch, runsOf,
      label: sheets ? part.name : null }));
  }

  /* ── the setting-up page ──────────────────────────────────── */

  const p2 = new Page(paper.w, paper.h);
  let y = 20;
  p2.text(20, y, title, { size: 13, font: 'F1' });
  y += 7;
  p2.text(20, y, `${machine.name}  ${machine.cpi} cpi  ${paper.name}` +
    (turned ? `  turned ${turn}` : ''),
    { size: 8, font: 'F1', grey: 0.45 });
  y += 4;
  p2.line(20, y, paper.w - 20, y);
  y += 9;

  const width = Math.max(0, ...lines.map((l) => l.length));
  p2.text(20, y, `${width} x ${lines.length} characters, ` +
    `${tally.total} keystrokes` + (tally.red ? `, ${tally.red} in red` : ''),
    { size: 9, font: 'F1' });
  y += 10;

  // Said once, plainly, on the page somebody has beside the machine. Page 1
  // is the sheet lying down, which looks like a mistake until you know it
  // is not one.
  if (turned) {
    p2.text(20, y, `Planned sideways: the sheet goes in upright and the ` +
      `motif is typed lying down. Turn it ${turn} when it is finished. ` +
      `Page 1 shows it as the machine leaves it.`,
      { size: 8.5, font: 'F1', grey: 0.35 });
    y += 9;
  }

  instructions.forEach(([head, body], i) => {
    p2.text(20, y, `${i + 1}.`, { size: 9, font: 'F3' });
    p2.text(26, y, head, { size: 9, font: 'F3' });
    y += 5;
    for (const row of wrap(body, 74)) {
      p2.text(26, y, row, { size: 8, font: 'F1', grey: 0.35 });
      y += 4.2;
    }
    y += 3;
  });

  for (const w of setup.warnings ?? []) {
    // Accepts both the old plain string and the { level, text } form.
    const text = typeof w === 'string' ? w : w.text;
    const stop = typeof w !== 'string' && w.level === 'stop';
    y += 2;
    p2.line(20, y - 3, 20, y + wrap(text, 74).length * 4.2,
      { grey: stop ? 0.1 : 0.55, width: stop ? 1.6 : 1 });
    for (const row of wrap(text, 74)) {
      p2.text(23, y, row, { size: 8, font: stop ? 'F3' : 'F1' });
      y += 4.2;
    }
    y += 3;
  }
  pages.push(p2);

  /* ── the typing sheets, one run of them per piece of paper ── */
  for (const part of parts) {
    for (const page of typingSheets({
      lines: part.lines, colours: part.colours, paper, setup: part.setup,
      runsOf, label: parts.length > 1 ? part.name : null,
    })) {
      pages.push(page);
    }
  }

  return buildPdf(pages, title);
}

/**
 * One physical sheet at true size, exactly where the ink will land.
 *
 * `left - paperGuide` rather than `left`, and that is the whole reason this
 * arithmetic is not just `left`: the paper guide slides the sheet along the
 * scale, so the margin stop's number is a position on the carriage and the
 * difference between the two is the position on the paper. Getting that
 * wrong on a composite would shift one sheet's piece of the picture against
 * its neighbours, which is the one error a join shows up immediately.
 */
function truePage(part, { paper, machine, cw, ch, runsOf, label }) {
  const page = new Page(paper.w, paper.h);
  const { setup, lines, colours } = part;
  const x0 = (setup.left - (setup.paperGuide ?? 0)) * cw;
  const y0 = (setup.advance ?? 0) * ch;

  if (label) {
    page.text(8, 6, label, { size: 7, font: 'F1', grey: 0.55 });
  }

  lines.forEach((line, r) => {
    const y = y0 + (r + 1) * ch;
    if (y > paper.h - 4) return;
    // Draw run by run, so red really is red.
    let col = 0;
    for (const run of runsOf(line, colours?.[r])) {
      if (!run.space) {
        const x = x0 + col * cw;
        // Courier at this size is 0.6 em wide; solve for the cell width.
        page.ops.push(
          `BT ${run.red ? '0.66 0.20 0.16 rg' : '0 g'} /F2 ` +
          `${(cw / 0.6 * PT_PER_MM).toFixed(2)} Tf ` +
          `1 0 0 1 ${(x * PT_PER_MM).toFixed(2)} ` +
          `${(page.h - y * PT_PER_MM).toFixed(2)} Tm ` +
          `(${toWinAnsi(run.ch.repeat(run.n))}) Tj ET`);
      }
      col += run.n;
    }
  });
  return page;
}

/**
 * The typing sheet: ruled paper with one cell per keystroke.
 *
 * This replaced a list of run-length text like `4_ 2H 3_ 2H`, which was
 * compact, correct, and unusable — you cannot hold “four spaces, two H,
 * three spaces” in your head while looking at a typewriter, and the notation
 * gives the eye nothing to come back to after a glance away.
 *
 * What the squared version gives you instead:
 *
 *   • every keystroke, including every space, occupies one cell, so the
 *     position on the page and the position in the line are the same thing
 *   • a column ruler top and bottom, and verticals every five columns, so a
 *     lost place is found again in one glance rather than by recounting
 *   • line numbers on both sides, because the right-hand one is what you can
 *     actually see with a carriage in the way
 *   • runs of three or more get a tinted box with the count above it — the
 *     count is a help, not the instruction
 *   • every space gets a box too. A single space between characters used to
 *     be left blank, which reads as “nothing here”, and that is precisely the
 *     misreading that loses the line.
 */
function typingSheets({ lines, colours, paper, setup, runsOf, label = null }) {
  const cols = Math.max(1, ...lines.map((l) => l.length));

  const margin = paper.w > 150 ? 12 : 8;   // postcards need the room
  const gutter = paper.w > 150 ? 9 : 7;    // line numbers, both sides
  const usable = paper.w - 2 * margin - 2 * gutter;

  // Cell width follows the motif, capped so a narrow one does not turn into
  // giant letters.
  const cellW = Math.min(usable / cols, 4.4);
  const rowH = cellW * 2.5;
  const charSize = (cellW / 0.6) * PT_PER_MM;   // Courier advance is 0.6 em
  const labelSize = Math.max(4.6, charSize * 0.42);

  const x0 = margin + gutter + (usable - cols * cellW) / 2;
  const xe = x0 + cols * cellW;

  const headroom = 26;          // title, ruler
  const footroom = 12;          // bottom ruler
  const perPage = Math.max(1,
    Math.floor((paper.h - headroom - footroom) / rowH));

  const out = [];

  for (let first = 0; first < lines.length; first += perPage) {
    const slice = lines.slice(first, first + perPage);
    const p = new Page(paper.w, paper.h);
    const y0 = headroom;
    const ye = y0 + slice.length * rowH;

    // Named on every page of a composite. Four sheets produce four runs of
    // ruled paper that look identical, and "lines 1-38 of 60" is the same
    // heading on all of them — the sheet's name is the only thing that says
    // which pile of paper this page belongs to.
    p.text(margin, 12, label ? `What to type — ${label}` : 'What to type',
      { size: 10, font: 'F1' });
    p.text(paper.w - margin, 12,
      `lines ${first + 1}-${first + slice.length} of ${lines.length}`,
      { size: 7, font: 'F1', grey: 0.5, align: 'centre' });
    p.text(margin, 17,
      'One box is one keystroke. Shaded boxes are spaces - type them too. ' +
      'A number above a box is how many.',
      { size: 6.4, font: 'F1', grey: 0.45 });

    // Alternating row bands. Nothing to do with decoration: they stop the
    // eye sliding onto the neighbouring line on a wide motif.
    slice.forEach((_, i) => {
      if (i % 2 === 1) {
        p.rect(x0, y0 + i * rowH, cols * cellW, rowH, { colour: SHEET.band });
      }
    });

    // Verticals every five columns, stronger every ten.
    for (let c = 0; c <= cols; c += 5) {
      const x = x0 + c * cellW;
      p.line(x, y0 - 1.6, x, ye + 1.4,
        { colour: c % 10 === 0 ? SHEET.grid10 : SHEET.grid, width: 0.3 });
    }

    // Column ruler, top and bottom. Numbered from the motif, not from the
    // carriage scale: the margin stop already did the centring, so column 1
    // is wherever the carriage returns to.
    for (let c = 5; c <= cols; c += 5) {
      const x = x0 + c * cellW;
      const style = {
        size: labelSize, font: 'F1', align: 'centre',
        colour: c % 10 === 0 ? SHEET.label5 : SHEET.label,
      };
      p.text(x, y0 - 2.6, String(c), style);
      p.text(x, ye + 4.4, String(c), style);
    }

    slice.forEach((line, i) => {
      const r = first + i;
      const rowTop = y0 + i * rowH;
      const baseline = rowTop + rowH * 0.80;
      const boxTop = rowTop + rowH * 0.30;
      const boxH = baseline - boxTop + 0.5;
      const strong = (r + 1) % 5 === 0;

      // The writing line. Every fifth is heavier so you can count down to a
      // line without following each one.
      p.line(x0, baseline + 0.9, xe, baseline + 0.9, {
        colour: strong ? SHEET.rule5 : SHEET.rule,
        width: strong ? 0.7 : 0.35,
      });

      // Line numbers both sides. The number shown is the line of the motif;
      // the paper is already wound on by setUp().
      const nStyle = {
        size: labelSize, font: 'F1',
        colour: strong ? SHEET.label5 : SHEET.label,
      };
      p.text(margin, baseline, String(r + 1).padStart(3), nStyle);
      p.text(xe + 2.2, baseline, String(r + 1), nStyle);

      let col = 0;
      for (const run of runsOf(line, colours?.[r])) {
        const x = x0 + col * cellW;
        const w = run.n * cellW;

        // A space is always boxed; a character only when it repeats enough
        // to be worth counting. Two different questions, two thresholds —
        // one shared threshold was wrong for one of them.
        if (run.space) {
          p.rect(x + 0.15, boxTop, w - 0.3, boxH, { colour: SHEET.spaceBox });
        } else if (run.n >= 3) {
          p.rect(x + 0.15, boxTop, w - 0.3, boxH,
            { colour: run.red ? SHEET.runBoxRed : SHEET.runBox });
        }

        if (run.n >= 3 || (run.space && run.n >= 2)) {
          p.text(x + w / 2, boxTop - 0.7, String(run.n), {
            size: labelSize, font: 'F1', align: 'centre',
            colour: run.red ? SHEET.red : SHEET.label5,
          });
        }

        if (!run.space) {
          p.ops.push(
            `BT ${(run.red ? SHEET.red : SHEET.ink).join(' ')} rg /F2 ` +
            `${charSize.toFixed(2)} Tf ` +
            `1 0 0 1 ${(x * PT_PER_MM).toFixed(2)} ` +
            `${(p.h - baseline * PT_PER_MM).toFixed(2)} Tm ` +
            `(${toWinAnsi(run.ch.repeat(run.n))}) Tj ET`);
        }

        col += run.n;
      }
    });

    out.push(p);
  }

  return out;
}

/** Wrap on spaces, never mid-token. */
function wrap(s, n) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > n) { out.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** Hand the finished file to the browser. */
export function downloadPdf(text, name = 'typewriter.pdf') {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
