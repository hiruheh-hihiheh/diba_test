// Bill ↔ Job connections — schema, security and wire geometry.
//
// WHY THIS TEST HAS NO DATABASE
// Every claim it makes is decidable from this repository: the schema and the security
// model are in migration 0013, the service that calls it is in the desktop app, and
// the wire geometry is pure functions. Reading the source is exact, and it needs no
// credentials, so it runs on every `bills:selftest`.
//
// The companion that DOES touch the database is
// `Metalworker_desktop/scripts/verify-connection-rls.ts`, which proves from outside
// with the public anon key that an unauthenticated caller can do nothing at all.
//
// WHAT IT CHECKS
//   SCHEMA    two real foreign keys, cascading, one row per pair, indexed
//   SECURITY  anon refused at the ACL and by policy; writes only through RPCs;
//             every function pins search_path, revokes PUBLIC and re-checks admin
//   BULK      a list of ids is written in ONE statement, and linking is idempotent
//   UI        the count is text, the wire geometry is right, Show Links starts off
//
//   node supabase/functions/_selftest/test-bill-job-connections.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* The pure wire geometry, imported from the desktop app rather than restated here.
   The restatement is what would let the two drift. */
import {
  anchorAttr,
  groupLinksByJob,
  nodeAttr,
  wireOpacity,
  wirePath,
  wireWidth,
} from "../../../../Metalworker_desktop/src/components/jobs/wireGeometry.ts";
import { connectionCountLabel, jobCountLabel } from "../../../../Metalworker_desktop/src/types/billJobConnections.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/* `HERE` is .../Metalworker_admin/supabase/functions/_selftest — three levels below
   the admin app root, and the repo root is that app's PARENT. Same pair of
   constants `test-audit-log.ts` uses, because the two suites sit side by side. */
const APP = resolve(HERE, "../../..");
const REPO = resolve(APP, "..");

/**
 * A path that must exist.
 *
 * A silently-missing path is the worst failure mode for a check: the suite would
 * report all green while testing nothing at all. Every file read below goes through
 * here, so a moved file fails loudly instead of quietly emptying the test.
 */
function mustRead(path: string): string {
  return readFileSync(path, "utf8");
}

