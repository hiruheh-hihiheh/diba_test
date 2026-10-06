// Metalworker_admin/scripts/sync-bill-creator-mirrors.js
//
//   node scripts/sync-bill-creator-mirrors.js          write the copies
//   node scripts/sync-bill-creator-mirrors.js --check  report drift, write nothing
//
// WHY A SCRIPT RATHER THAN A RULE IN THE CONTRIBUTOR'S HEAD
//
// The Bill Creator's browser-side logic exists in four files — two modules, one per app
// — because the Electron/Vite desktop app and the Expo admin app cannot import from each
// other through their bundlers, and neither can import from a Deno edge function
// directory. That is a real constraint, and a shared package across two applications is
// not a trade worth making for this.
// What is not acceptable is the part where a real constraint becomes a real bug: two
// copies of a function that maps a form onto a financial document, with nothing forcing
// them to agree. A field added to one and forgotten in the other is a field an admin can
// type on one platform and not the other, and nothing anywhere reports it.
//
// So the copies are generated, not maintained. Each has exactly ONE line that may differ
// from its source — the path comment on line 1, plus, for the network layer, the
// `supabase` import. `test-bill-creator.ts` fails if that stops being true, and this
// script is the only supported way to make the copies.
//
// The alternative — a test that reports drift and leaves the fixing to a human — was
// rejected because "run the sync script" is one command, and "read the diff and decide
// which copy is right" is a judgement call on every single change.
//
// WHAT IT DELIBERATELY REFUSES TO DO
//
// It does not merge, and it does not guess. If a line other than the allowed ones differs,
// that is either a stale copy (run without --check) or two people editing both at once
// (a conversation, not a merge). The script never picks a winner, because picking one
// silently is how a bank's tax treatment ends up defined by whichever file was written
// last.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ADMIN = resolve(REPO, "Metalworker_admin");
const DESKTOP = resolve(REPO, "Metalworker_desktop");

const checkOnly = process.argv.includes("--check");

/**
 * One mirrored file: where the source lives, where the copy lives, and the lines that
 * are ALLOWED to differ. Anything else differing is drift.
 *
 * Named as data rather than written as code because the list is the thing most likely to
 * need a third entry — a third platform, or a module the Expo app can share natively
 * because it is not browser-specific — and adding it should be one line here rather than
 * another block of file-reading code.
 */
const MIRRORS = [
  {
    name: "the Bill Creator's pure form module",
    from: resolve(ADMIN, "src/services/creatorForm.ts"),
    to: resolve(DESKTOP, "src/services/creatorForm.ts"),
    /**
     * Line 1 is the file's own path, and the two genuinely are different files. It is the
     * only concession: a reader who opens either copy can see which app it belongs to.
     */
    fixLine: (index) =>
      index === 1 ? "// Metalworker_desktop/src/services/creatorForm.ts" : undefined,
  },
  {
    name: "the Bill Creator's network layer",
    from: resolve(ADMIN, "src/services/billCreator.ts"),
    to: resolve(DESKTOP, "src/services/billCreator.ts"),
    /**
     * Line 1, and the `supabase` import. That import is the one difference which is not
     * cosmetic: the desktop app's client lives at `src/lib/supabase` and the Expo app's
     * at `src/services/supabase`, and no relative specifier is correct in both.
     *
     * An exact line match rather than a search-and-replace, on purpose. A rewrite rule
     * would have to guess which side is which, and a script that guesses is a script that
     * will eventually be wrong. Matching the whole line means the script fails loudly the
     * day the import is reformatted, instead of quietly stopping to rewrite it.
     */
    fixLine: (index, line) => {
      if (index === 1) return "// Metalworker_desktop/src/services/billCreator.ts";
      if (line === 'import { supabase } from "./supabase";') {
        return 'import { supabase } from "../lib/supabase";';
      }
      return undefined;
    },
  },
  {
    /* Section I of the creator is "link jobs to this bill", and that relationship is not
       optional to the feature: a bill with no job link is a valid bill, but an admin who
       created one on their phone and then opened the app expecting to see it among their
       jobs would find nothing, and would have no way to link it from there. So the data
       access is mirrored too rather than the section being quietly dropped on mobile. */
    name: "the Bill ↔ Job connection layer",
    from: resolve(ADMIN, "src/services/billJobConnections.ts"),
    to: resolve(DESKTOP, "src/services/billJobConnections.ts"),
    /* Only the `supabase` import, for the reason given above. Line 1 is NOT rewritten
       here, unlike the two Bill Creator modules: these two files predate the script and
       carry the repo's own `// src/...` header, which happens to be identical in both
       apps because both are at `src/`. Inventing a second header convention for two files
       to satisfy a script would be the script deciding what the source looks like. */
    fixLine: (index, line) =>
      line === 'import { supabase } from "./supabase";'
        ? 'import { supabase } from "../lib/supabase";'
        : undefined,
  },
  {
    /* Types, mirrored for the same reason as the layer above: `connectionCountLabel` is a
       function, not a type, and it is what decides whether a screen reads "1 Bill" or
       "1 Bills". Two copies of that string helper that drift apart is a visible defect on
       one platform only, which is exactly the failure the script exists to prevent. */
    name: "the Bill ↔ Job connection types",
    from: resolve(ADMIN, "src/types/billJobConnections.ts"),
    to: resolve(DESKTOP, "src/types/billJobConnections.ts"),
    /* Nothing may differ at all. */
    fixLine: () => undefined,
  },
];

let drift = 0;
let written = 0;

for (const mirror of MIRRORS) {
  const label = relative(REPO, mirror.from);
  const target = relative(REPO, mirror.to);
  const source = readFileSync(mirror.from, "utf8");
  const existing = readFileSync(mirror.to, "utf8");

  /* Every line comes from the source unless `fixLine` explicitly rewrites it, so the
     generated copy cannot contain anything a human added to the source by accident. */
  const sourceLines = source.split("\n");
  const copyLines = sourceLines.map((line, index) => {
    const replacement = mirror.fixLine(index + 1, line);
    return replacement === undefined ? line : replacement;
  });
  const wanted = copyLines.join("\n");

  if (existing === wanted) {
    console.log(`  ok     ${label} -> ${target}`);
    continue;
  }

  /* Name the first differing line rather than the count. "3 lines differ" is not
     actionable; "line 214 says X, the copy says Y" is. */
  const existingLines = existing.split("\n");
  const first = copyLines.findIndex(
    (line, index) => line !== (existingLines[index] ?? "")
  );

  drift++;
  const where = `line ${first + 1}`;
  const says = (lines) => JSON.stringify((lines[first] ?? "").slice(0, 90));
  console.error(
    `  DRIFT  ${label} -> ${target}\n` +
      `           ${where}\n` +
      `           source: ${says(copyLines)}\n` +
      `           copy:   ${says(existingLines)}\n` +
      `           the copy has ${existingLines.length} lines, the source has ${sourceLines.length}`
  );

  if (!checkOnly) {
    writeFileSync(mirror.to, wanted, "utf8");
    written++;
    console.log(`         written`);
  }
}

if (drift === 0) {
  console.log("\nBill Creator mirrors: both copies already match their source.");
  process.exit(0);
}

console.error(
  checkOnly
    ? `\nBill Creator mirrors: ${drift} file(s) drifted. Run without --check to write them.`
    : `\nBill Creator mirrors: ${drift} file(s) rewritten.`
);
process.exit(checkOnly ? 1 : 0);
