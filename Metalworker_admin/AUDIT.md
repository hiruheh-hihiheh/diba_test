# Metalworker — Code Audit & Fix Log

Scope: **Pass 1** = `Metalworker_admin` only (Expo SDK 57).
**Pass 2** = all three apps: `Metalworker_admin`, `Metalworker_desktop`, `MetalWorkerApp` —
security / audit hardening.
**Pass 3** (current) = `Metalworker_admin` + `Metalworker_desktop` — the additive Bills
feature (tax-invoice workbooks → parse → 3 PDFs → records → folders).

Status: **All fixes applied, uncommitted** on `main`. Nothing has been committed; the user commits.

---

# PASS 3 — Bills: tax-invoice workbooks (xlsx → parse → 3 PDFs → records → folders)

Scope: an **additive** Bills feature. `Metalworker_admin` and `Metalworker_desktop` only,
plus two migrations and one edge function. `MetalWorkerApp`, the worker/processor/dispatch/
labour-job/with-material logic, Group Drawings, and existing Group Bills are **untouched**.

Design: the whole `xlsx → parse → PDF` half runs **server-side** in the
`process-bill-upload` edge function, so mobile and browser produce byte-identical
output and no service-role key ever reaches a client.

---

## P3.1 Verification results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` — Metalworker_admin | ✅ 0 errors |
| `npx tsc -b` — Metalworker_desktop | ✅ 0 errors |
| `npx tsc -p tsconfig.edge.json` — edge function (Deno-free typecheck) | ✅ 0 errors |
| `npm run lint` — Metalworker_admin | ✅ 0 problems across all 79 source files (was 0 at HEAD) |
| `npm run lint` — Metalworker_desktop | ⚠️ 53 problems (49 errors / 4 warnings) — **byte-identical to the pre-change baseline**, proven again with `git stash`. The new `src/services/bills.ts`, `src/types/bill.ts`, `src/pages/Bills.tsx` and `src/components/bills/*` contribute **zero** problems. |
| `npm run build` — Metalworker_desktop | ✅ 2306 modules, `index-*.js` 1,194.97 kB (gzip 343.34 kB); only the pre-existing >500 kB advisory |
| `npx expo export --platform web` — Metalworker_admin | ✅ 16 static routes, including a new `/bills` (21 KB) |
| `npm run bills:selftest` (parse + PDF structure + layout audit, SAMPLE.xlsx) | ✅ all checks pass, all three PDFs "no problems found" |
| `MetalWorkerApp` | ✅ untouched — no file in it is modified |

### Acceptance figures, from SAMPLE.xlsx

| | 274 | 292 | Folder (both) |
| --- | --- | --- | --- |
| Quantity | 1 | 2 | 3 |
| Amount before tax | 13,250.00 | 35,837.00 | 49,087.00 |
| CGST | 1,192.50 | 3,225.33 | 4,417.83 |
| SGST | 1,192.50 | 3,225.33 | 4,417.83 |
| Total GST | 2,385.00 | 6,450.66 | 8,835.66 |
| Amount after tax | 15,635.00 | 42,288.00 | 57,923.00 |
| Round off | 0.00 | 0.34 | 0.34 |
| Average bill value | — | — | 28,961.50 |
| Average quantity | — | — | 1.5 |
| Average before tax | — | — | 24,543.50 |

Copy spans derived dynamically: sheet `274 L` → original 1-48, duplicate 49-96, triplicate
97-144. Sheet `292` → 1-50, 51-100, 101-149. Invoice numbers `SEW/274/2026-27` and
`SEW/292/2026-27`, resolved to `Service Order No.:` and `Purchase Order No.:` respectively
— the label in the sheet, not a hardcoded column.

---

## P3.2 Data model (migration `0005_bills.sql`)

Relational, three tables, no JSON blob:

- **`bill_uploads`** — one row per uploaded `.xlsx`. Holds the original filename, the
  sanitized base name, the three bucket-relative PDF paths, the byte size, the detected
  bill count, and the status/error the pipeline left behind.
- **`bills`** — **one row per worksheet / invoice.** `unique (bill_upload_id, sheet_name)`
  so a re-processed sheet cannot silently duplicate. Carries the invoice number and date,
  both parties, the order reference, the tax identity numbers, and every total as its own
  numeric column (so they can be summed in SQL, which a JSON blob could not be).
- **`bill_line_items`** — one row per line item, `unique (bill_id, sr_no)`. Own columns for
  description, HSN, UOM, quantity, rate and amount.

**The three copies are not rows.** `original` / `duplicate` / `triplicate` are three PDF
renderings of one invoice. Storing them as three records would triple every folder total,
so the copy is an attribute of the *document*, not of the bill.

### `folder_items.item_type` — CHECK dropped, deliberately not re-added

Migration 0005 drops any CHECK on `folder_items.item_type` and does **not** put one back.
The column is shared with `MetalWorkerApp`, which this pass must not modify, so a new
constraint here would be a contract change enforced for a client that was not consulted.
The allowed set is the app layer's contract; the DB column stays a `text`. This is
recorded in-file in the migration.

### RLS and storage

- `bills_admin_all` — SELECT / UPDATE / DELETE for **active administrators only**,
  following the pattern established in migrations 0002-0004. **No client INSERT policy**:
  rows are written only by the edge function using the service role, so a compromised
  client token cannot fabricate a bill.
- Private bucket **`bills`** (50 MB cap, `application/pdf`), paths
  `bills/<upload-id>/<base>_original.pdf` etc. Only the bucket-relative name is stored in
  the DB; the client resolves a signed URL at read time, so no long-lived public URL
  exists.
- `bills_storage_admin_read` / `bills_storage_admin_delete` — `storage.objects` policies,
  same active-admin gate. This is why bill deletion needs no second edge function.

## P3.3 Edge function `process-bill-upload`

One request does the entire pipeline, so there is no partial state to reconcile:

```
POST { filename, content_base64 }
  → method + env + auth + ACTIVE-ADMIN check   (all before the body is parsed)
  → .xlsx extension, ZIP magic bytes, 50 MB / 64 MB size caps
  → INSERT bill_uploads (status = 'processing')
  → parseBills(sheets)                        throws BillFormatError → 422 unrecognized_format
  → render 3 PDFs (one document per copy)
  → storage upload ×3
  → INSERT bills + bill_line_items
  → UPDATE bill_uploads (status = 'completed', pdf paths, bill count)
  → best-effort admin_audit_log insert
```

Every failure path calls `rollback()`, which deletes the upload row and anything already
written to storage, so a rejected workbook leaves no orphan PDF and no half-populated bill.

**Zero runtime dependencies.** The `.xlsx` is a ZIP, so the reader is ~200 lines of
`DecompressionStream('deflate-raw')` + XML scanning (`_shared/xlsx.ts`) — not `npm:xlsx`.
The PDF writer is a hand-rolled deterministic writer using the Base14 fonts
(`_shared/pdf.ts`, `_shared/fontMetrics.ts`) — not a PDF library. This is what keeps the
function deployable to Deno with nothing to install and keeps output byte-identical
run to run.

**No row numbers, no column numbers.** Fields are found by their label, matched on a
"squashed" form (uppercased, non-alphanumerics removed), so `D E S C R I P T I O N`,
`Total Amount :GST` and `ADD:  CGST` all resolve. Copy labels use **exact** squashed
equality rather than substring, because row 8 of every sample sheet contains the note
`Original Copy of Invoice for Receipt ... Duplicate & Triplicate Supplier or Transporter`
— a substring match would read that note as the copy label and corrupt every span.
Cached formula results are read from `<v>` and never recomputed, so a workbook whose
recalculation is stale still produces the figures the accountant saw.

## P3.4 Folder integration

`item_type = "bill"`, added to the union in both apps' `types/folder.ts` and to every
`Record<FolderItemType, …>` that TypeScript then forced me to complete — which is how
`DragDropProvider`'s drag-ghost label got caught: it was labelling a parsed tax invoice
"Bill", colliding with the existing photo-group `bill_group`. `bill_group` is now "Bill
Group" and `bill` is "Bill", in both the filter chips and the badges.

