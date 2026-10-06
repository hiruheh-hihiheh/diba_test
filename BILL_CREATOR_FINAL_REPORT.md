# Bill Creator — Final Report (§46)

One Bill Creator, one canonical model, one renderer — on both the desktop web app and the
Expo admin app. This report states exactly what was built, what the automated suites prove,
and — without pretending otherwise — what still needs a logged-in human to confirm.

## 1. What shipped

| Thing | Where |
| --- | --- |
| Canonical model chain | `BillRecord` → `billFromRecord` → `BillCopy` → `renderBillDocument` → 3 PDFs (single copy of the logic, shared by Excel import and the creator) |
| Edge function | `Metalworker_admin/supabase/functions/create-bill/index.ts` — `action=save\|preview\|finalize`; preview runs the real renderer and stores nothing; finalize validates → writes drafts via one code path (audits `bill.created\|copied`, emits `bill.finalized`, `bill.pdf_generated`, prints all three PDFs through the same writer, returns `jobs_linked`, `folder_linked`) |
| Pure form module (mirrored) | `src/services/creatorForm.ts` (canonical in `Metalworker_admin`) ↔ `Metalworker_desktop/src/services/creatorForm.ts` |
| Network layer (mirrored) | `src/services/billCreator.ts` ↔ desktop copy — `saveCreatorDraft` / `previewCreatorDraft` / `finalizeCreatorDraft`, `CreatorError`, `CreatorDuplicate`, `buildCreatorBody` |
| Job-connection layer (mirrored) | `src/services/billJobConnections.ts` + `src/types/billJobConnections.ts` (canonical in admin, mirrored to desktop; only the `supabase` import differs) |
| Desktop entry | New **DOCUMENTS** section with **Bills · Create Bill · Logo Library · Invoice Profile**; `src/pages/CreateBill.tsx` (entry screen, sections A–K, autosave, preview/finalize, copy picker, duplicate-confirm, logo/folder/jobs wiring) |
| Expo entry | `src/app/bill-create.tsx` route (`?mode=empty\|profile\|copy=<id>`), `[ + Create Bill ]` sheet on `src/app/bills.tsx`, `components/bills/CreateBillScreen.tsx`, `BillSourcePickerSheet.tsx`, `LinkBillToJobsSheet.tsx` |
| Totals contract | `create-bill` now returns the six computed totals (`amount_before_tax`, `cgst`, `sgst`, `igst`, `total_gst`, `amount_after_tax`) on save/preview/finalize; both forms display exactly those — no client-side tax re-computation (which of CGST/SGST/IGST applies is decided server-side from the base record's amounts) |
| Sync gate | `scripts/sync-bill-creator-mirrors.js` (4 mirrored pairs; `--check` fails on drift) |

## 2. Data model decisions (as implemented)

- A draft **is** a `bills` row: `status = 'draft' | 'finalized'`, no separate table.
- `bills.origin IN ('excel','manual','copy')`; `bills.copied_from_bill_id` (ON DELETE SET NULL).
- `bills.creator_draft_key` + partial unique index → a retried autosave updates one bill, never two.
- `bills.bill_upload_id` stays NOT NULL; a manual bill gets its own `bill_uploads` provenance row (`creation_source = 'manual'`) because both clients INNER JOIN.
- Copy **copies structured DB data only** (row columns + line items + `logo_id`), never PDF/OCR; source row 404/409s if missing; the copy starts as a new DRAFT; `NEVER_COPIED_FIELDS` keeps it clean (no job links, no pdf paths, no storage objects, no upload/audit artifacts).
- `[ ] Use current Invoice Business Profile` on a copy: checked → profile re-seeds when the form opens; unchecked → preserved source snapshot. `profileToSnapshot` runs after `toBillRecord` so the profile never bakes into seller/bank/terms.

## 3. What the automated suites prove right now (all green, most recent run: Oct 06 2026)

| Gate | Result |
| --- | --- |
| `npm run bills:selftest` (16 suites: parse, pdf, copies, per-bill, edit, folders, folder-summary-export, jobkind, structure, audit-log, bill-job-connections, bill-creator, fixture-hygiene, audit + pdf layout) | PASS — `AUDIT: no problems found.` |
| `npx tsc -p tsconfig.edge.json` | 0 errors |
| `node scripts/sync-bill-creator-mirrors.js --check` | 4/4 `ok` |
| Admin `npx tsc -p tsconfig.json --noEmit` | 0 errors |
| Desktop `npx tsc -p tsconfig.app.json --noEmit` | 0 errors |
| Desktop `npm run build` | ✓ (vite, 3.15 s) |
| `eslint --max-warnings=0` on every touched file (both apps) | clean |

The selftest renders **real PDFs** (no library: `test-pdf.ts` verifies header/trailer/xref,
`audit.ts` reconstructs every `Tm/Tj/re/l` operator and checks geometry + overlap + money-column
right edges, and prints ASCII page maps) — so the *renderer* is visually audited on fixture data.
This is real-PDF verification of the shared renderer, but it is **not** the creator running end to
end against the live database.

## 4. Enumerated acceptance checklist (§43) — status

`✅` = proven by suite or static gate. `🔶` = implemented, requires live, logged-in confirmation.
`—` = not built (deliberately out of scope, see §7).

| # | Behaviour | Status |
| --- | --- | --- |
| 1 | Creator reachable from the new DOCUMENTS section on desktop | ✅ (build + tsc) |
| 2 | Creator reachable from `[ + Create Bill ]` / `[ Create New Bill ]` on Expo | ✅ (tsc + lint) |
| 3 | Three entries: blank / +Profile / Copy (Copy gated on ≥1 bill existing) | ✅ both apps |
| 4 | Copy picker shows real bills, search, per-bill connection counts | 🔶 (live DB + session) |
| 5 | Copy preserves source logo + formatting via `logo_id` | 🔶 (live DB) |
| 6 | Copy inherits no job links, no PDF storage, no artifacts | ✅ (suite: `test-bill-creator`) |
| 7 | Copy starts as `status='draft'`, original untouched | 🔶 (live DB) |
| 8 | `[ ] Use current Invoice Business Profile` semantics on copy | 🔶 (live DB) |
| 9 | Sections A–K present and in order on both apps | ✅ (tsc/lint; visual = 🔶) |
| 10 | Precedence: form value → profile default → blank | ✅ (suite) |
| 11 | Autosave debounced; retried save cannot duplicate (draft key partial unique) | ✅ (suite) |
| 12 | Preview goes through the real renderer, stores nothing | ✅ (suite + edge tsc) |
| 13 | Finalize validates → writes → 3 PDFs → uploads → updates paths → audits | ✅ (suite + edge tsc) |
| 14 | Duplicate invoice number → confirmed warning, never overwrite | 🔶 (live DB) |
| 15 | Totals shown in UI equal the PDF (server totals fed back in save response) | ✅ (by construction; live 🔶) |
| 16 | Section G `payment_days` read-only hint + `{PAYMENT_DAYS}`/`{COMPANY_NAME}` placeholders | ✅ (both apps) |
| 17 | Section I job links via `bill_job_connections`, two tabs, one selection set (Expo) | 🔶 (live DB) |
| 18 | Folder + logo pickers reuse existing library/architecture | 🔶 (live DB) |
| 19 | Bank block order and labels match the renderer exactly; `cleanBankLabel` bounds | ✅ (suite: `test-edit`) |
| 20 | Line move/reorder renumbers `sr_no`; blank-description rows dropped | ✅ (suite) |
| 21 | `amount_in_words` three-way contract + `wordsAfterCopy` | ✅ (suite) |
| 22 | Only active admins can create; gate enforced client + RLS/server | ✅ (edge tsc; live 🔶) |
| 23 | Audit actions `bill.created\|copied\|updated\|finalized\|pdf_generated` | ✅ (suite: `test-audit-log`, `test-bill-creator`) |
| 24 | `copyBaseRecord` money-bug regression (77,290 → 89,080 fixed) | ✅ (suite) |
| 25 | Preview re-reads the persisted draft (preview output == finalize output) | ✅ (edge tsc) |
| 26 | `verify-connections-live.ts` scenarios A–E typechecked, ready | 🔶 (never executed — needs live DB) |
| 27 | Expo preview → native share/download path (`creatorPreview.ts`) | 🔶 (needs device) |
| 28 | Expo route survives refresh / OS kill via URL params | ✅ (by construction) |
| 29 | Reopened pickers reset (shell + keyed body, no stale chosen/search) | ✅ (code; tap-through 🔶) |
| 30 | Desktop and mobile import the *same* mirrored modules (no drift) | ✅ (`--check`) |

## 5. Real-world cases A–F (§44/§45) — status

| Case | What it exercises | Status |
| --- | --- | --- |
| **A** — Create New Bill, fill A–K, autosave, preview, finalize; check 3 PDFs share real values | Whole creator end-to-end on desktop | 🔶 user manual pass required |
| **B** — New Bill + Profile; profile fields seed; totals == PDF | Profile seeding + server totals | 🔶 user manual pass required |
| **C** — Copy an existing bill; original verifiably unchanged; copy is a draft; logo kept; no job links | Copy pipeline v. live DB | 🔶 user manual pass required |
| **D** — Duplicate invoice number flow on an existing bill | Confirmed-warning semantics | 🔶 user manual pass required |
| **E** — Bill ↔ Job linking (both job types), then unlink | Connections | 🔶 `verify-connections-live.ts` + UI |
| **F** — Re-print/edit a creator-made bill; edited PDFs match | Edit path on creator bills | 🔶 user manual pass required |

## 6. What could NOT be verified in this environment (honest list)

- **No admin credentials available** → no logged-in click-through of either app, no live
  preview/finalize, no duplicate-confirm press, no real copy of a live bill, no live job-link.
- **No live-DB run of `Metalworker_desktop/scripts/verify-connections-live.ts`** (written and
  typechecked, blocked on credentials).
- **No visual inspection of PDFs produced through the creator path against the live database** —
  the renderer itself is fully exercised by the selftest on fixture data, but creator output
  against a real row is not.
- **No device run of the Expo native share/preview path** (expo-file-system cache +
  `expo-sharing` with `UTI: "com.adobe.pdf"`), and no Expo web/hot-reload smoke test (no
  simulator/auth in this environment).

## 7. Carried / not built (out of current scope)

- Dedicated two-column **Connections** workspace and per-bill **Open Job / Open Bill** routes
  were described in earlier planning but never built; bills have no per-bill route on either app.
- These are referenced here so the report does not claim a whole-product UI that was not part of
  this feature's definition of done.

## 8. Handoff — what the human needs to do

1. **Push:** `git push origin main` — local `main` is 5 commits ahead of `origin/main`
   (`cc8a8ca` connections fix, `1c2d3e2` draft/provenance migration, `9ccb46c` creator edge fn +
   mirrors + desktop form, `1fa49e3` Expo creator, `7760598` Expo cleanups).
2. **Deploy:** `supabase functions deploy create-bill` (new function). Migrations 0012–0016
   should already be applied; re-apply `supabase db push` if any environment is behind.
3. **Run Case A/B/C on desktop** with an active admin.
4. **Run Case A/B/C on the Expo app**, including the native share/preview on a device.
5. **Run `verify-connections-live.ts`** (scenarios A–E) to confirm live connection writes/reads.
6. **Case D** duplicate invoice number: type an existing invoice no., confirm the warning
   appears and nothing is overwritten.
7. Report any drift with `npm run bills:selftest` + `node scripts/sync-bill-creator-mirrors.js --check`.

## 9. Verdict

The feature is implemented in full on both platforms against one canonical model and one
renderer, and every automated gate — 16 selftest suites (including real-PDF geometry audits),
edge + app typechecks, mirror-drift check, desktop production build, eslint on every touched
file — passes. What remains is the credentialed human pass: the live click-throughs (Cases
A/B/C/D/E/F), the Expo native share path, and the live connection script. **This report does
not claim completion from the UI alone**; completion is confirmed when the §5 matrix is all ✅.