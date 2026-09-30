// supabase/functions/process-bill-upload/_shared/fontMetrics.ts
//
// Glyph advance widths (1/1000 em) for the two Base-14 fonts the PDF writer
// uses: Helvetica and Helvetica-Bold.
//
// WHY THIS IS HERE
// The writer needs real widths to right-align a currency column, to centre a
// heading, and to wrap a long description onto a second line. Without them every
// column would be laid out with a guess and the sheet would visibly not line up.
//
// The two fonts are the PDF standard 14, so they need no embedding: every PDF
// viewer already has them. Widths are listed for codes 32..126; anything else
// falls back to 556, which is the width of a lowercase 'n' in both faces and is
// close enough for the rare non-ASCII glyph.

export type FontName = "regular" | "bold";

// prettier-ignore
const HELVETICA: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556,
  64: 1015,
  65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722,
  73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667,
  81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667,
  89: 667, 90: 611,
  91: 278, 92: 278, 93: 278, 94: 469, 95: 556, 96: 333,
  97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556,
  118: 500, 119: 722, 120: 500, 121: 500, 122: 500,
  123: 334, 124: 260, 125: 334, 126: 584,
};

// prettier-ignore
const HELVETICA_BOLD: Record<number, number> = {
  32: 278, 33: 333, 34: 474, 35: 556, 36: 556, 37: 889, 38: 722, 39: 238,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556, 58: 333, 59: 333, 60: 584, 61: 584, 62: 584, 63: 611,
  64: 975,
  65: 722, 66: 722, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722,
  73: 278, 74: 556, 75: 722, 76: 611, 77: 833, 78: 722, 79: 778, 80: 667,
  81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667,
  89: 667, 90: 611,
  91: 333, 92: 278, 93: 333, 94: 584, 95: 556, 96: 333,
  97: 556, 98: 611, 99: 556, 100: 611, 101: 556, 102: 333, 103: 611,
  104: 611, 105: 278, 106: 278, 107: 556, 108: 278, 109: 889, 110: 611,
  111: 611, 112: 611, 113: 611, 114: 389, 115: 556, 116: 333, 117: 611,
  118: 556, 119: 778, 120: 556, 121: 556, 122: 500,
  123: 389, 124: 280, 125: 389, 126: 584,
};

const DEFAULT_WIDTH = 556;

/** Advance width of one character, in 1/1000 em. */
export function glyphWidth(font: FontName, code: number): number {
  const table = font === "bold" ? HELVETICA_BOLD : HELVETICA;
  return table[code] ?? DEFAULT_WIDTH;
}

/** Rendered width of `text` at `size` points. */
export function measureText(text: string, font: FontName, size: number): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    total += glyphWidth(font, text.charCodeAt(i));
  }
  return (total * size) / 1000;
}