Folder label is `Bill • SEW/274/2026-27 • ₹15,635`. The money formatter is imported from
`services/bills` rather than reimplemented, so a bill looks identical in the folder list
and on the Bills screen.

Removal only deletes the `folder_items` row. Deleting a bill from a folder never touches
the bill, its line items, or its PDFs.

### Folder bill summary (migration `0006_folder_bill_summary.sql`)

`get_folder_bill_summary(p_folder_id uuid)`, `SECURITY DEFINER`, `SET search_path = public`,
`REVOKE ALL FROM public` / `GRANT EXECUTE TO authenticated`, and the same active-admin
check the rest of the repo uses.

```sql
WITH unique_bills AS (SELECT DISTINCT … FROM bills JOIN folder_items …)
SELECT count(*), sum(…), …, coalesce(sum(…) / NULLIF(count(*), 0), 0)
```

The de-duplication lives in the CTE, so `count` and every `sum` are computed over the *same*
set — computing them over the raw join would count a bill once per folder link and once per
copy. `NULLIF(count, 0)` plus `coalesce` means a folder with no bills returns zeros, never
`NaN` or `Infinity`.

The panel is loaded in its **own effect** on both platforms, so if migration 0006 has not
been applied the RPC 404s and the folder page still works with one line of explanation.

## P3.5 Why some choices look unusual

- **Deleting a bill deletes the whole workbook.** The three PDFs and the invoice rows
  only exist and die together, so the confirmation names the file and says how many
  invoices go. A multi-selection spanning two workbooks is refused with a warning rather
  than guessing. *(Deliberate UX call — flagging it in case per-invoice deletion is wanted.)*
- **No `Intl` in the money/date formatters.** Hermes on Android ships a reduced ICU and
  silently falls back to `en-US` grouping, so `15635` would print `15,635` on web and
  `15635` on a device. `groupIndianInteger` / `formatMoney` / `formatQuantity` /
  `formatBillDate` are hand-written and deterministic, and duplicated in both clients
  because the two apps are separate npm projects that cannot share a module.
- **Upload progress steps 3-7 advance on a timer.** The function returns one JSON document,
  so the individual step boundaries are not observable. Steps 1-2 are real (`uploaded`,
  `validating`); the rest advance on a timer while the single request is in flight, every
  timer is cancelled, and the real response always decides the final state. Timed progress
  is honest here because the work genuinely is happening; the response is never faked.
- **Search resolves filenames through a second query.** `original_filename` lives on the
  joined `bill_uploads` parent, so a filename hit is resolved to `bill_upload_id`s and
  folded into the PostgREST `or(…)` group as an `in.(…)` clause. `,()%*` are stripped from
  user input so the group cannot be broken by a stray comma.

## P3.6 Self-test harness

`supabase/functions/_selftest/` (see its README) runs the parser, the PDF structure checks
and the layout auditor against a real workbook on plain Node, with no deploy and no PDF
library. `tsconfig.edge.json` typechecks the edge function on a machine with no Deno.
Neither is referenced by the app build or shipped to Supabase; the `out/` directory is
gitignored.

## P3.7 Pending deployments (BLOCKED — no `SUPABASE_ACCESS_TOKEN` on this machine)

```bash
supabase link --project-ref dwmirwmtyaucoosczdno
supabase db push                       # 0002, 0003, 0004, 0005, 0006
supabase functions deploy \
  delete-cloudinary-asset \
  get-admin-dispatches \
  update-worker-username \
  process-bill-upload
```

Until `0005` is applied there is no `bills` table, no bucket and no storage policy, so an
upload returns a clean database error rather than half-working. Until the edge function is
deployed, uploads return a clear "function not found".

## P3.8 Not verified here, and why

- **Visual PDF quality** was proven by the programmatic layout auditor (no clipping, no
  overlap, no footer collision, no mid-page hole, right-aligned money columns) and by the
  ASCII page map, not by eye. Open one in a viewer.
- **End-to-end upload** needs the deployed function and migrations.
- **Native iOS/Android** file picking, printing and sharing are unexercised; the web path
  is. The native code follows the existing Cloudinary dynamic-import pattern with explicit
  `Platform.OS` branches, but that is a code-shape argument, not a test.
- **Live DB state** was probed earlier: migrations 0002-0004 unapplied, no storage buckets
  at all, `admin_audit_log` absent, `bills`/`bill_uploads`/`bill_line_items` absent,
  `folder_items.item_type` in use = `drawing_group`, `job`.

---

## P3.9 Live browser test — three real bugs found and fixed

The Bills section was verified against the **deployed** backend with a real admin
session and the real `SAMPLE.xlsx`, not just compiled. Uploading a workbook and
watching the actual pipeline run surfaced three defects, all of them frontend, all
of them silent. `MetalWorkerApp` and Supabase were not touched.

### Bug 1 — "Upload workbook" did nothing (reported)

`Metalworker_desktop/src/components/bills/BillUploadPanel.tsx`

The `<input type="file">` lives inside `{!fileName && (…)}`, so it is **unmounted**
the moment a file is chosen. `start()` then read the file back off that input:

```ts
const file = inputRef.current?.files?.[0];
if (!file || busy) return;      // always returns, with no error
```

`inputRef.current` was null, so the guard returned and the button appeared dead.

**Fix**: the selected `File` is now held in state (`useState<File | null>`); name and
size are *derived* from it so the three cannot disagree; `start()` reads the state;
`reset()` clears it; and a missing file is an explicit `setStage("failed")` plus
`setError("Choose a workbook to upload first.")` rather than a silent no-op. The
upload no longer depends on a DOM node still existing. The admin panel was never
affected — it already stored a `PickedBillWorkbook` descriptor in state.

### Bug 2 — every joined field was `undefined`

`BILL_WITH_UPLOAD` selects `*, bill_uploads!inner(original_filename, …_pdf_path, …)`.
PostgREST returns an embedded row **nested** under the relation name; it is *not*
merged onto the parent row. The service cast the response straight to `Bill` with
`as unknown as Bill[]`, which compiles and yields `undefined` for every joined field.

Live symptom: the WORKBOOK column was blank, the detail header read
`Sheet "274 L" · undefined`, the delete button was `Delete undefined`, and all three
copy buttons rendered **"The original copy is not available"** — no bill PDF could be
viewed, downloaded or printed at all.

**Fix**: the real row shape is now a named type (`BillRowWithUpload`) and
`flattenBill()` lifts the embedded upload onto the row, renaming `status` to
`upload_status` so it can never be read as a `bills` column. `created_at` is
deliberately left as the **bill's** own timestamp, not the upload's. The cast is gone,
so the shape mismatch is now a compile error rather than a blank column.

### Bug 3 — the folder Bill summary never rendered

`get_folder_bill_summary` is declared `RETURNS TABLE`, so PostgREST answers with a
**set**: an array of one row. The service spread the array, which produces `{0: {…}}`,
so every figure fell through to the `EMPTY` default, `total_bills` stayed `0`, and
the `total_bills > 0` guard hid the panel — with no error, because nothing failed.

A second mismatch hid behind the same cast: the RPC's column names
(`amount_before_tax`, `cgst`, `avg_bill_value`) do not match `FolderBillSummary`'s
(`total_amount_before_tax`, `total_cgst`, `average_bill_value`), so even a correct
row would have rendered twelve zeros.

**Fix**: the result is unwrapped (`Array.isArray(data) ? data[0] : data`) and the
RPC-to-type translation is written out explicitly through `toFiniteNumber`, so the
two sides cannot drift into a silent zero again. **No migration change was needed** —
the deployed function is correct and is left alone.

### Verified live, against the deployed backend

