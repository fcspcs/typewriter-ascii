/**
 * pdf.js — a printable sheet, written by hand.
 *
 * No library. A PDF is a text file with an index at the end, and everything
 * we need is one built-in font and some line drawing. Pulling in 300 kB of
 * dependency to draw monospaced text would be silly.
 *
 * Two pages:
 *   1. the finished sheet, at true size, plus how to set the machine up
 *   2. the line-by-line instructions
 */

const PT_PER_MM = 72 / 25.4;

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
  /** y is measured from the top, like everything else people think in. */
  text(xMm, yMm, s, { size = 9, font = 'F2', grey = 0 } = {}) {
    this.ops.push(
      `BT ${grey} g /${font} ${size} Tf ` +
      `1 0 0 1 ${(xMm * PT_PER_MM).toFixed(2)} ` +
      `${(this.h - yMm * PT_PER_MM).toFixed(2)} Tm ` +
      `(${toWinAnsi(s)}) Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, { grey = 0.75, width = 0.4 } = {}) {
    this.ops.push(
      `${width} w ${grey} G ` +
      `${(x1 * PT_PER_MM).toFixed(2)} ${(this.h - y1 * PT_PER_MM).toFixed(2)} m ` +
      `${(x2 * PT_PER_MM).toFixed(2)} ${(this.h - y2 * PT_PER_MM).toFixed(2)} l S`);
    return this;
  }
  rect(x, y, w, h, { grey = 0.9, fill = true } = {}) {
    this.ops.push(
      `${grey} ${fill ? 'g' : 'G'} ` +
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
 * @param {(line:string, colours:string[]) => {ch:string,n:number,space:boolean,red:boolean}[]} a.runsOf
 */
export function buildSheetPdf({
  lines, colours, paper, machine, setup, instructions, tally, runsOf,
  title = 'Typewriter ASCII',
}) {
  const pages = [];

  /* ── page 1: the sheet at true size ───────────────────────── */
  const p1 = new Page(paper.w, paper.h);
  const cw = 25.4 / machine.cpi;
  const ch = 25.4 / machine.lpi;

  // Where the motif actually lands on the sheet.
  const x0 = (setup.left - (setup.paperGuide ?? 0)) * cw;
  const y0 = (setup.advance ?? 0) * ch;

  lines.forEach((line, r) => {
    const y = y0 + (r + 1) * ch;
    if (y > paper.h - 4) return;
    // Draw run by run, so red really is red.
    let col = 0;
    for (const run of runsOf(line, colours?.[r])) {
      if (!run.space) {
        const x = x0 + col * cw;
        // Courier at this size is 0.6 em wide; solve for the cell width.
        p1.ops.push(
          `BT ${run.red ? '0.66 0.20 0.16 rg' : '0 g'} /F2 ` +
          `${(cw / 0.6 * PT_PER_MM).toFixed(2)} Tf ` +
          `1 0 0 1 ${(x * PT_PER_MM).toFixed(2)} ` +
          `${(p1.h - y * PT_PER_MM).toFixed(2)} Tm ` +
          `(${toWinAnsi(run.ch.repeat(run.n))}) Tj ET`);
      }
      col += run.n;
    }
  });
  pages.push(p1);

  /* ── page 2: setting up ───────────────────────────────────── */
  const p2 = new Page(paper.w, paper.h);
  let y = 20;
  p2.text(20, y, title, { size: 13, font: 'F1' });
  y += 7;
  p2.text(20, y, `${machine.name}  ${machine.cpi} cpi  ${paper.name}`,
    { size: 8, font: 'F1', grey: 0.45 });
  y += 4;
  p2.line(20, y, paper.w - 20, y);
  y += 9;

  const width = Math.max(0, ...lines.map((l) => l.length));
  p2.text(20, y, `${width} x ${lines.length} characters, ` +
    `${tally.total} keystrokes` + (tally.red ? `, ${tally.red} in red` : ''),
    { size: 9, font: 'F1' });
  y += 10;

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
    y += 2;
    p2.line(20, y - 3, 20, y + wrap(w, 74).length * 4.2, { grey: 0.5, width: 1 });
    for (const row of wrap(w, 74)) {
      p2.text(23, y, row, { size: 8, font: 'F1' });
      y += 4.2;
    }
    y += 3;
  }
  pages.push(p2);

  /* ── page 3+: what to type, line by line ──────────────────── */
  let p = new Page(paper.w, paper.h);
  y = 18;
  p.text(20, y, 'What to type', { size: 11, font: 'F1' });
  y += 4;
  p.line(20, y, paper.w - 20, y);
  y += 7;
  p.text(20, y, 'A number before a mark means repeat it. ' +
    '_ is a space - type it.', { size: 7.5, font: 'F1', grey: 0.45 });
  y += 8;

  lines.forEach((line, r) => {
    const runs = runsOf(line, colours?.[r]);
    const text = runs.length
      ? runs.map((run) => {
          const sym = run.space ? '_' : run.ch;
          return run.n > 1 ? `${run.n}${sym}` : sym;
        }).join('  ')
      : '-';

    for (const [k, row] of wrap(text, 62).entries()) {
      if (y > paper.h - 18) {
        pages.push(p);
        p = new Page(paper.w, paper.h);
        y = 18;
      }
      if (k === 0) {
        p.text(20, y, String(r + 1 + (setup.advance ?? 0)).padStart(3),
          { size: 8, font: 'F2', grey: 0.5 });
      }
      p.text(32, y, row, { size: 8.5, font: 'F2' });
      y += 5;
    }
    y += 0.6;
  });
  pages.push(p);

  return buildPdf(pages, title);
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
