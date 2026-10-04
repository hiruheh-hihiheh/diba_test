// The tokenizer is the one piece of the pdf reader that has to be exactly right about
// where an operand ends: miss it and every operator after the first string on a page
// disappears, which reports as a page with rules and no words rather than as an error.
// Verification only, and deliberately a SELF-contained sample rather than a rendered
// invoice, so a failure here cannot be blamed on the renderer.
import { tokens } from "./pdf-geometry.ts";

let failed = 0;
const eq = (got: unknown, want: unknown, what: string): void => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok ? "" : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const sample = `0 0 0 rg
BT
/F2 11 Tf
1 0 0 1 511.501 803.89 Tm
(ORIGINAL) Tj
ET
BT
/F1 8.6 Tf
[(A) -120 (B)] TJ
ET`;

const got = [...tokens(sample)];

/* The regression this exists for: a `(...)` group used to swallow everything after it,
   so `Tj` was never seen as an operator and the page measured with no text at all. */
eq(
  got.filter((t) => ["Tj", "TJ", "Tf", "Tm", "ET"].includes(t)),
  ["Tf", "Tm", "Tj", "ET", "Tf", "TJ", "ET"],
  "every operator after a string is still its own token"
);
eq(got.includes("(ORIGINAL)"), true, "a plain string stays whole");
eq(got.includes("[(A) -120 (B)]"), true, "an array stays whole, including the strings inside it");
eq(got.includes("-120"), false, "the array's kerning numbers do not leak out of it");
eq(got.length, 25, "the sample yields exactly 25 tokens");

/* Parentheses inside the text itself, which the bills genuinely contain. */
eq([...tokens("(ACCOUNT NO: 12345) Tj")], ["(ACCOUNT NO: 12345)", "Tj"], "a string holding a colon is one token");
eq([...tokens("(A (B) C) Tj")], ["(A (B) C)", "Tj"], "nested parentheses stay inside the string");
eq([...tokens("(a\\)b) Tj")], ["(a\\)b)", "Tj"], "an escaped paren does not close the string");

console.log(failed === 0 ? "\ntokenizer: all passed." : `\ntokenizer: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);