| Check | Result |
| --- | --- |
| `POST …/functions/v1/process-bill-upload` | HTTP 200, 37,198-byte body, `ok: true`, `invoice_count: 2` |
| All seven steps, in order | Reading file -> Uploading workbook -> Validating workbook -> Reading invoices -> Generating PDFs -> Uploading PDFs -> Saving bill records -> 2 bills created |
| Returned PDFs | `SAMPLE_original.pdf`, `SAMPLE_duplicate.pdf`, `SAMPLE_triplicate.pdf` |
| Stored PDF fetched via signed URL | 200 `application/pdf`, 17,753 bytes, byte-identical to the self-test output; valid `%PDF-1.4` / `%%EOF`, 2 pages, both invoice numbers, both totals, labelled ORIGINAL |
| `bills` rows | 274 L: 13,250.00 / 1,192.50 / 2,385.00 / 15,635.00 — 292: 35,837.00 / 3,225.33 / 6,450.66 / 42,288.00, round off 0.34 |
| `.csv` rejected | "is not an Excel workbook", upload button disabled |
| `reset()` (X) | picker returns, input remounts empty, no stale file |
| Add 2 bills to a folder | folder item count 0 -> 2; labels `SEW/292/2026-27 • ₹42,288` and `SEW/274/2026-27 • ₹15,635`; badged **Bill**, distinct from the existing **Bill Group** |
| `get_folder_bill_summary` via the app | 2 bills, 3, ₹49,087.00, ₹4,417.83, ₹4,417.83, ₹0.00, ₹8,835.66, ₹0.34, **₹57,923.00**, ₹28,961.50, 1.5, ₹24,543.50 — every acceptance figure |
| Active-admin gate on the RPC | anon key rejected with `P0001 not_authenticated`; a function that does not exist returns `PGRST202`. The RPC exists and refuses non-admins. |
| Re-verification after the fixes | admin `tsc` + `eslint` (0 problems) + `expo export` (`/bills` 21 KB) + `lint:edge`; desktop `tsc -b` + `lint` (53 = baseline, zero in bill files) + `build`; `npm run bills:selftest` all pass |

**Test data left in the live project**: 1 workbook (`SAMPLE.xlsx`, 3 PDFs), 2 bills, and
2 links in the pre-existing folder named `test`. Delete it from the Bills screen
("Delete workbook") when you no longer want it — that removes the folder links, the
bill rows, the line items, all three PDFs and the upload row.

## P3.10 Job classification display — `job_kind` was parsed and stored, never shown

`bills.job_kind` has existed since 0005 and `parseBills` has filled it since the
first version, but nothing ever rendered it. Worse, the one place that did show it
— the bill detail grid — printed the **raw stored token**, so an invoice
classified `WITHMETAL` displayed `WITHMETAL` to the operator.

This is a display-only fix. No new column, no new parser field, no change to the
data model, no migration, and the classification is never inferred from the
invoice number, sheet name, amount or description.

### One normalizer, three copies, on purpose

`formatJobKind(jobKind)` maps the stored token to a display label:

| stored | shown |
| --- | --- |
| `LABOUR JOB`, `LABOUR`, `labour job` | `LABOUR JOB` |
| `WITHMETAL`, `WITH METAL`, `with_material` | `WITH METAL` |
| anything else non-empty | cleaned and title-cased, never discarded |
| null / empty | `null`, so the caller renders nothing |

Matching is on a "squashed" key — uppercase, alphanumerics only — so case, spaces,
hyphens and underscores cannot change the answer. That is the same trick the field
parser uses for labels.

It lives in three places because there are three compilation targets that cannot
import each other:

- `Metalworker_admin/supabase/functions/process-bill-upload/_shared/formatJobKind.ts` — for the PDF
- `Metalworker_desktop/src/services/bills.ts` — for the browser app
- `Metalworker_admin/src/services/bills.ts` — for the Expo app

The two client copies are byte-identical, which is the same trade the money and
date formatters already make in this repo (the apps are separate npm projects).

`null` matters as much as the mapping: an invoice that declared no job type must
show nothing, because defaulting to `LABOUR JOB` would be a fabricated financial
classification.

### PDF

Drawn **inside** the existing boxed `TAX INVOICE` heading, left-aligned, as a thin
outlined badge. That placement is deliberate:

- it is the first thing an operator's eye lands on when picking a page out of a
  stack, which is what the classification is for;
- drawing it inside the existing box means the box, its border, every gap below it
  and the whole rest of the page keep their exact previous geometry — nothing
  reflows, no spacing changed, and the page count and totals positions are
  untouched;
- the centred `TAX INVOICE` is ~103pt wide in a 535pt box and the badge is measured
  with `measureText`, so the two cannot collide at any heading size;
- when `job_kind` is null nothing is drawn at all.

The three print copies are unaffected: this is per-page metadata inside one
rendered document, not another financial record, and it appears once per invoice,
in all three copies.

### UIs

| Surface | Change |
| --- | --- |
| Desktop list | small pill under the invoice number, beside the party name |
| Desktop detail | normalized in the existing `Job type` field (was raw), and appended to the header subtitle |
| Desktop folder | second line under the unchanged label |
| Admin list card | pill under the invoice number |
| Admin detail modal | normalized `Job type` field, and appended to the sheet title |
| Admin folder | second line under the unchanged label |

The folder label was **not** changed. `FolderItemDisplay` gained an optional
`subtitle`, so search, `aria-label`s, toasts and dialog headings are all byte-for-byte
what they were — the classification is shown *alongside* the name, never merged
into it.

### Verified

`npm run bills:selftest` — parse, PDF structure, **new** job-kind check, layout
audit: all pass. The new `test-jobkind.ts` asserts, per page and per PDF, that the
display label is present, that it sits on the page belonging to its own invoice, and
that the literal token `WITHMETAL` appears nowhere in any of the three files.

`audit.ts` — no problems. One extra text run and one extra box per page; right
edges, rule count, body end (`y=570.0` and `y=588.0`) and internal gaps all
identical to before the change, which is the evidence that nothing reflowed.

Rendered and inspected page by page: page 1 `SEW/274/2026-27` carries a `LABOUR
JOB` badge, page 2 `SEW/292/2026-27` carries `WITH METAL`, both inside the heading
box, no overlap, no clipping, table/totals/words/bank/signatures/footer and the
`ORIGINAL` marker unchanged, and page 2 still resolves its own `Purchase Order No`
row.

Browser admin and Expo web admin both confirmed live against the deployed backend:
the desktop list, the desktop detail header, the desktop folder, the admin card, the
admin detail header and the admin folder all show `LABOUR JOB` / `WITH METAL`, and
the string `WITHMETAL` appears on no screen.

Admin `tsc` + `eslint` + `expo export` + `lint:edge` clean; desktop `tsc -b` +
`lint` (53 = baseline, zero in bill files) + `build` clean. `MetalWorkerApp` untouched.

## P3.11 PDF layout corrected against the production workbook

`BILL 301 TO.xlsx` (20 invoices, 301-320 plus 311L-318L) is the production
invoice format and is now the layout reference. All 20 sheets parse with none
skipped, and the workbook supplies both job classifications for real: `WITHMETAL`
on 301-310, 319, 320 and `LABOUR JOB` on 311L-318L.

This pass is renderer and parser only. No migration, no column, no RLS, no upload
or storage change, no folder change, and `MetalWorkerApp` untouched.

### What the reference workbook revealed

Sheet `301`, ORIGINAL copy, is a **fixed** reference block of five labelled rows,
each with its own `Date:` cell:

| row | label | value | Date |
| --- | --- | --- | --- |
| 9 | `INVOICE NO.:` | `SEW/301/2026-27` | 23/09/2026 |
| 10 | `Our Challan No.:` | `SEW/301/2026-27` | 23/09/2026 |
| 11 | `Your Challan No.:` | **blank** | **blank** |
| 12 | `Purchase Order No.:` | `WT/PO/TRM/600317` | 22/09/2026 |
| 13 | `Eway Bill No.:` | **blank** | **blank** |

The old renderer built that grid from the values it happened to have, so
`Your Challan No.`, `Your Challan Date`, `Eway Bill No.` and their dates were
pushed conditionally and simply vanished on every sheet of this workbook. The
invoice on the page was shorter than the invoice in the workbook.

### Fix 1 — the reference block follows the source, not the data

