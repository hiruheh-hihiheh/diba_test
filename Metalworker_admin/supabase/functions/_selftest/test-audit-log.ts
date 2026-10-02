// The audit trail must actually record what it claims to record.
//
// WHY THIS IS A SEPARATE TEST
// Every audit write in this system is best-effort on purpose: it is never allowed to
// fail a real operation, so its error is logged and dropped. That is the right design
// for a mutation path and it has one dangerous consequence — a write that can NEVER
// succeed looks exactly like a write that succeeded.
//
// That is not hypothetical. `process-bill-upload` and `update-bill` both passed their
// extra context under the key `metadata`, while the column in migration 0003 is
// `detail`. PostgREST turns an unknown key into "column admin_audit_log.metadata
// does not exist" and rejects the whole INSERT. Both call sites caught the error and
// logged a warning to the function's console — so every bill upload and every bill
// edit was recorded nowhere, invisibly, and the apps showed a normal success.
//
// So this test does not need a database. The failure is entirely decidable from the
// source: the column list is in migration 0003, and the keys being sent are in the
// code. Comparing the two is exact, and it is the comparison that was missing.
//
// WHAT IT CHECKS
//   1. The column list parsed out of migration 0003 is the one we expect, so a
//      redefinition of the table is noticed rather than silently absorbed.
//   2. Every `admin_audit_log` insert in the repo sends ONLY columns that exist.
//      A key the table does not have is a write that cannot succeed.
//   3. `metadata` in particular is called out by name, because it is the spelling
//      that has already broken this twice and is the natural guess for anyone
//      writing a new audit call.
//   4. Each insert identifies its actor, names an action, and types its target —
//      the three fields migration 0003's own policy and view depend on.
//   5. The trail is still not readable by a client session, so a future history
//      screen has to go through a deliberate, admin-gated path rather than reading
//      the table directly.
//
// It reads SOURCE, like `test-billing-folders` reads the SQL. Both halves of the
// comparison are in this repository, so the check belongs here rather than in CI
// that needs credentials.
//
//   node supabase/functions/_selftest/test-audit-log.ts

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// `HERE` is .../Metalworker_admin/supabase/functions/_selftest — three levels down
// from the app root, and the repo root is that app's PARENT, not its grandparent.
const APP = resolve(HERE, "../../..");
const REPO = resolve(APP, "..");

/**
 * A path that is expected to exist. A silently-missing path used to make this test
 * skip a whole client, which is the worst failure mode for a check: it reported all
 * green while auditing half the repository. Any path named here must be present, or
 * the test says so instead of quietly testing less.
 */
function mustExist(path: string, what: string): string {
  try {
    statSync(path);
    return path;
  } catch {
    console.error(`MISSING ${what}: ${path}`);
    process.exitCode = 1;
    return path;
  }
}

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const section = (title: string) => console.log(`\n${title}`);

/* ── 1. The real column list, read from the table definition ────────────────
 *
 * Parsed from `CREATE TABLE` rather than hard-coded, so this test describes the
 * table instead of a copy of the table. The parser deliberately only understands
 * the flat `name type` lines this one declaration uses; anything richer would need
 * to be taught to it, and would fail loudly rather than quietly return [].
 */
const migration = readFileSync(
  join(APP, "supabase/migrations/0003_admin_audit_log.sql"),
  "utf8"
);

const createAt = migration.indexOf("CREATE TABLE IF NOT EXISTS admin_audit_log");
if (createAt === -1) {
  console.error("0003_admin_audit_log.sql no longer declares admin_audit_log.");
  process.exitCode = 1;
}

const openParen = migration.indexOf("(", createAt);
let depth = 0;
let closeParen = -1;
for (let i = openParen; i < migration.length; i++) {
  if (migration[i] === "(") depth++;
  else if (migration[i] === ")") {
    depth--;
    if (depth === 0) {
      closeParen = i;
      break;
    }
  }
}
const body = migration.slice(openParen + 1, closeParen);