let failures = 0;
const check = (ok: boolean, what: string, detail = ""): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${ok || !detail ? "" : `\n        ${detail}`}`);
};

const mig = mustRead(resolve(APP, "supabase/migrations/0013_bill_job_connections.sql"));
const fix = mustRead(
  resolve(APP, "supabase/migrations/0014_fix_bill_job_connection_rpc_ambiguity.sql")
);
const DESKTOP = resolve(REPO, "Metalworker_desktop");
const jobsPage = mustRead(resolve(DESKTOP, "src/pages/JobsPage.tsx"));
const billsPage = mustRead(resolve(DESKTOP, "src/pages/Bills.tsx"));
const service = mustRead(resolve(DESKTOP, "src/services/billJobConnections.ts"));
const wires = mustRead(resolve(DESKTOP, "src/components/jobs/ConnectionWires.tsx"));
const css = mustRead(resolve(DESKTOP, "src/index.css"));

/* ═══════════════════════════════════════════════════════════════════════════
   1) SCHEMA — one link table, two real foreign keys
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nthe relationship is two real foreign keys, not a polymorphic pair");

/* Only the CREATE TABLE block is inspected, and with its `--` comments stripped: the
   question is which COLUMNS exist, and prose inside the block legitimately mentions
   `invoice_logos` and "the invoice". The functions legitimately RETURN columns like
   `job_no` and `tool_description` too — those are read from the live job row on the way
   out, not stored on the link. */
const tableBlock = (
  /CREATE TABLE IF NOT EXISTS public\.bill_job_connections \(([\s\S]*?)\n\);/.exec(mig)?.[1] ?? ""
)
  .replace(/--[^\n]*/g, "")
  .trim();
check(
  /CREATE TABLE IF NOT EXISTS public\.bill_job_connections/.test(mig),
  "a dedicated link table exists"
);
check(
  /bill_id\s+uuid NOT NULL\s+REFERENCES public\.bills \(id\) ON DELETE CASCADE/.test(mig),
  "bill_id references bills ON DELETE CASCADE",
  "deleting a bill removes its links and cannot reach the bill itself"
);
check(
  /job_id\s+uuid NOT NULL\s+REFERENCES public\.jobs\s+\(id\) ON DELETE CASCADE/.test(mig),
  "job_id references jobs ON DELETE CASCADE"
);
check(
  !/item_type|entity_type|polymorphic/i.test(mig.replace(/^\s*--.*$/gm, "")),
  "no type + id polymorphic columns were introduced",
  "a polymorphic id has no foreign key and therefore no referential integrity"
);
check(
  /CONSTRAINT bill_job_connections_pair_key UNIQUE \(bill_id, job_id\)/.test(mig),
  "a bill/job pair is unique at the database level",
  "duplicates are prevented by a constraint, not merely avoided by the client"
);
check(
  /created_by\s+uuid REFERENCES public\.profiles \(id\) ON DELETE SET NULL/.test(mig),
  "created_by is recorded and survives the author being deleted"
);
check(
  /created_at\s+timestamptz NOT NULL DEFAULT now\(\)/.test(mig),
  "created_at is recorded"
);
check(
  !/invoice|party|amount|total|gst|tool_|status|quantity|job_no/i.test(tableBlock),
  "the link row itself stores no bill or job field",
  "displayed data is resolved from the real rows so it cannot fall out of date",
  tableBlock.slice(0, 400)
);

console.log("\nduplicate links are impossible and lookups are indexed");
check(
  /CREATE INDEX IF NOT EXISTS bill_job_connections_job_id_idx\s+ON public\.bill_job_connections \(job_id\)/.test(
    mig
  ),
  "job_id is indexed for 'which bills does this job have'"
);
check(
  /UNIQUE \(bill_id, job_id\)/.test(mig) &&
    /bill_job_connections_pair_key/.test(mig),
  "bill_id is indexed as the leading column of the unique index",
  "so 'which jobs does this bill have' needs no second index"
);

/* ═══════════════════════════════════════════════════════════════════════════
   2) SECURITY — the same active-admin gate as the rest of billing
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nthe link table is admin-only, and writes are RPC-only");

check(
  /ALTER TABLE public\.bill_job_connections ENABLE ROW LEVEL SECURITY/.test(mig),
  "row level security is enabled"
);
check(
  /CREATE POLICY "bill_job_connections_no_anon_access"[\s\S]*?FOR ALL TO anon\s+USING \(false\) WITH CHECK \(false\)/.test(
    mig
  ),
  "anon is denied by policy"
);
check(
  /REVOKE ALL ON TABLE public\.bill_job_connections FROM anon/.test(mig),
  "anon's table-level grant is revoked",
  "a policy alone does not remove a default privilege granted at table creation"
);
check(
  /CREATE POLICY "bill_job_connections_admin_read"[\s\S]*?FOR SELECT TO authenticated[\s\S]*?role = 'admin' AND p\.is_active = true/.test(
    mig
  ),
  "reads require an active admin, checked as role AND is_active"
);
check(
  /GRANT SELECT ON TABLE public\.bill_job_connections TO authenticated/.test(mig),
  "authenticated is granted read"
);
check(
  !/GRANT[^;]*INSERT[^;]*ON TABLE public\.bill_job_connections/i.test(mig) &&
    !/GRANT[^;]*UPDATE[^;]*ON TABLE public\.bill_job_connections/i.test(mig) &&
    !/GRANT[^;]*DELETE[^;]*ON TABLE public\.bill_job_connections/i.test(mig),
  "authenticated is NOT granted INSERT, UPDATE or DELETE",
  "every write must go through a function that validates, authorises and is transactional"
);

/* PostgreSQL spells a function two different ways and both are load-bearing:
   the DEFINITION names its parameters (`link_bill_jobs(p_bill_id uuid, p_job_ids
   uuid[])`), while GRANT and REVOKE identify it by TYPE only
   (`link_bill_jobs(uuid, uuid[])`). Checking the definition against the grant
   spelling would pass a migration that had revoked nothing. */
const FUNCTIONS: [name: string, decl: string, types: string, gate: "raise" | "where"][] = [
  ["link_bill_jobs", "p_bill_id uuid, p_job_ids uuid[]", "uuid, uuid[]", "raise"],
  ["unlink_bill_jobs", "p_bill_id uuid, p_job_ids uuid[]", "uuid, uuid[]", "raise"],
  ["unlink_job_bill_links", "p_job_ids uuid[], p_bill_ids uuid[]", "uuid[], uuid[]", "raise"],
  ["get_bill_job_connections", "p_bill_id uuid", "uuid", "raise"],
  ["get_job_bill_connections", "p_job_ids uuid[]", "uuid[]", "raise"],
  ["get_job_connection_counts", "p_job_ids uuid[]", "uuid[]", "where"],
  ["get_bill_connection_counts", "p_bill_ids uuid[]", "uuid[]", "where"],
];

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

console.log("\nevery function is pinned, revoked, granted and re-authorises itself");
for (const [fn, decl, types, gate] of FUNCTIONS) {
  const body = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${esc(fn)}\\(${esc(decl)}\\)([\\s\\S]*?)\\$\\$;`
  ).exec(mig);
  const text = body?.[1] ?? "";
  check(!!body, `${fn} exists with the signature the client calls`, `looked for (${decl})`);
  check(
    /SECURITY DEFINER/.test(text) && /SET search_path = public/.test(text),
    `${fn} is SECURITY DEFINER with a pinned search_path`
  );
  /* Two accepted shapes for the same guarantee, both used in this repository: a
     mutating or single-row reader RAISEs, while a list reader puts the gate in WHERE
     so an unauthorised caller gets zero rows instead of an error. Either way the
     check has to be inside the function, because SECURITY DEFINER bypasses RLS. */
  const gated =
    gate === "raise"
      ? /role = 'admin' AND p\.is_active = true[\s\S]*?RAISE EXCEPTION/.test(text)
      : /WHERE EXISTS \([\s\S]*?role = 'admin' AND p\.is_active = true/.test(text);
  check(
    gated,
    `${fn} re-checks the active-admin gate inside the function`,
    "SECURITY DEFINER bypasses RLS, so the gate has to be applied here too"
  );
  check(
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc(fn)}\\(${esc(types)}\\) FROM public;`).test(
      mig
    ),
    `${fn} revokes PUBLIC execution`
  );
  check(
    new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.${esc(fn)}\\(${esc(types)}\\) TO authenticated;`
    ).test(mig),
    `${fn} grants execution to authenticated only`
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   3) BULK — one call, one transaction, idempotent
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nbulk operations are single statements and idempotent");