`parseBills` now records the block as `referenceRows: ReferenceRow[]`, in source
row order, with `value` and `date` nullable and a `hasDateCell` flag. The row and
its value are separate facts, which is the only way to tell "the template has no
such field" from "this invoice left it blank" — and only the second is true.

`referenceGrid()` in the renderer walks that list and emits a row per label plus
a date row per `Date:` cell, **always**. A blank value draws nothing
(`page.text` skips an empty string) so the cell keeps its border and its space
and reads as an empty field. The label column is measured from the longest label
so `Purchase Order No.` cannot run into the value column.

`ewayBillDate` is parsed for the e-way row. It is display-only and deliberately
has no column: the PDF is rendered from the same parse in the same request.

The parser's own reference row is only a floor for a sheet whose block could not
be read at all. It never filters a row out.

### Fix 2 — a line-item cell with no value is a blank cell

`orDash` is gone. `money`/`qty` still print `-` because the template writes a
literal `-` on the IGST row and the totals must mirror it, but the item table now
uses `cellMoney`/`cellQty`, which return `""`. All seven columns are drawn on
every row regardless: SR.NO., DESCRIPTION, HSN CODE, UOM, QTY, RATE, AMOUNT.

The reverse-charge totals row is likewise unconditional. On this workbook it is
`GST Payable on reverse` with no figure, so it now prints the label with an empty
value cell instead of not printing at all.

### Fix 3 — type scale, and no column can be cut off

A named `T` scale replaced scattered 7-7.5pt literals: seller 12.5/8.6, heading
16.5, badge 9.5, metadata 8.6/9, table 8.4, totals 9/9.4 with the grand total at
10, words 9, bank and terms 8.4, signatures 8.4, footer 7.5.

Column widths are derived from the usable A4 width rather than chosen, with
`COL_AMT` absorbing the remainder, so the table always ends exactly on the right
margin. `DESCRIPTION` gave up 15pt to `HSN CODE` and the numeric columns, because
it is the only free-text column. Each column heading is drawn at a size that fits
**its own** column rather than at one global size, so `DESCRIPTION` is never
cramped and `UOM` is never clipped. Long descriptions wrap and grow the row.

Continuation rows were already correct in the parser — a row with no SR.NO. is
appended to the previous description — and are now confirmed against this
workbook, where e.g. sheet 320 merges `MAIN ROLLER HARD FOR RIGHT ANGLE MACHINE
DIA` + `152 X 50MM [3017288 - 29586 AND 29587]` into one 83-character item, and
sheet 310 carries a 139-character description.

### Fix 4 — a latent page-break bug that made the new sizes unusable

`renderTable` (and every other block) began with `const { page } = sheet`. But
`Sheet.reserve()` can call `newPage()`, which **replaces** `sheet.page`. So after
a break the block kept drawing on the *previous* page at coordinates that had
restarted from the top margin — the repeated table header landed on top of the
seller block, and the real new page received only whatever came after. This was
already wrong before the type change; the larger fonts simply made it happen on
every multi-item invoice.

The page is now read from the sheet at each draw site. The final footer pass is
the one deliberate exception, because it iterates all pages and must stamp each
one.

### Fix 5 — pagination that does not orphan half an invoice

The table broke against a fixed guess at the space needed below it, so a bill
overflowing by one or two rows pushed those rows onto a fresh page and left the
totals, words, bank block, terms, certification note and signatures behind. The
auditor caught it as 107-330pt holes.

`trailingHeight(bill)` now measures everything below the table, and the table
breaks against `CONTENT_BOTTOM - trailing`. Each measure function is the single
source of truth for its block: the renderer places the block with the same number
the reservation used, so the two cannot drift.

Result on `BILL 301 TO.xlsx`: 23 pages for 20 invoices. 305, 306 and 310 have 7,
8 and 10 line items and legitimately span two sheets at a readable font, which
the requirements explicitly allow. The auditor reports **no problems** — no
overlap, nothing off the page, no orphaned page, no mid-page hole.

### Tests

Two new self-tests, both driven by the source rather than by hardcoded lists:

- `test-pdf.ts` reworked. A bill may span two pages, so pages are attributed
  through the footer instead of assuming page N is bill N; it asserts every page
  belongs to an invoice, pages run in worksheet order without interleaving, and
  no bill lost its invoice number, total or quantity across its whole span. It
  also accepts both Indian and Western digit grouping, because `3,99,991.00` and
  `399,991.00` are the same number and the test should not care which was used.
- `test-structure.ts` new. The blank-value requirement as an assertion: every
  reference row the source declared is still drawn, rows with a blank value keep
  their label, all seven columns are on every table, no text starts outside the
  printable width, and no empty cell was given a dash the workbook did not
  contain.
- `test-jobkind.ts` reworked to work off any workbook and to report which sheets
  are which kind.

`npm run bills:selftest` runs parse, PDF structure, job kind, structure and the
layout audit. All five pass on **both** `SAMPLE.xlsx` and `BILL 301 TO.xlsx`.

### Verified by reading the rendered output

Page 1 (`SEW/301`, WITHMETAL) shows the `WITH METAL` badge inside the heading box;
the reference grid with all six source rows including blank `Your Challan No.`,
`Your Challan Date`, `Eway Bill No.` and `Eway Bill Date`; the two-item table with
HSN `82073000`, UOM `NOS` and both continuation rows wrapped onto their own
items; `Total Amount After Tax 77,290.00` boxed; `GST Payable on Reverse Charge`
present with an empty value; and amount in words, bank details and terms below.
Across the document, pages 1-13, 22, 23 carry `WITH METAL` and pages 14-21 carry
`LABOUR JOB`, matching the workbook sheet for sheet.

### Checks

Admin `tsc` 0, `eslint` 0, `expo export` ok, `lint:edge` 0. Desktop `tsc -b` 0,
`lint` 53 = the pre-existing baseline with zero problems in any bill file,
`build` ok. `MetalWorkerApp` untouched.

### Not done here

Screenshots of the rendered pages were not captured: the browser reported
"needs a visible tab" for the whole of this session's PDF viewing. The inspection
above is from the auditor's geometric map, which reconstructs each page from the
real content stream using the real glyph metrics — it is a faithful rendering of
the same data, but it is not a photograph. Open
`Metalworker_admin/supabase/functions/_selftest/out/BILL 301 TO_original.pdf`
to look at it directly.
# PASS 2 — Cross-app production hardening

Scope: security, audit security, folder system, Cloudinary cleanup, multi-step delete
integrity, folder reorder integrity, cross-app consistency, desktop scalability, mobile review.

No UI redesign, no new features, and **no login-flow changes** (no real security bug was
found in authentication itself).

## P2.1 Verification results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` — Metalworker_admin | ✅ 0 errors |
| `npx tsc --noEmit` — Metalworker_desktop | ✅ 0 errors |
| `npx tsc --noEmit` — MetalWorkerApp (mobile) | ✅ 0 errors |
| `npx tsc -p supabase/functions/tsconfig.json --noEmit` | ✅ 0 errors |
| `npm run lint` — Metalworker_admin | ✅ 0 problems (exit 0) |
| `npm run lint` — Metalworker_desktop | ⚠️ 53 problems (49 errors / 4 warnings) — **byte-identical to the pre-change baseline** (verified by `git stash` + re-lint). **Zero new lint problems introduced.** Pre-existing debt is `react-hooks/set-state-in-effect`, `react-refresh/only-export-components` and `no-explicit-any` in files this pass did not need to change. |
| `npm run build` — Metalworker_desktop (`tsc -b && vite build`) | ✅ 2299 modules, built in 871ms |
| `npx expo export --platform web` — Metalworker_admin | ✅ 15 static routes exported |
| `@ts-nocheck` / `@ts-ignore` in edge functions | ✅ none |
| `@react-navigation/*` imports in app code (SDK 56+ removal) | ✅ none — all routing goes through `expo-router` |
| Raw `window.alert` / `window.confirm` in admin app | ✅ none outside `src/utils/notify.ts` (which is the shared web error-notification fallback) |
| Expo SDK 57 docs | ✅ checked `expo-router` v57 API surface; all used hooks (`useFocusEffect`, `useLocalSearchParams`, `useRouter`) and `ImperativeRouter` methods (`replace`, `dismissAll`, `push`, `back`) unchanged |