const columns = new Set<string>();
for (const raw of body.split("\n")) {
  const line = raw.replace(/--.*$/, "").trim();
  if (!line) continue;
  // `id uuid PRIMARY KEY ...` — the first token is the column, the second the type.
  const m = /^(\w+)\s+(\w+)/.exec(line);
  if (m) columns.add(m[1]);
}

section("the table, as migration 0003 declares it");
check(columns.size > 0, "the column list parsed out of the CREATE TABLE", `${columns.size} columns`);
console.log(`  columns: ${[...columns].join(", ")}`);

for (const required of ["id", "actor_id", "action", "target_type", "target_id", "detail", "created_at"]) {
  check(columns.has(required), `the table really has a \`${required}\` column`);
}

/* ── 2. Every audit insert in the repo, and the keys it sends ────────────────
 *
 * The two places an audit row can be written are the edge functions (service role,
 * so the 0003 forge-proof policy does not apply but the COLUMN NAMES still do) and
 * the clients' `auditLog.ts` helper. Both are searched, because both have made this
 * class of mistake in principle and only one had made it in fact.
 */
section("every audit insert sends columns that exist");

/** Source files that could contain an `admin_audit_log` insert. */
function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "out" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const candidates = [
  ...collect(join(APP, "supabase/functions")).filter(
    (f) => !f.includes(`${"_selftest"}`) && !f.includes("_shared")
  ),
  mustExist(join(APP, "src/services/auditLog.ts"), "admin audit helper"),
  mustExist(join(REPO, "Metalworker_desktop/src/services/auditLog.ts"), "desktop audit helper"),
];

/**
 * Strip comments, replacing each with spaces of the SAME LENGTH and keeping every
 * newline, so offsets and line numbers still refer to the original text.
 *
 * This is not cosmetic. Comments in this repo routinely contain colons, braces and
 * backticks (`the column is \`detail\``), and a scanner that does not know comments
 * are not code will read a commented-out `detail:` as if it were real — or, worse,
 * open a string on a backtick inside a comment and swallow the real key along with
 * it. Both happened while writing this test.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const blank = (from: number, to: number) =>
    src.slice(from, to).replace(/[^\n]/g, " ");

  while (i < src.length) {
    const ch = src[i];

    // Strings and template literals: copied verbatim, comments inside them are text.
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") j++;
        j++;
      }
      out += src.slice(i, Math.min(j + 1, src.length));
      i = j + 1;
      continue;
    }

    // Line comment.
    if (ch === "/" && src[i + 1] === "/") {
      let j = i;
      while (j < src.length && src[j] !== "\n") j++;
      out += blank(i, j);
      i = j;
      continue;
    }

    // Block comment.
    if (ch === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
      const end = Math.min(j + 2, src.length);
      out += blank(i, end);
      i = end;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/**
 * The top-level keys of the object literal passed to `.insert(...)`.
 *
 * Hand-written scanner rather than a regex, for two reasons a regex gets wrong:
 *
 *   * DEPTH. The payload is nested (`detail: { fields_changed: [...] }`), and those
 *     inner keys are not columns. Braces, brackets and parens are tracked so only
 *     depth-0 `name:` pairs count.
 *   * STRINGS. A value such as `"note: pending"` must not be read as a key.
 *
 * The caller must pass comment-stripped source (`stripComments`).
 *
 * The argument is not always an object literal: two call sites build the row in a
 * variable first (`const row = {...}; ...insert(row)`). An identifier argument is
 * resolved by finding where it was assigned — searching FORWARD from the
 * assignment keyword for the opening brace, because searching backwards finds the
 * brace of an unrelated enclosing block and reports that block's keys instead.
 */
