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
  buildBillNodes,
  groupLinksByBill,
  groupLinksByJob,
  hoverBill,
  hoverJob,
  isBillEmphasised,
  layoutBillNodes,
  wireOpacity,
  wirePath,
  wireWidth,
  WIRE_ATTR_ANCHOR,
  WIRE_ATTR_RAIL,
} from "../../../../Metalworker_desktop/src/components/jobs/wireGeometry.ts";
import {
  computePopoverPosition,
  TRIGGER_GAP,
  VIEWPORT_PADDING,
} from "../../../../Metalworker_desktop/src/components/ui/popoverPosition.ts";
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
const rail = mustRead(resolve(DESKTOP, "src/components/jobs/BillNodeRail.tsx"));
const popover = mustRead(resolve(DESKTOP, "src/components/ui/AnchoredPopover.tsx"));
const cell = mustRead(resolve(DESKTOP, "src/components/jobs/ConnectionsCell.tsx"));
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
  anchorAttr("job-1") === "job-1" && WIRE_ATTR_ANCHOR === "data-wire-anchor",
  "a row's anchor is its job id under one attribute name",
  "so the measuring hook and the page cannot disagree about what to look for"
);
check(
  WIRE_ATTR_RAIL === "data-wire-rail",
  "the bill-node rail is marked with its own attribute",
  "the hook uses it to tell 'Show Links is on but no rail rendered' from 'off'"
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

const hovered = hoverBill("b1");
const onB1 = { jobId: "j1", billId: "b1" };
const other = { jobId: "j2", billId: "b3" };
check(
  wireOpacity(onB1, null) === 0.55 && wireOpacity(onB1, hovered) === 1,
  "with nothing hovered every wire rests; an emphasised one comes to the front"
);
check(
  wireOpacity(other, hovered) < wireOpacity(onB1, hovered),
  "hovering a BILL emphasises its wires and dims unrelated ones",
  "which is the case that makes one invoice with five jobs legible"
);
check(
  wireOpacity({ jobId: "j1", billId: "b2" }, hoverJob("j1")) === 1 &&
    wireOpacity({ jobId: "j2", billId: "b3" }, hoverJob("j1")) === 0.12,
  "hovering a JOB emphasises every wire out of that row, and only those"
);
check(
  isBillEmphasised("b1", hoverBill("b1")) && !isBillEmphasised("b2", hoverBill("b1")),
  "only the pointed-at bill's node highlights, not every node on the rail"
);
check(
  !isBillEmphasised("b1", null) && !isBillEmphasised("b1", hoverJob("j1")),
  "and nothing highlights when the pointer is not on a bill"
);
check(
  wireWidth(onB1, hovered) === 3 && wireWidth(onB1, null) === 2,
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

/* ═══════════════════════════════════════════════════════════════════════════
   9) ONE BILL, ONE NODE — the consolidation this change is about
   ═══════════════════════════════════════════════════════════════════════════ */
console.log("\none bill is drawn once, however many rows point at it");

/* A link shaped exactly like the one the database returns. Only the fields the
   visual layer reads are needed, so these are deliberately minimal. */
const link = (jobId: string, billId: string, label: string, party: string | null = null) =>
  ({ job_id: jobId, bill_id: billId, label, party_name: party }) as never;

const allMounted = (...ids: string[]) => new Set(ids);

// 1, 2 ── the same bill from several rows
{
  const nodes = buildBillNodes(
    [link("j1", "bA", "SEW/317/2026-27", "Hawkins Cookers Ltd."), link("j2", "bA", "SEW/317/2026-27")],
    allMounted("j1", "j2")
  );
  check(nodes.length === 1, "2 jobs on one bill produce exactly ONE node", `got ${nodes.length}`);
  check(nodes[0].jobs.length === 2, "and that node carries both jobs", `${nodes[0].jobs.length}`);
  check(
    nodes[0].label === "SEW/317/2026-27" && nodes[0].partyName === "Hawkins Cookers Ltd.",
    "the node names the invoice and the customer once"
  );
}
{
  const five = buildBillNodes(
    ["j1", "j2", "j3", "j4", "j5"].map((j) => link(j, "bA", "SEW/317/2026-27")),
    allMounted("j1", "j2", "j3", "j4", "j5")
  );
  check(five.length === 1, "5 jobs on one bill still produce exactly ONE node", `got ${five.length}`);
  check(five[0].jobs.length === 5, "carrying all five", `${five[0].jobs.length}`);
}

// 3, 4 ── the reverse case, and two bills side by side
{
  const twoFromOneJob = buildBillNodes(
    [link("j1", "bA", "Bill A"), link("j1", "bB", "Bill B")],
    allMounted("j1")
  );
  check(twoFromOneJob.length === 2, "one job on TWO bills produces TWO nodes", `${twoFromOneJob.length}`);
}
{
  const mixed = buildBillNodes(
    [
      link("j1", "bA", "Bill A"),
      link("j2", "bA", "Bill A"),
      link("j3", "bA", "Bill A"),
      link("j4", "bB", "Bill B"),
      link("j5", "bB", "Bill B"),
    ],
    allMounted("j1", "j2", "j3", "j4", "j5")
  );
  check(
    mixed.length === 2,
    "3 jobs on Bill A and 2 on Bill B produce exactly TWO nodes",
    `${mixed.length}`
  );
  check(
    (mixed.find((n) => n.billId === "bA")?.jobs.length ?? 0) === 3 &&
      (mixed.find((n) => n.billId === "bB")?.jobs.length ?? 0) === 2,
    "each node keeps only its own jobs"
  );
}

// 5, 11 ── job type is not part of a node's identity
{
  const bothTypes = buildBillNodes(
    [link("j1", "bA", "Bill A"), link("j2", "bA", "Bill A"), link("j3", "bA", "Bill A")],
    allMounted("j1", "j2", "j3")
  );
  check(
    bothTypes.length === 1,
    "labour and with-material jobs sharing a bill share ONE node",
    "job type is a property of the job, not of the bill it points at"
  );
}

// 10 ── a node must not outlive its rows
{
  const filtered = buildBillNodes(
    [link("j1", "bA", "Bill A"), link("j2", "bB", "Bill B")],
    allMounted("j2")
  );
  check(
    filtered.length === 1 && filtered[0].billId === "bB",
    "a bill whose only job was filtered out loses its node",
    "otherwise the rail would keep a stale card no visible row points at"
  );
  check(
    buildBillNodes([link("j1", "bA", "Bill A")], allMounted()).length === 0,
    "a bill with no visible jobs at all produces nothing"
  );
}

// grouping is the same thing said differently, and must agree with buildBillNodes
{
  const mixedLinks = [link("j1", "bA", "A"), link("j2", "bA", "A"), link("j3", "bB", "B")];
  check(
    groupLinksByBill(mixedLinks).size === 2,
    "groupLinksByBill buckets by bill id, which is what buildBillNodes builds on"
  );
  check(
    buildBillNodes(mixedLinks).length === groupLinksByBill(mixedLinks).size,
    "and the two agree on how many nodes there are"
  );
}

console.log("\nnodes are placed in the middle of the rows pointing at them");
{
  const opts = { nodeHeight: 46, minGap: 10, minY: 0, maxY: 1000 };
  const anchors = new Map([
    ["j1", 100],
    ["j2", 200],
    ["j3", 300],
  ]);
  const one = layoutBillNodes(
    buildBillNodes([link("j1", "bA", "A"), link("j2", "bA", "A"), link("j3", "bA", "A")]),
    anchors,
    opts
  );
  check(one.length === 1 && one[0].y === 200, "a node sits at the MEAN of its rows", `${one[0]?.y}`);
  check(one[0].jobCount === 3, "and reports how many rows point at it");
}
{
  /* Two bills whose jobs interleave both want the middle, so they must be pushed apart
     rather than drawn on top of each other. */
  const anchors = new Map([
    ["j1", 100],
    ["j2", 200],
    ["j3", 300],
    ["j4", 400],
  ]);
  const opts = { nodeHeight: 46, minGap: 10, minY: 0, maxY: 1000 };
  const nodes = layoutBillNodes(
    buildBillNodes(
      [link("j1", "bA", "A"), link("j2", "bB", "B"), link("j3", "bA", "A"), link("j4", "bB", "B")],
      allMounted("j1", "j2", "j3", "j4")
    ),
    anchors,
    opts
  );
  check(nodes.length === 2, "interleaved bills still yield two nodes");
  check(
    Math.abs(nodes[0].y - nodes[1].y) >= 46,
    "and never overlap",
    `separation ${Math.abs(nodes[0].y - nodes[1].y)}pt`
  );
}
{
  /* Near the bottom the stack would overrun, so it is lifted back inside the area
     rather than being drawn off the end of the page. */
  const anchors = new Map([
    ["j1", 900],
    ["j2", 940],
    ["j3", 980],
  ]);
  const opts = { nodeHeight: 46, minGap: 10, minY: 0, maxY: 1000 };
  const nodes = layoutBillNodes(
    buildBillNodes([link("j1", "bA", "A"), link("j2", "bB", "B"), link("j3", "bC", "C")]),
    anchors,
    opts
  );
  check(
    nodes.every((n) => n.y <= 1000 - 23 + 0.001),
    "nodes are lifted back inside the drawable area",
    `max ${Math.max(...nodes.map((n) => n.y))}`
  );
  check(
    Math.abs(nodes[0].y - nodes[1].y) >= 46 && Math.abs(nodes[1].y - nodes[2].y) >= 46,
    "and the lift does not make them overlap again"
  );
  check(
    nodes[0].y < nodes[1].y && nodes[1].y < nodes[2].y,
    "nodes come back top-to-bottom, so paint order is stable frame to frame"
  );
}
check(
  layoutBillNodes([], new Map(), { nodeHeight: 46, minGap: 10, minY: 0, maxY: 100 }).length === 0,
  "no nodes lays out to nothing, without throwing"
);

console.log("\nShow Links off means no rail and no wires");
check(
  /\{showLinks && \(\s*<th/.test(jobsPage.replace(/\s+/g, " ")),
  "the rail column is only rendered while Show Links is on",
  "so the default table is byte-for-byte what it was before this feature"
);
check(
  /useConnectionWires\(\{[\s\S]*?enabled: showLinks/.test(jobsPage),
  "and the measuring hook is gated on Show Links, so nothing is measured when it is off"
);
check(
  /if \(!segments\.length/.test(wires),
  "the wire layer renders nothing when there is nothing to draw"
);
check(
  !/WIRE_ATTR_NODE|data-wire-node|showChips/.test(cell),
  "the connections cell no longer renders a per-bill chip or a wire target",
  "that per-row chip was what made three jobs on one invoice look like three invoices"
);
check(
  !/<button[\s\S]{0,200}?bills\.map/.test(cell) &&
    /<AnchoredPopover[\s\S]*?\{bills\.map/.test(cell),
  "the bills are listed only inside the popover, not in the table cell itself",
  "so the cell stays a count in both Show Links states"
);
check(
  /connectionCountLabel\(count\)/.test(cell),
  "but it still shows the count as text",
  "so the relationship survives with the wires off and for a screen reader"
);
check(
  /<BillNodeRail/.test(jobsPage) && /nodes=\{wireGeometry\.nodes\}/.test(jobsPage),
  "the rail is rendered once per page from the measured nodes"
);

console.log("\nthe rail cannot swallow table clicks");
check(
  /z-\[3\] pointer-events-none/.test(rail),
  "the node layer is transparent to the pointer"
);
check(
  /pointer-events-auto/.test(rail) && /<button/.test(rail),
  "with the cards themselves interactive"
);
check(
  /pointer-events-none/.test(wires) && /stroke="currentColor"/.test(wires),
  "and the wires are decoration that cannot intercept a click"
);

console.log("\nthe popover is portalled so the table cannot clip it");
check(
  /createPortal/.test(popover) && /document\.body/.test(popover),
  "the panel is rendered into <body>, not into the row that opened it"
);
check(
  /className=\{`fixed z-\[200\]/.test(popover),
  "and positioned fixed against the viewport",
  "an absolutely positioned child of a cell inherits that cell's clipping, and no z-index lifts it out"
);
check(
  /addEventListener\("scroll", reposition, true\)/.test(popover),
  "it follows its trigger while any ancestor scrolls",
  "capture phase, because a bubble-phase listener on window never sees an inner scroll box"
);
check(
  /open\) schedule|if \(!open\) return;/.test(popover) &&
    !/addEventListener\("scroll"/.test(cell),
  "only an OPEN panel listens, so fifty rows do not each react to every scroll event"
);
check(
  /<AnchoredPopover/.test(cell) && /<AnchoredPopover/.test(rail),
  "both the row popover and the card popover use the one implementation"
);

console.log("\nviewport placement: flip, then clamp");
const VP = { width: 1000, height: 800 };
const PANEL = { width: 288, height: 240 };
const rect = (top: number, left: number, width = 120, height = 24) => ({
  top,
  left,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
{
  const below = computePopoverPosition(rect(100, 400), PANEL, VP);
  check(
    below.placement === "bottom" && below.top === 100 + 24 + TRIGGER_GAP,
    "with room below, the panel opens below the trigger"
  );
  check(
    Math.abs(below.left - (400 + 60 - 144)) < 0.01,
    "and is centred on it",
    `left ${below.left}`
  );
  check(below.caretX !== null, "with a caret pointing back at the trigger");
}
{
  /* The bug that started this: a row near the bottom of the table. */
  const near = computePopoverPosition(rect(700, 400), PANEL, VP);
  check(near.placement === "top", "with no room below, it opens ABOVE the trigger");
  check(
    near.top + PANEL.height <= 700 - TRIGGER_GAP + 0.01,
    "and is entirely above it",
    `top ${near.top}`
  );
  check(near.caretX !== null, "the caret is still there when it flips");
}
{
  const right = computePopoverPosition(rect(100, 950), PANEL, VP);
  check(
    right.left + PANEL.width <= VP.width - VIEWPORT_PADDING + 0.01,
    "a panel that would cross the right edge is shifted back inside",
    `left ${right.left}, right ${right.left + PANEL.width}`
  );
  check(right.left >= VIEWPORT_PADDING - 0.01, "and never crosses the left edge either");
  check(
    right.caretX === null,
    "the caret is dropped rather than drawn on a corner",
    "its trigger is off past the panel's own edge"
  );
}
{
  /* A trigger hard against the left edge: the panel gets clamped, but the trigger is
     still inside the panel's horizontal span, so the caret is still meaningful. */
  const left = computePopoverPosition(rect(100, 4), PANEL, VP);
  check(left.left >= VIEWPORT_PADDING - 0.01, "a trigger hard against the left edge is respected");
  check(
    left.caretX !== null && Math.abs(left.left + left.caretX - (4 + 60)) < 0.01,
    "and its caret still points at the trigger",
    `caret ${left.caretX}`
  );
}
{
  const small = computePopoverPosition(rect(100, 400), { width: 400, height: 900 }, VP);
  check(
    small.left >= VIEWPORT_PADDING && small.left + 400 <= VP.width - VIEWPORT_PADDING + 0.01,
    "a panel wider than the window is clamped to the padding on both sides"
  );
}
{
  /* Taller than the space on either side: below still wins, because that is the side
     people read first. The panel itself is capped by the component's maxHeight and
     scrolls internally, so what has to hold here is that it STARTS on screen, on the
     right side of the trigger. */
  const huge = computePopoverPosition(rect(300, 400), { width: 200, height: 700 }, VP);
  check(huge.placement === "bottom", "when neither side fits, it opens below");
  check(
    huge.top === 300 + 24 + TRIGGER_GAP && huge.top >= 0 && huge.top < VP.height,
    "starting on screen, just under its trigger",
    `top ${huge.top}`
  );
}
check(
  /maxHeight/.test(popover) && /overflow-y-auto/.test(popover),
  "an over-tall panel scrolls internally rather than running off the window"
);
check(
  VIEWPORT_PADDING >= 8 && VIEWPORT_PADDING <= 12,
  "the viewport padding is the 8–12px asked for",
  `${VIEWPORT_PADDING}px`
);
check(
  [computePopoverPosition(rect(100, 400), PANEL, { width: 320, height: 300 }),
   computePopoverPosition(rect(250, 100), PANEL, { width: 320, height: 300 })].every(
    (p) => p.left >= 0 && p.left + PANEL.width <= 320 + 0.01 && p.top >= 0
  ),
  "placement holds on a small window too"
);

console.log();
console.log(
  failures === 0
    ? "BILL ↔ JOB CONNECTIONS: all passed."
    : `\nBILL ↔ JOB CONNECTIONS: ${failures} failure(s).`
);
if (failures > 0) process.exitCode = 1;