### Live smoke test (real admin login, real data — `npx expo start --web --port 8081`)

| Flow | Result |
| --- | --- |
| Unauthenticated `/folders` | ✅ redirected to `/login` |
| Real admin sign-in (Dibesh) | ✅ lands on `/dashboard`, live counts (123 labour / 139 material jobs, 5 folders, 1 owner + 1 company stock, 2 bill + 2 drawing groups) |
| Jobs as folder items (P2.7 fix) | ✅ 268 available items incl. 260+ `JOB` badges labelled `Job <job_no>`; `Job` filter chip present; 139 job items render correctly inside `test-again` |
| Folder reorder (P2.6) | ✅ moving an item up/down swapped the rows **and persisted**; the `reorder_folder_items` RPC was called first and fell back cleanly when it 404'd (confirmed in the network log) |
| Folder item remove (P2.8) | ✅ `ConfirmDialog` appears; **Cancel** leaves the count untouched; **Remove** drops 2→1 items and 266→267 available, returning the item to the available list |
| Item preview (P2.10 fix) | ✅ drawing group loads `Group Name`/`Group Date`/`Total Photos: 2`/`PHOTO #1`/`PHOTO #2`; job loads `Job No.`/`Type`/`Tool Description`/`PO Status`/`Drawing Status`/`Created` — previously stuck on "Loading details..." for all types |

### Live backend probe (Node + `@supabase/supabase-js`, real admin session)

| Probe | Result |
| --- | --- |
| `admin_audit_log` table | ❌ **missing** → migration 0003 unapplied (expected; see P2.13) |
| `set_primary_drawing` RPC | ❌ **missing** → migration 0002 unapplied (expected) |
| `reorder_folder_items` RPC | ❌ **missing** → migration 0004 unapplied (expected) |
| `delete-cloudinary-asset` (anon / authed) | ❌ 404 → not deployed (expected) |
| `update-worker-username` | ❌ 404 → **was already undeployed before this pass** |
| `get-admin-dispatches` anon | ✅ 401 `UNAUTHORIZED_NO_AUTH_HEADER` |
| `get-admin-dispatches` bad action (authed admin) | ✅ 400 `"Invalid action."` — the whitelist rejects instead of silently defaulting to `list` |
| `get-admin-dispatches` list (authed admin) | ✅ 200 `ok: true`. **Response contract is safe:** deployed returns `{ok, data}`, this pass returns `{ok, data, total}` — a superset, so clients reading `.data` are unaffected. Note the *deployed* build is older than this rewrite (it returns the short `"Invalid action."` message), so deploying is required for the new authz/delete-cleanup behaviour. |
| Audit insert while table missing | ✅ attempted and failed **silently without breaking the surrounding mutation** — confirms the best-effort contract holds when 0003 is not yet applied |

## P2.2 Security fixes

### `set_primary_drawing` RPC (migration 0002) — was SECURITY DEFINER with no authz
The function is `SECURITY DEFINER`, so it runs with the table owner's rights and
**bypasses RLS**. It previously accepted any authenticated caller. It now verifies the
caller is an **active admin** (`auth.uid()` + an `is_active = true AND role = 'admin'`
row in `profiles`) and raises `not_authenticated` / `admin_required` **before any write**.
The migration is `CREATE OR REPLACE`, so it stays re-runnable.

### `admin_audit_log` INSERT policy (migration 0003) — was forgeable
The old policy allowed any `authenticated` role to insert a row with **any** `actor_id`,
so a worker or processor could forge audit events naming another user. The policy is now
`audit_log_admin_insert`: `actor_id = auth.uid()` **and** an active-admin `profiles` row
must exist. `anon` is denied outright, and authenticated `SELECT` is **denied** (audit
rows are service-role-read only). `audit_log_authenticated_insert` is explicitly dropped.
Migration is re-runnable (`DROP POLICY IF EXISTS` + `CREATE POLICY`).

### `folder-detail.tsx` — bypassed the admin gate
The screen ran its own `supabase.auth.getSession()` check, which only proves *a* session
exists. A worker/processor session (or an inactive admin) could render the screen and fire
its folder queries before RLS rejected them. It now uses the shared `useAdminGate` like
every other protected screen, and `FolderContents` is not mounted at all while the gate
is still checking.

### Edge function authz consistency
All functions now perform **method → env → auth → admin check → body parse**, and share
identical messages: `"Not authenticated."` / `"Admin profile not found."` /
`"Admin access only."` / `"Your admin account is inactive."` (previously these were
inconsistent and one path used a vague `"Unable to verify admin access."`).
`get-admin-dispatches` reads the profile with `.single()` so a duplicate-row condition
cannot silently resolve to the first admin.

## P2.3 Audit log

- **Desktop gained a real audit trail.** New `Metalworker_desktop/src/services/auditLog.ts`
  replicates the admin helper's contract exactly: fire-and-forget (`void logAudit(...)`),
  never throws, never blocks a mutation, `console.warn` when the table is missing.
  Wired into job/stock/group/folder/user/username mutations and folder reorder.
- **Audit failures can never break a mutation** — every call site is `void`-prefixed and
  the helper wraps its whole body in `try/catch`.
- **Audit writes are not forgeable** by workers/processors (see P2.2, policy tightened).
- `delete-worker`'s `warning` field (an orphaned `profiles` row after the auth user is
  gone) was previously dropped on the floor. It is now surfaced in both apps: admin
  `dashboard.tsx` shows an error flash, desktop `UsersPage.tsx` shows an error toast.

## P2.4 Cloudinary cleanup — no more orphaned assets

Previously, deleting a job / group / stock record removed the DB row and left the
Cloudinary upload in place forever, with no record of which asset it was. Every delete
path now:

1. **Reads `photo_public_id` / `public_id` BEFORE deleting the row** (once the row is
   gone the id is unrecoverable),
2. Deletes the rows and surfaces each step's error,
3. **Only then** calls the destroy — best-effort, server-side, never able to fail the delete.

The Cloudinary Admin API secret is never in a client. Deletion goes through a new edge
function `delete-cloudinary-asset` (env-only credentials, `public_id` charset/length
validation, same admin authz, returns `asset_intact: true` + 502 if the destroy fails).
Client helpers: admin `src/services/cloudinary.ts → destroyCloudinaryAsset()`, desktop
`src/services/cloudinaryCleanup.ts` (same contract).

`get-admin-dispatches` **delete** also now reads `photo_public_id` first, deletes the row,
then best-effort destroys the asset and writes a **service-role** audit row.

## P2.5 Multi-step delete integrity

Every multi-step delete previously discarded intermediate errors and could report success
while leaving orphaned rows. All now check each step and return an honest, specific error:

| Service | Was | Now |
| --- | --- | --- |
| desktop `folders.deleteFolder` | `folder_items` delete error **silently ignored** | checked; aborts with `Failed to remove folder items: …` |
| desktop `jobs.deleteJob` | `folder_items` delete error **discarded**; `job_drawings` never deleted | checked; drawings deleted before the job so they cannot orphan |
| admin `jobs.deleteJob` | job row deleted, drawings + folder links left behind | links → drawings → job, each checked |
| admin/desktop `ownerStock` / `companyStock` | folder links left behind | links removed (and checked) before the record |
| admin/desktop `billGroups` / `drawingGroups` | photo delete error ignored | checked, aborts the group delete |
| desktop `jobImport` | folder link failure only `console.warn` → import reported "completed" | recorded as a real `job_import_errors` row + `failed` row-result, forces status `partial`, UI shows an **error** toast |

## P2.6 Folder reorder integrity

- New migration **`0004_reorder_folder_items.sql`**: `reorder_folder_items(p_folder_id,
  p_item_ids)` — `SECURITY DEFINER` with an active-admin check, validates that every id
  belongs to the folder **and** that the list covers all of its items (`invalid_item_ids`),
  then assigns positions `0..n-1` in **one transaction**. `REVOKE public` / `GRANT authenticated`.