function keysOfInsert(
  src: string,
  dotAt: number
): { keys: string[]; indirect: boolean; ok: boolean } {
  // `dotAt` is the `.` of `.insert(`. The argument scan has to start at the OPENING
  // paren, not at the dot, or the depth never leaves zero and the "argument" comes
  // back as the rest of the file.
  const openParen = src.indexOf("(", dotAt);
  if (openParen === -1) return { keys: [], indirect: false, ok: false };

  // The text of the `.insert(` argument, up to its matching close paren.
  let d = 0;
  let argEnd = -1;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === "(") d++;
    else if (src[i] === ")") {
      d--;
      if (d === 0) {
        argEnd = i;
        break;
      }
    }
  }
  if (argEnd === -1) return { keys: [], indirect: false, ok: false };
  const arg = src.slice(openParen + 1, argEnd).trim();

  let literal: string;
  // `indirect` records HOW the row was found, not whether it was found: the checks
  // below must be equally strict either way, so this only drives the log line.
  let indirect = false;

  if (arg.startsWith("{")) {
    literal = arg;
  } else {
    // An identifier (or `await foo()`): find where it was assigned an object.
    const ident = /^([A-Za-z_$][\w$]*)/.exec(arg)?.[1];
    // Assigned before the `.insert(` call; offsets are relative, so add `dotAt`.
    const searchEnd = dotAt;
    const assignAt = ident
      ? new RegExp(`\\b${ident}\\s*(?::[^=]*?)?=\\s*\\{`).exec(src.slice(0, searchEnd))
      : null;
    // `assignAt.index === 0` is a valid answer, so the guard tests for null.
    if (!assignAt || assignAt.index === undefined) {
      return { keys: [], indirect: true, ok: false };
    }
    // The `{` belongs to THIS assignment, so look FORWARD from the identifier rather
    // than back to the brace of whatever block encloses it.
    const identAt = searchEnd - src.slice(0, searchEnd).length + assignAt.index;
    const braceAt = src.indexOf("{", identAt);
    if (braceAt === -1) return { keys: [], indirect: true, ok: false };
    literal = braceBalanced(src, braceAt);
    indirect = true;
  }

  /* The literal's OWN braces are not part of the payload. They are counted as
     depth 1 by the loop below, which would push every real key to depth 1 and make
     every insert look empty — so they come off first and the loop starts at the
     keys themselves. */
  literal = literal.trim();
  if (literal.startsWith("{") && literal.endsWith("}")) {
    literal = literal.slice(1, -1);
  }
  if (!literal.trim()) return { keys: [], indirect, ok: false };

  // Collect depth-0 `name:` pairs.
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  while (i < literal.length) {
    const ch = literal[i];
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < literal.length && literal[i] !== quote) {
        if (literal[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (depth === 0) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(literal.slice(i));
      if (m) {
        keys.push(m[1]);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return { keys, indirect, ok: keys.length > 0 };
}

/** The `{...}` starting at `openBrace`, brace-matched. */
function braceBalanced(src: string, openBrace: number): string {
  let d = 0;
  for (let i = openBrace; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}") {
      d--;
      if (d === 0) return src.slice(openBrace, i + 1);
    }
  }
  return "";
}

type Insert = { file: string; line: number; keys: string[]; indirect: boolean; ok: boolean };
const inserts: Insert[] = [];

for (const file of candidates) {
  const src = stripComments(readFileSync(file, "utf8"));
  let at = src.indexOf('from("admin_audit_log")');
  while (at !== -1) {
    // Only the write path matters here. A read is `.select`, and its column list is
    // a projection rather than a set of columns being invented.
    const call = src.slice(at, at + 200);
    const insertAt = call.indexOf(".insert(");
    if (insertAt !== -1) {
      const { keys, indirect, ok } = keysOfInsert(src, at + insertAt);
      inserts.push({
        file: relative(REPO, file).replace(/\\/g, "/"),
        line: src.slice(0, at).split("\n").length,
        keys,
        indirect,
        ok,
      });
    }
    at = src.indexOf('from("admin_audit_log")', at + 1);
  }
}

check(
  inserts.length >= 3,
  "the audit write paths were all found",
  `${inserts.length} insert(s) in ${new Set(inserts.map((i) => i.file)).size} file(s)`
);
for (const i of inserts) {
  console.log(
    `  ${i.file}:${i.line} -> ${i.keys.join(", ") || "(none)"}${i.indirect ? "  [via a variable]" : ""}`
  );
}
/* A file whose row could not be resolved would pass every check below by having no
   keys at all, which is the opposite of a pass. Fail loudly instead. */
for (const i of inserts) {
  check(
    i.keys.length > 0,
    `${i.file}:${i.line} — the inserted row's keys could be read`,
    i.keys.length === 0 ? "could not resolve the object literal" : `${i.keys.length} keys`
  );
}

for (const insert of inserts) {
  const where = `${insert.file}:${insert.line}`;

  /* THE REGRESSION. An unknown key makes PostgREST reject the whole INSERT, and
     every call site here treats an audit failure as non-fatal, so the row is
     silently lost. This is the check that would have caught the real bug. */
  const unknown = insert.keys.filter((k) => !columns.has(k));
  check(
    unknown.length === 0,
    `${where} sends only columns admin_audit_log actually has`,
    unknown.length ? `unknown: ${unknown.join(", ")}` : insert.keys.join(", ")
  );

  /* Called out by name. `metadata` is the natural guess for "the extra context",
     it is what the two bill paths actually used, and a generic unknown-column
     check buried in a loop is easy to miss in a long log. */
  check(
    !insert.keys.includes("metadata"),
    `${where} does not use \`metadata\` (the column is \`detail\`)`,
    insert.keys.includes("metadata") ? "metadata present" : ""
  );

  /* The payload is not optional: a row that records an event but not its payload
     is worse than no row, because a history screen will then show an event with
     nothing to say about it. */
  if (insert.keys.includes("detail") === false) {
    /* get-admin-dispatches genuinely writes no detail. That is allowed — it has
       nothing to add — but it must be a choice, so it is reported, not failed. */
    console.log(`  note   ${where} records no detail payload (allowed)`);
  }

  /* The three fields the 0003 policy and any future history view depend on.
     `actor_id` must be the caller's own uid or the 0003 policy rejects the row; the
     policy cannot be evaluated from source, but the key's presence can be, and its
     absence is the shape that gets the insert rejected. */
  for (const required of ["actor_id", "action", "target_type"]) {
    check(insert.keys.includes(required), `${where} records \`${required}\``);
  }
}

/* ── 3. There is still no client read path ────────────────────────────────────
 *
 * 0003 denies `authenticated` SELECT outright, so the trail is reachable only with
 * the service role. That is deliberate: the log records who did what to which job,
 * worker and bill, and a processor session has no business reading it.
 *
 * A bill's history screen therefore CANNOT read this table directly — it needs an
 * admin-gated path that re-checks the caller. This check exists to make that
 * constraint explicit and to notice if a blanket SELECT policy is ever added by
 * accident, which would turn the audit trail into a data leak for any signed-in
 * user of either client.
 */
section("the trail stays unreadable by a client session");

const denySelect = /CREATE POLICY\s+"audit_log_deny_authenticated_read"[\s\S]*?FOR SELECT\s+TO authenticated\s+USING\s*\(\s*false\s*\)/.test(
  migration
);
check(denySelect, "0003 still denies `authenticated` SELECT on admin_audit_log");

/* A policy granting SELECT to `authenticated` (or `anon`) would override the deny
   above, since RLS policies are permissive and OR together. */
const selectGrants = [...migration.matchAll(
  /CREATE POLICY\s+"([^"]+)"[\s\S]*?FOR SELECT[\s\S]*?TO\s+(authenticated|anon)[\s\S]*?USING\s*\(([^)]*)\)/g
)]
  .filter((m) => !/^\s*false\s*$/.test(m[3] ?? ""))
  .map((m) => `${m[1]} -> TO ${m[2]} USING (${m[3].trim()})`);

check(
  selectGrants.length === 0,
  "no policy lets a client session read the trail",
  selectGrants.length ? selectGrants.join(" | ") : "deny-only"
);

console.log();
console.log(
  failures === 0
    ? "AUDIT LOG CHECKS: all passed."
    : `\nAUDIT LOG CHECKS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;