const linkBody = /CREATE OR REPLACE FUNCTION public\.link_bill_jobs\([\s\S]*?\$\$;/.exec(mig)?.[0] ?? "";
check(
  /ON CONFLICT \(bill_id, job_id\) DO NOTHING/.test(linkBody),
  "re-linking an existing pair is a no-op rather than an error or a rewrite",
  "so created_at and created_by are not falsified by a repeat click"
);
check(
  /INSERT INTO public\.bill_job_connections[\s\S]*?FROM unnest\(p_job_ids\)/.test(linkBody),
  "the whole batch is ONE insert over unnest(p_job_ids)",
  "six jobs is one statement and one transaction, not six requests"
);
check(
  /IF NOT EXISTS \(SELECT 1 FROM public\.bills b WHERE b\.id = p_bill_id\)/.test(linkBody),
  "a bill that no longer exists is refused"
);
check(
  /FROM unnest\(p_job_ids\) AS u\(id\)\s+WHERE NOT EXISTS \(SELECT 1 FROM public\.jobs j WHERE j\.id = u\.id\)/.test(
    linkBody
  ),
  "a job that no longer exists is refused rather than silently skipped",
  "a bulk link that quietly dropped half its jobs would report success"
);
check(
  /RETURN QUERY[\s\S]*?u\.id = ANY \(v_inserted\)/.test(linkBody),
  "the caller is told which links were new and which already existed"
);
check(
  /coalesce\(array_length\(p_job_ids, 1\), 0\) = 0/.test(linkBody),
  "an empty job list is refused instead of silently succeeding"
);

const unlinkBody =
  /CREATE OR REPLACE FUNCTION public\.unlink_job_bill_links\([\s\S]*?\$\$;/.exec(mig)?.[0] ?? "";
check(
  /DELETE FROM public\.bill_job_connections c[\s\S]*?c\.job_id = ANY \(p_job_ids\)[\s\S]*?AND c\.bill_id = ANY \(p_bill_ids\)/.test(
    unlinkBody
  ),
  "bulk unlink removes exactly the cross product, in one statement",
  "so unlinking one bill from one job cannot disturb that job's other bills"
);
check(
  !/DELETE FROM public\.bills/.test(mig) && !/DELETE FROM public\.jobs/.test(mig),
  "no function ever deletes a bill or a job",
  "unlinking must only ever remove the relationship"
);

/* Counts must include the zero rows, or the UI has to guess. */
for (const fn of ["get_job_connection_counts", "get_bill_connection_counts"] as const) {
  const text = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$\\$;`
  ).exec(mig)?.[0] ?? "";
  check(
    /FROM unnest\(p_\w+_ids\) AS \w+\(id\)[\s\S]*?LEFT JOIN public\.bill_job_connections/.test(text),
    `${fn} drives the FROM from unnest so unlinked ids still get a row`
  );
  check(
    /count\(c\.\w+\)/.test(text),
    `${fn} counts the link column, not count(*)`,
    "count(*) would report 1 for an unlinked id"
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   4) AUDIT — ids and counts only
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nlink and unlink are audited without leaking financial detail");
check(
  /action: "bill_job_connections\.created"/.test(service) &&
    /action: "bill_job_connections\.deleted"/.test(service),
  "both directions are audited, with the project's action naming"
);
check(
  /jobCount: ids\.length/.test(service) && /jobIds: ids/.test(service),
  "the audit records how many jobs and which ids"
);
/* Only the audit PAYLOADS are inspected. The file's own prose and the read functions
   legitimately mention invoice_no and party_name — those never reach the trail. */
const auditPayloads = [...service.matchAll(/detail:\s*\{[\s\S]*?\}/g)].map((m) => m[0]).join("\n");
check(
  !/invoice_no|party_name|amount|total|gst|recipient/i.test(auditPayloads),
  "no invoice number, customer or amount is written to the audit trail",
  "the trail is readable by other admins; a link needs ids, not financials",
  auditPayloads.slice(0, 400)
);

/* ═══════════════════════════════════════════════════════════════════════════
   5) UI — the count is text, and the wire layer is honest about itself
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nthe connection count is text, and Show Links starts off");

check(
  connectionCountLabel(0) === "—" &&
    connectionCountLabel(1) === "1 Bill" &&
    connectionCountLabel(3) === "3 Bills",
  "a job's connection count reads as words, with zero as an em dash"
);
check(
  jobCountLabel(0) === "—" && jobCountLabel(2) === "2 Jobs",
  "a bill's job count reads as words"
);
check(
  /const \[showLinks, setShowLinks\] = useState\(false\)/.test(jobsPage),
  "Show Links is OFF on load",
  "the page must look like it did before this feature until asked otherwise"
);
check(
  /aria-pressed=\{showLinks\}/.test(jobsPage),
  "the toggle reports its state to assistive technology"
);
check(
  /<ConnectionsCell/.test(jobsPage) && /Connections\s*\n\s*<\/th>/.test(jobsPage),
  "the job table has a CONNECTIONS column"
);
check(
  /LinkJobsToBillModal/.test(jobsPage),
  "the job page can both show and create connections"
);
check(
  /Link Jobs/.test(billsPage) && /LinkBillsToJobsModal/.test(billsPage),
  "the bill page can link jobs to a bill"
);
check(
  /BillConnectionsPanel/.test(billsPage) && /Connections\s*\n\s*<\/th>/.test(billsPage),
  "the bill table has a CONNECTIONS column and a panel to inspect it"
);
/* The selection gate was widened, which is a visible change and is deliberate. */
check(
  /const canSelect = !showingFolders/.test(jobsPage),
  "checkboxes and the bulk bar are available outside folder view too",
  "linking a job to a bill is meaningful in the full list, which is where an admin starts"
);
check(
  /\{canSelect && \(\s*<BulkActionBar/.test(jobsPage.replace(/\s+/g, " ")),
  "the bulk bar itself follows the same gate"
);

console.log("\nthe wire layer draws nothing it cannot measure, and cannot be clicked");
check(
  /aria-hidden="true"[\s\S]*?pointer-events-none/.test(wires),
  "the wire layer is decorative and takes no pointer events",
  "clicks on rows and actions must behave exactly as they did before"
);
check(
  /if \(!segments\.length \|\| width === 0 \|\| height === 0\) return null;/.test(wires),
  "no layer is rendered at all when there is nothing to draw",
  "so Show Links off costs no DOM and no measurement"
);
check(
  /stroke="currentColor"/.test(wires),
  "wires take their colour from CSS, not a hex in JavaScript",
  "a theme flip recolours them with no React state involved"
);
check(
  /transition: "opacity 140ms ease"/.test(wires),
  "hover emphasis is a short opacity transition",
  "and the project's reduced-motion rule already neutralises it when asked"
);

console.log("\nthe wire colour follows the theme");
check(
  /--color-connection: var\(--theme-connection\)/.test(css),
  "a `text-connection` token exists, so the SVG can use currentColor"
);
check(
  /--theme-connection: #EF4444/.test(css),
  "dark mode wires are red"
);
check(
  /\[data-theme="light"\][\s\S]*?--theme-connection: #2563EB/.test(css),
  "light mode wires are blue"
);

/* ═══════════════════════════════════════════════════════════════════════════
   6) GEOMETRY — the pure functions, exercised directly
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nwire geometry");

check(
  anchorAttr("job-1") === "job-1" && nodeAttr("job-1", "bill-1") === "job-1:bill-1",
  "the anchor and node keys are built the same way the measuring hook looks them up"
);
check(
  /WIRE_ATTR_ANCHOR/.test(jobsPage) && /anchorAttr\(item\.id\)/.test(jobsPage),
  "the job number cell is the wire's anchor, so a wire sweeps across its row"
);

const path = wirePath({ x: 0, y: 0 }, { x: 300, y: 40 });
check(
  /^M 0\.00 0\.00 C \d+\.\d+ 0\.00, \d+\.\d+ 40\.00, 300\.00 40\.00$/.test(path),
  "a wire leaves and arrives horizontally",
  "which is what makes a bundle of wires read as a bundle",
  path
);
check(
  /C 70\.00/.test(wirePath({ x: 0, y: 0 }, { x: 600, y: 0 })),
  "the control handle is a third of the gap, clamped"
);
check(
  /C 12\.00/.test(wirePath({ x: 0, y: 0 }, { x: 4, y: 0 })),
  "a very short gap still gets a visible handle rather than a degenerate curve"
);
/* The property that matters is the DIRECTION of the handles, not their size: a
   leftward wire's control points must both sit left of the start, or the curve
   doubles back on itself before reaching its target. */
const leftPath = wirePath({ x: 0, y: 0 }, { x: -200, y: 0 });
const leftC = /C (-?\d+\.\d+) (-?\d+\.\d+), (-?\d+\.\d+) (-?\d+\.\d+)/.exec(leftPath);
check(
  !!leftC && Number(leftC[1]) < 0 && Number(leftC[3]) < 0,
  "a wire pointing left bows LEFT, not back past its own start",
  "both control points must follow the direction of travel",
  leftPath
);
check(
  wirePath({ x: 0, y: 0 }, { x: 0, y: 80 }).includes("C 0.00 0.00, 0.00 80.00"),
  "a wire straight up or down degenerates to a straight line",
  "rather than dividing by a zero-width gap"
);

const links = [
  { job_id: "j1", bill_id: "b1" },
  { job_id: "j1", bill_id: "b2" },
  { job_id: "j2", bill_id: "b3" },
];
const grouped = groupLinksByJob(links as never);
check(
  grouped.size === 2 &&
    grouped.get("j1")?.length === 2 &&
    grouped.get("j1")?.[0].bill_id === "b1" &&
    grouped.get("j2")?.length === 1,
  "links group per job and keep their order, so chips and wires stay in step"
);
check(
  groupLinksByJob([]).size === 0,
  "no links groups to nothing, without throwing"
);

const hovered = { jobId: "j1", billId: "b1" };
const same = { jobId: "j1", billId: "b1" };
const sibling = { jobId: "j1", billId: "b2" };
const other = { jobId: "j2", billId: "b3" };
check(
  wireOpacity(same, null) === 0.55 && wireOpacity(same, hovered) === 1,
  "with nothing hovered every wire rests; the hovered one comes to the front"
);
check(
  wireOpacity(sibling, hovered) < wireOpacity(same, hovered) &&
    wireOpacity(sibling, hovered) > wireOpacity(other, hovered),
  "a hovered job's other wires dim less than unrelated jobs",
  "so the shape of its bundle stays readable"
);
check(
  wireWidth(same, hovered) === 3 && wireWidth(same, null) === 2,
  "the emphasised wire is thicker, which reads without relying on colour"
);

/* ═══════════════════════════════════════════════════════════════════════════
   7) NOTHING ELSE MOVED
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nthe folders, the actions and the bill logic were not repurposed");
check(
  /removeMultipleJobsFromFolder/.test(jobsPage) && /Remove from folder/.test(jobsPage),
  "the folder actions are still there and still say what they do"
);
check(
  !/folder_items[^\n]*bill_job_connections|bill_job_connections[^\n]*folder_items/.test(
    jobsPage + service
  ),
  "folders and connections are kept apart",
  "a job's folder membership says nothing about whether it is linked to a bill"
);
check(
  /deleteJob\(/.test(jobsPage),
  "job deletion is untouched; the database cascade handles its links"
);

/* ═══════════════════════════════════════════════════════════════════════════
   8) THE AMBIGUOUS-REFERENCE REGRESSION
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\nno PL/pgSQL function names an OUT parameter unqualified again");

/* The defect this section exists for: a PL/pgSQL function that declares
   `RETURNS TABLE (job_id uuid, …)` makes `job_id` a variable, so an unqualified
   `job_id` in a SQL statement inside the body is ambiguous between the variable and a
   real column, and PostgreSQL refuses to guess. It reached production because
   `CREATE FUNCTION` does not resolve names — only the first execution does, which is
   when a user clicks a button. So the check has to be static, and it has to run on
   every change rather than only on the ones someone remembers to try. */
const plpgsqlBodies = [
  ...fix.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(([^)]*)\)([\s\S]*?)\$\$;/g),
].map((m) => ({ name: m[1], params: m[2], body: m[3] }));

check(
  plpgsqlBodies.length > 0,
  "the fix migration is being read at all",
  "a missing or renamed 0014 would leave this section vacuously green"
);

/* Strip comments before any assertion about the SQL. The fix migration deliberately
   QUOTES the broken code in its header — `array_agg(job_id)`, `ON CONFLICT (bill_id,
   job_id)` — to explain the defect, so a check that reads the file as-is sees the
   broken text it is meant to be looking for and passes a file that never fixed
   anything. */
const fixCode = fix.replace(/--[^\n]*/g, "");

/* Every OUT / result column name declared by a function, per its RETURNS TABLE. */
const outNamesOf = (body: string): string[] => {
  const block = /RETURNS TABLE\s*\(([\s\S]*?)\)/.exec(body)?.[1] ?? "";
  return block
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0])
    .filter((n) => /^\w+$/.test(n));
};

let ambiguous: string[] = [];
for (const fn of plpgsqlBodies) {
  const outs = outNamesOf(fn.body);
  if (!outs.length) continue;
  /* Three things are not references even though they spell the name:
       · the RETURNS TABLE declaration that creates the variable,
       · an INSERT target column list, which PostgreSQL resolves against the target
         table and will not accept qualified — and which the self-check proves works,
       · comments and string literals, which are not code at all. */
  const code = fn.body
    .replace(/--[^\n]*/g, "")
    .replace(/RETURNS TABLE\s*\([\s\S]*?\)/, "RETURNS TABLE ()")
    .replace(/(INSERT\s+INTO\s+[\w.]+)\s*\([^)]*\)/gi, "$1 (...)")
    .replace(/'[^']*'/g, "''");
  for (const name of outs) {
    /* A bare occurrence is one NOT preceded by `.` (a table or alias qualifier) and
       NOT part of a longer identifier. */
    const bare = new RegExp(`(?<![.\\w])${name}(?![\\w])`);
    if (bare.test(code)) ambiguous.push(`${fn.name}: ${name}`);
  }
}
check(
  ambiguous.length === 0,
  "no function references one of its own OUT parameters without qualifying it",
  ambiguous.join(" | ")
);

/* The two specific repairs, asserted individually so a regression names itself. */
check(
  /array_agg\(ins\.job_id\)/.test(fixCode) && !/array_agg\(job_id\)/.test(fixCode),
  "link_bill_jobs aggregates the CTE's own column: array_agg(ins.job_id)"
);
check(
  /array_agg\(del\.job_id\)/.test(fixCode) && !/array_agg\(job_id\)/.test(fixCode),
  "unlink_bill_jobs aggregates the CTE's own column: array_agg(del.job_id)"
);
/* `ON CONFLICT (bill_id, job_id)` is parsed as column references too, so it is as
   ambiguous as the aggregate was; naming the constraint removes the class of problem
   rather than this one instance. */
check(
  !/ON CONFLICT \(bill_id, job_id\)/.test(fixCode) &&
    /ON CONFLICT ON CONSTRAINT bill_job_connections_pair_key DO NOTHING/.test(fixCode),
  "the conflict target names the constraint instead of re-listing bare column names"
);
check(
  /RETURNING bill_job_connections\.job_id/.test(fixCode),
  "the inserted row's column is table-qualified in RETURNING"
);

console.log("\nthe fix changed only what was broken");
for (const fn of ["link_bill_jobs", "unlink_bill_jobs"] as const) {
  const fixed = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${fn}\\([^)]*\\)([\\s\\S]*?)\\$\\$;`
  ).exec(fix)?.[1] ?? "";
  check(!!fixed, `${fn} is redefined in 0014, which is the only way to fix an applied function`);
  check(
    /SECURITY DEFINER/.test(fixed) && /SET search_path = public/.test(fixed),
    `${fn} keeps SECURITY DEFINER and a pinned search_path`
  );
  check(
    /role = 'admin' AND p\.is_active = true/.test(fixed) && /RAISE EXCEPTION/.test(fixed),
    `${fn} keeps its active-admin check`
  );
  /* The link path stays idempotent through ON CONFLICT; the unlink path has no
     conflict clause at all, because deleting a link cannot conflict. */
  check(
    fn === "link_bill_jobs"
      ? /ON CONFLICT/.test(fixed)
      : /RETURNING c\.job_id/.test(fixed),
    `${fn} keeps its conflict/absent-conflict behaviour`
  );
  check(
    /DISTINCT u\.id/.test(fixed) && /u\.id = ANY \(v_\w+\)/.test(fixed),
    `${fn} still reports one row per requested job, with a linked/unlinked flag`
  );
}
check(
  !/CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE POLICY|DROP POLICY|CREATE INDEX/.test(
    fixCode
  ),
  "0014 touches no table, policy or index",
  "a bug fix for two functions must not also change the schema"
);
check(
  !/CREATE OR REPLACE FUNCTION public\.(unlink_job_bill_links|get_bill_job_connections|get_job_bill_connections|get_job_connection_counts|get_bill_connection_counts)/.test(
    fixCode
  ),
  "the five functions that were never broken are left alone"
);
check(
  /REVOKE ALL ON FUNCTION public\.link_bill_jobs\(uuid, uuid\[\]\) FROM public;/.test(fix) &&
    /GRANT EXECUTE ON FUNCTION public\.link_bill_jobs\(uuid, uuid\[\]\) TO authenticated;/.test(
      fix
    ) &&
    /REVOKE ALL ON FUNCTION public\.unlink_bill_jobs\(uuid, uuid\[\]\) FROM public;/.test(fix) &&
    /GRANT EXECUTE ON FUNCTION public\.unlink_bill_jobs\(uuid, uuid\[\]\) TO authenticated;/.test(
      fix
    ),
  "both functions re-issue their REVOKE and GRANT, which are dropped with the old body"
);

console.log("\nthe migration proves itself against the real database");
check(
  /SAVEPOINT bill_job_connections_selfcheck/.test(fix) &&
    /ROLLBACK TO SAVEPOINT bill_job_connections_selfcheck/.test(fix),
  "the self-check runs inside a savepoint and is rolled back",
  "so it can call the real functions without leaving a row behind"
);
check(
  /set_config\('request\.jwt\.claim\.sub'/.test(fix),
  "it authenticates as a real active admin rather than bypassing the gate",
  "the code path under test is then the one a user actually takes"
);
check(
  /RAISE EXCEPTION/.test(fix) && /ROLLBACK TO SAVEPOINT/.test(fix),
  "a failed assertion aborts the whole migration",
  "so a broken body can never be recorded as applied"
);
/* Every operation the bug report asked to be covered, asserted as present. */
for (const [what, pattern] of [
  ["three labour jobs to one bill", /SELFCHECK-L/],
  ["three with-material jobs", /SELFCHECK-M/],
  ["both types on one bill", /mixed link/],
  ["a repeated link creating nothing", /idempotency broken/],
  ["one job to two bills", /one job to two bills/],
  ["unlinking from one bill", /unlink_bill_jobs: expected 1 removed/],
  ["other bill's links untouched", /unlink removed the wrong row/],
  ["delete cascading to the link only", /cascade broken/],
] as const) {
  check(pattern.test(fix), `the self-check covers ${what}`);
}
check(
  /WHEN insufficient_privilege/.test(fix) && /WHEN data_exception/.test(fix),
  "and that the authorization and empty-list refusals still hold"
);
check(
  /SKIPPED/.test(fix),
  "it skips rather than failing when no active admin exists",
  "a fresh project must still be able to apply this migration"
);

console.log();
console.log(
  failures === 0
    ? "BILL ↔ JOB CONNECTIONS: all passed."
    : `\nBILL ↔ JOB CONNECTIONS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;