- Both apps call the RPC first. The previous `Promise.all` multi-update path is kept as a
  documented fallback (RPC not yet deployed) but now reports **k of n** positions that
  failed instead of only the first error, and is tagged `via: "fallback"` in the audit log.
- Admin `reorderFolderItems(folderId, items)` signature changed; both call sites updated.
- `setPrimaryDrawing` in the desktop app is now RPC-first too (it previously did the
  unconditional "clear all, then set one" pair, which could leave a job with **no** primary
  drawing and could mark a **foreign** drawing primary).

## P2.7 Jobs as folder items (cross-app consistency)

`FolderItemType` already included `"job"` in both apps and the desktop already rendered and
routed jobs, but:

- **Admin app**: `fetchAllItems`, `fetchAvailableItems` and `resolveFolderItemLabels` had
  **no `job` branch**, so jobs could be added to folders from the desktop and then showed
  as unlabelled/unknown in the admin app, and `ItemPreviewModal` rendered an **empty modal**
  for them. All four now handle `job` (`Job <job_no>`), including a dedicated
  `renderJob()` view.
- **Desktop app**: `ITEM_FILTERS` in `Folders.tsx` and `FolderDetail.tsx` omitted `"job"`,
  so job items were rendered but **not filterable**. Added to both.

## P2.8 Dialogs / messaging on web

`Alert.alert` is a **no-op on react-native-web** and `window.confirm` blocks the thread
with an unthemed dialog. Migrated to the shared `notify()` + `ConfirmDialog`:

- `FolderContents.tsx` — all 12 sites (single remove, bulk remove, add failures, both
  reorder paths) now use a single `ConfirmDialog` with a `pendingRemoval` intent record
  (`kind: "single" | "bulk"`), a `removalBusy` guard, and optimistic-update rollback preserved.
- `folders.tsx` (admin) — folder delete.
- `dashboard.tsx` (admin) — worker delete + logout failure.

## P2.9 Dead links

`Dashboard.tsx` and `Placeholder.tsx` both linked to `/import`, which matches no route
(the route is registered as `/jobs/import`). The "Import from Excel" card and link rendered
the Placeholder page. Both fixed.

## P2.10 Item preview modal never loaded (pre-existing bug, found by browser test)

**This one is not from this pass.** Tapping any item in a folder opened the preview modal
and left it stuck on **"Loading details..." forever** — for *every* item type, not just jobs.
The feature was completely non-functional on web.

Root cause: `ItemPreviewModal` triggered its fetch from
`useFocusEffect(useCallback(...))` imported from `expo-router`. That hook resolves the
route's navigation object and only runs the effect when `navigation.isFocused()`. It works
for the **route component itself** (which is why `FolderContents`' own data load was fine),
but it never fired for a child that mounts *later*, after the route is already focused. The
modal was also built for the wrong primitive: it is mounted conditionally
(`{previewItem && <ItemPreviewModal visible={!!previewItem} … />}`) at both call sites, so
mounting already means "open" and each open starts from fresh state — a route-focus refetch
is redundant.

Proof it was the trigger, not the fetches: with the modal open there was **no**
`select=*` request in the network log at all for `jobs`, `drawing_groups`, etc. —
`loadDetails` was never invoked, so the `finally` that clears `loading` never ran.
Re-navigating to the folder and reopening did not help.

Fix: replaced `useFocusEffect` with a mount effect on `[visible, loadDetails]`. Verified
live — a drawing group now renders `Group Name` / `Group Date` / `Total Photos: 2` /
`PHOTO #1` / `PHOTO #2`, and a job renders `Job No. 1019` / `Type` / `Tool Description` /
`PO Status` / `Drawing Status` / `Created`. This was also a prerequisite for the new `job`
case in P2.7, which would otherwise have shown an empty modal forever.

The `react-hooks/set-state-in-effect` rule flags an async fetch that only sets state after
an `await` (it cannot distinguish that from a synchronous setState). Suppressed with a
one-line `eslint-disable-next-line` plus a justification, matching the convention already
used in `DragDropProvider.tsx` and `DateTimeField.tsx`.

## P2.11 Intentionally unchanged (documented, not "fixed")

- **Desktop `JobsPage` / `Dispatches` client-side filtering, bulk select and date grouping.**
  Converting these to server-side pagination is a page redesign, not a hardening fix, and
  the user asked for no redesign. Left as a documented scalability limitation.
- **Mobile app: review only, no code changes.** Real findings are in P2.12.
- **`fetchFolders` item counts** load all folder_items to count — left alone for the same
  reason (it is a counting path, not a correctness bug).

## P2.12 Mobile review findings (documented only, no code changes)

`MetalWorkerApp` type-checks clean and was reviewed, not modified. Real findings:

1. **Session in `AsyncStorage`** — the session is persisted in plain `AsyncStorage`. On a
   rooted/jailbroken device or via a backup extract, that is a bearer-token-at-rest
   exposure. `expo-secure-store` is the correct store. Highest-value mobile fix.
2. **Username-only authentication** — authorization decisions are made on a
   username string rather than a server-verified role, so a client-side role value is
   trusted. The server-side RLS is what actually protects data; the mobile app must not
   be treated as an enforcement point.
3. **Cloudinary orphan risk** — mobile photo deletes do not destroy the asset, so
   uploads leak storage. Same class of gap that was fixed in admin/desktop.
4. **No test runner** in the project, so there is no regression net for any of the above.

Deliberately **not** added: QR-code flows and an offline upload queue. Both are features,
not hardening, and were out of scope.

## P2.13 Pending deployments (BLOCKED — no access token)

Nothing below could be applied or deployed from this machine: there is no
`SUPABASE_ACCESS_TOKEN` and no linked Supabase project, so `supabase db push` and
`supabase functions deploy` cannot run. These are delivered as files and need the user:

```bash
# Migrations (required — the audit table and both RPCs do not exist in the DB yet)
supabase link --project-ref dwmirwmtyaucoosczdno
supabase db push

# Edge functions (two of these are required for the new cleanup paths)
supabase functions deploy delete-cloudinary-asset   # NEW — Cloudinary destroy
supabase functions deploy get-admin-dispatches      # rewritten authz + delete cleanup
supabase functions deploy update-worker-username    # was ALREADY undeployed (404) before this pass
```

**Behavioural impact until deployed** (all client code already falls back safely):

| Not deployed | What happens instead |
| --- | --- |
| migration 0003 (`admin_audit_log`) | `logAudit` writes are skipped with a `console.warn`; **no audit trail is recorded at all** |
| migration 0002 (`set_primary_drawing`) | both apps use the scoped two-step fallback (target set first, so a job can never end up with no primary) |
| migration 0004 (`reorder_folder_items`) | both apps use the k-of-n multi-update fallback, which **can** partially persist a reorder |
| `delete-cloudinary-asset` | `destroyCloudinaryAsset` warns and no-ops; deletes succeed but **Cloudinary assets leak** |
| `update-worker-username` | username edit returns 404 (pre-existing, not caused by this pass) |

Also note: `0003` is currently **unapplied in the live DB** (`admin_audit_log` was confirmed
missing), so the tightened INSERT policy protects nothing until `supabase db push` runs.

---

# PASS 1 — Metalworker_admin only

Scope: `Metalworker_admin` only (Expo SDK 57). `Metalworker_desktop` and `MetalWorkerApp` were not touched.

Status: **All fixes applied, uncommitted** on `main`. `npx tsc --noEmit` (app and edge functions)
and `npm run lint` both exit 0. Live-backend mutation suite passed (safe/reversible rows only).

---

## 1. Verification results (current)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (app) | ✅ 0 errors (exit 0) |
| `npx tsc -p supabase/functions/tsconfig.json --noEmit` | ✅ 0 errors (exit 0) |
| `npm run lint` (expo lint) | ✅ 0 problems (exit 0) — baseline was **27 errors + 11 warnings** |
| `npx expo start --web` | ✅ Bundles clean with React Compiler; all routes visited render; **0 console errors** on dashboard, jobs-labour, jobs-with-material, folders, stock ×2, group-bills, group-drawings, dispatch |
| Auth gate on web | ✅ Unauthenticated navigation to every route redirects to `/login`; `useAdminGate` now distinguishes `unauthenticated` / `unauthorized` / `transient` (no bounce on hiccups, only definitive outcomes sign out) |
| **Authenticated e2e smoke test** | ✅ Real admin login (Dibesh) → dashboard real counts (123 labour / 139 material jobs, 5 folders, 1 each stock, dispatch stats) → stat-card nav → all screens render live data; folder detail, job edit & drawing modals, dispatch details + edit form, group detail view, item preview exercised. No runtime errors. |
| **Real-backend mutation suite** (Node, safe/reversible rows, Sep 28 2026) | ✅ admin sign-in via `usernameToEmail`; worker-profile read; **UI-created user listed**; edge `create-user` (200, returns worker id); **anonymous `delete-worker` rejected (non-2xx)**; edge `delete-worker` cascade (auth + profile gone); folder create/rename/item-add/item-remove/delete; **duplicate `folder_items` insert blocked by DB unique index (already live)**; job create/update/delete; owner_stock create/delete; **`set_primary_drawing` RPC not deployed → two-step fallback verified (exactly one primary on a temp job)** |
| Edge-function deployment (live project) | ✅ `create-user`, `delete-worker`, `get-admin-dispatches` deployed; ⚠️ **`update-worker-username` NOT deployed (404)** — username edit fails in the app until it is deployed |
| Migrations | 0001 (`folder_items` unique index) — **constraint already live in DB**; 0002 (`set_primary_drawing`) 0003 (`admin_audit_log`) — **authored, NOT applied** (no `SUPABASE_ACCESS_TOKEN`/linked project locally); `logAudit` no-ops safely until 0003 runs |

Baseline lint state: the repo shipped with lint already failing (27 errors / 11 warnings),
mostly `react-hooks/set-state-in-effect`, `react-hooks/immutability` (Reanimated false
positives), and `react/no-unescaped-entities`. All are now resolved.

---

## 2. Functional fixes

### Auth / routing
- `src/app/dashboard.tsx`, `dispatch-details.tsx`, `dispatch.tsx`, `folders.tsx`,
  `jobs-labour.tsx`, `jobs-with-material.tsx` — use `useAdminGate` (session + active
  admin role) and redirect to `/login`; no auth bypass, no fake accounts.

### Dashboard (control center)
- Real backend stats via head-only exact-count queries in `src/services/counts.ts`
  (`fetchSystemCounts`); each StatCard navigates to its screen.
- Worker list has inline error + Retry; dispatch section has its own loading/error.
- Transient flash banner for mutation feedback; loaders re-run on screen focus
  (`useFocusEffect`).
- Removed unused `FlatList` import and dead `setTimeout` leftovers.

### Jobs (labour vs with-material separation preserved)
- `JobEditModal` and `JobDrawingModal` are now keyed by `${job.id}-${openSeq}`, so the
  form remounts per open instead of (a) carrying stale edits into the next open and
  (b) resetting state synchronously inside an effect. Closed-state keys are distinct
  (`"edit-none"` vs `"drawing-none"`) to avoid a React duplicate-key warning from the
  two sibling modals both defaulting to `"none"`.
- `JobEditModal`: all inputs carry accessible `label` + `nativeID` wiring; messages use
  the shared `notify()` util.
- `JobDrawingModal`: delete confirmation moved to the shared `ConfirmDialog` (works on
  web, where `Alert` is a no-op); messages use `notify()`.

### Dispatch
- `dispatch-details.tsx`: missing-id deep link shows the error view immediately
  (loading initialised from presence of the id); delete uses `ConfirmDialog`; all
  messages via `notify()`; error state has Retry + Go Back.
- Edge function `get-admin-dispatches`: update payload is built explicitly and
  `location_name` is only sent when present in the input.

### Folders
- `folders.tsx` (overview): auth gate, error banner + Retry, flash banner for
  add/drop success & failure, `23505` duplicate detection with user-friendly message,
  folder-item count query now checks its own error.
- `FolderContents.tsx` (folder detail): 
  - Inline **error state + Retry** replacing the previous misleading empty state
    when the load fails.
  - Loader moved to `useFocusEffect` (no synchronous setState in an effect).
  - Optimistic temp IDs use a monotonic ref counter instead of `Date.now()`.
  - Removed dead `containerY` ref and unused `removedItem` variable.
- `src/services/folders.ts`: `deleteFolder` now surfaces the `folder_items` delete
  error instead of silently continuing (no orphaned rows).

### Group bills / drawings & stock
- Forms are keyed (`${editingItem?.id ?? "new"}`) so they re-initialise per record.
- Photo-sync on save wraps multiple uploads; per-photo failures are counted and reported
  as **`k of n photo positions failed to save (firstError)`** — no silent drops, no bare
  failure claims. Callers refresh from the backend after both success and partial failure.
- `OwnerStockForm` rejects non-numeric / negative `amount_purchase`.
- `onRequestClose` added to all modals (`CreateFolderModal`, `RenameFolderModal`,
  `BillGroupForm`, `DrawingGroupForm`, `ItemPreviewModal`, `GroupPhotoPreviewModal`).
- `Input` gained a `required` prop (aria-required wiring removed — not in
  `TextInputProps`), `error` + `aria-invalid`, and a polite live region for errors.

### Stock / group screens (shared scaffold)
- `stock-owner.tsx`, `stock-company.tsx`, `group-bills.tsx`, `group-drawings.tsx`
  rewritten on a shared scaffold (`useAdminGate` + `notify`/`ConfirmDialog` +
  `useFocusLoader`) with a gate spinner, per-screen search `label` + `nativeID`,
  `hitSlop` back buttons, and action buttons ≥44px. No forced mega-component — each
  screen keeps its own shape where behavior differs.

### Drawings primary flag (data integrity)
- `src/services/jobDrawings.ts` `setPrimaryDrawing` now tries the `set_primary_drawing`
  RPC first (transactional) and falls back to a two-step scoped by `job_id` where the
  target is set first and other flags are cleared afterwards (`via: "rpc" | "fallback"`
  is recorded for audit). A partially failed second write can no longer leave the job
  with **no** primary drawing; the failure message states that the selected drawing is
  primary and cleanup failed. RPC is not deployed yet (migration 0002) — the fallback
  was verified live against a temp job.
- `JobDrawingModal.handleMakePrimary` now refreshes the list in a `finally` so the UI
  reflects actual state on both success and partial failure.

### Jobs: shared screen + server pagination
- Both job screens now use one `src/components/jobs/JobsScreen.tsx` (wrappers
  `jobs-labour.tsx` / `jobs-with-material.tsx` pass `jobType`). Server-side
  pagination (`PAGE_SIZE` 50) with load-more, 400ms debounced search (sanitises
  `[(),"%]`), and a request-id guard against out-of-order responses. `useFocusEffect`
  re-runs on `debouncedSearch` change, so there is no separate debounce effect.
- Job list renders in the dashboard via the same service; dead `fetchJobsByType`
  deleted.
- Fixed invalid `button`-inside-`button` DOM nesting on web: the job card `Pressable`
  no longer claims `accessibilityRole="button"` (it stays tappable/keyboard-focusable),
  so the DRG control is the only nested semantic button (RN-web renders
  `accessibilityRole="button"` as a real `<button>`).

### Dashboard split into components
- `src/components/dashboard/`: `styles.ts` (full stylesheet + shared `cardShadow`
  helper), `DashboardHeader`, `StatGrid`, `DispatchSection`, `WorkerSection`,
  `QuickActions`, `SectionHeader`, plus `index.ts` barrel. `dashboard.tsx` is a thin
  orchestrator — all state/handlers/memos/modals remain there; nothing about stats,
  filtering, or mutation behavior changed.
- `cardShadow` uses `Platform.select`: `boxShadow` on web, `shadow*` + `elevation`
  on native. Same pattern applied to `dispatch.tsx` list cards, the `DragDropProvider`
  drag ghost (8-digit-hex primary), and `FolderContents.tsx` sticky action bar. The
  RN-web `shadow*` deprecation warning is gone. `pointerEvents="none"` stays as a View
  prop (supported on RN-web; core API, not deprecated) and is documented in code.

### Auth gate (no fake accounts)
- `src/hooks/useAdminGate.ts` returns `status: "checking" | "ok" | "unauthenticated" |
  "unauthorized" | "transient"`. Login profile verification retries with backoff;
  only definitive outcomes sign out. `login.tsx` shows distinct messaging for
  unauthenticated vs unauthorized/inactive vs transient failures, so a valid admin is
  not bounced by a transient hiccup.

### Audit log (real backend support, no fake frontend)
- `src/services/auditLog.ts` (`logAudit`, best-effort, never blocks) writes
  **WHO / WHAT / WHEN / TARGET** to `admin_audit_log` (migration 0003): actor
  (active admin id + username), `action`, `target_type` / `target_id`, `detail`,
  `created_at`. Wired at the **service layer** — one call per mutation — across
  ownerStock, companyStock, jobs, dispatch, admin (create/update username/delete),
  jobDrawings (both primary paths), billGroups, drawingGroups, folders.
  Table not deployed yet → `logAudit` no-ops safely; deploy 0003 to activate.

### Edge functions (typed, validated, server-side authz)
- All four functions (`create-user`, `delete-worker`, `update-worker-username`,
  `get-admin-dispatches`) retyped, `@ts-nocheck` removed. `get-admin-dispatches`
  gained an action whitelist + UUID validation + optional bounded `limit`/`offset`;
  `create-user` returns the created `worker` object; `delete-worker` checks the
  profile cascade first, with compensating rollback where relevant. Functions
  tsconfig + `deno.d.ts`; app tsconfig excludes `supabase/functions`.
  ⚠️ `update-worker-username` is **not deployed** to the live project (404) —
  `supabase functions deploy update-worker-username` is required.

### Messaging utility
- `src/utils/notify.ts` + `src/components/ui/ConfirmDialog.tsx`: shared web/native
  messaging and confirm modal; `Alert` removed where it was a no-op on web.

---

## 3. Dead-code cleanup (deleted)

Files with zero consumers were removed rather than maintained:

- `fix_ts.js`, `refactor.js` (root repair scripts)
- `src/components/app-tabs.tsx`, `app-tabs.web.tsx`, `hint-row.tsx`, `themed-text.tsx`,
  `themed-view.tsx`, `web-badge.tsx`, `external-link.tsx`, `animated-icon.tsx`,
  `animated-icon.web.tsx`, `animated-icon.module.css`
- `src/services/jobImport.ts`, `src/services/jobImportParser.ts`, `src/types/jobImport.ts`
  — self-contained dead export/import parser; `xlsx` is not a dependency and there is
  no UI, so the Excel import feature was never reachable. Decision: delete. If Excel
  import is wanted later, it should be built as a real screen with its own parser.

---

## 4. Lint remediation notes

- `useEffect`-based loaders migrated to `useFocusEffect` (expo-router) on dashboard,
  dispatch-details, dispatch, folders, group-bills, group-drawings, jobs x2,
  stock-owner, stock-company, FolderContents, ItemPreviewModal, GroupPhotoPreviewModal,
  JobDrawingModal. This is the pattern the codebase already used on `dispatch.tsx`,
  and it removes the React Compiler `set-state-in-effect` flag while adding
  refresh-on-focus (a net UX improvement).
- Loader functions no longer set `loading = true` synchronously; `loading` starts
  `true` and is only cleared in `finally` (or after the first await).
- `DragDropProvider.tsx` / `DraggableItem.tsx`: file-level
  `eslint-disable react-hooks/immutability` with justification — shared-value `.value`
  writes inside `"worklet"` functions are Reanimated runtime operations that the
  React Compiler lint cannot model (documented false positive).
- Apostrophe literals in warning banners reworded (`Couldn't` → `Failed to`), removing
  `react/no-unescaped-entities`.
- `DateTimeField.tsx`: targeted disable for the third-party
  `import/no-named-as-default` quirk.

---

## 5. Remaining known items

- **Backend mutations verified live (Sep 28, 2026)** — user create (UI) + rename/deactivate/edit
  paths, user delete (edge fn, cascade), folder CRUD + folder-item add/remove + duplicate-guard
  (DB unique index live), job create/update/delete, owner_stock create/delete, set-primary
  fallback (exactly one primary). Still manual-only (would need destructive intent / real data
  or photos): drag-and-drop reorder, bulk item moves, dispatch create/edit submit, group/stock
  form submits, photo uploads/delete (Cloudinary).
- **`update-worker-username` edge function is not deployed** — the repo code is rewritten and
  type-checks, but the live project returns 404. Until deployed, the app's rename-username path
  surfaces a non-2xx error. Deploy with `supabase functions deploy update-worker-username`
  (needs `SUPABASE_ACCESS_TOKEN`).
- **Migrations 0002 / 0003 authored but not applied** (`supabase/migrations/0001_folder_items_unique.sql`,
  `0002_set_primary_drawing.sql`, `0003_admin_audit_log.sql`). 0001's unique index is **already
  live** in the DB. 0002 enables the transactional RPC (the client already falls back safely);
  0003 creates `admin_audit_log` (client `logAudit` no-ops until then). Apply via
  `supabase db push` or the SQL dashboard when a linked project/token is available. No CLI
  access token is present locally, so they were delivered as deployable SQL instead.
- **Cloudinary orphan cleanup gap** — ~~deleting a worker that uploaded photos removes the
  profile, and deleting jobs/groups removes DB rows, but associated Cloudinary assets are
  not purged.~~ **Resolved for admin + desktop in Pass 2** (see P2.4) via the
  `delete-cloudinary-asset` edge function. Still outstanding:
  (a) the **mobile** app does not purge assets (P2.12), and (b) the destroy is
  best-effort — a failed destroy leaves the asset in place, and because it is
  fire-and-forget there is no retry queue or orphan sweeper. The console warn is
  the only trace. Photo mutations were not run headlessly (manual-only).
- `props.pointerEvents` — kept as a View prop in `DragDropProvider.tsx` (RN core API,
  supported on RN-web; moving it into `style` breaks native hit-testing and core `ViewStyle`
  types). Documented in code; no RN-web deprecation warning is emitted for this prop.
- The `shadow*` → `boxShadow` deprecation warning is **resolved** on web via
  `Platform.select` (see §2 Dashboard); remaining `shadow*` props exist only inside
  `Platform.select` native branches.

---

## 6. Files changed (uncommitted)

- Modified: `src/app/*` (dashboard, dispatch, dispatch-details, folders, jobs-labour,
  jobs-with-material, stock-owner, stock-company, group-bills, group-drawings, index),
  `src/services/*` (ownerStock, companyStock, jobs, dispatch, admin, jobDrawings,
  billGroups, drawingGroups, folders, counts, auditLog, supabase), `src/hooks/*`
  (useAdminGate, useFocusLoader), `src/constants/theme.ts`,
  `src/context/ThemeContext.tsx`, `supabase/functions/*` (all four).
- Added: `src/components/ui/ConfirmDialog.tsx`, `src/components/jobs/JobsScreen.tsx`,
  `src/components/dashboard/` (7 extracted components + `styles.ts` + `index.ts`),
  `src/utils/notify.ts`, `src/hooks/useFocusLoader.ts`, `src/services/auditLog.ts`,
  `supabase/migrations/0001_folder_items_unique.sql`,
  `supabase/migrations/0002_set_primary_drawing.sql`,
  `supabase/migrations/0003_admin_audit_log.sql`,
  `supabase/functions/tsconfig.json`, `supabase/functions/deno.d.ts`.
- Deleted: 18 dead files (see §3).
- No commits were made. All changes are in the working tree only.