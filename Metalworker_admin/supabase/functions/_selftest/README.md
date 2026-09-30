# Bills self-test

Repeatable verification for the tax-invoice pipeline: `xlsx` → parse → three
PDFs. Nothing in here is imported by the edge function or shipped to Supabase —
these scripts exist so the parser and the PDF writer can be checked against a
real workbook without deploying anything.

They run on **Node**, not Deno, so they can be run from a normal checkout:

```bash
cd Metalworker_admin
node supabase/functions/_selftest/test-parse.ts                      # field dump + cross-copy agreement
node supabase/functions/_selftest/test-pdf.ts                        # 3 PDFs + structural checks, writes out/
node supabase/functions/_selftest/test-jobkind.ts                    # job classification on the right page
node supabase/functions/_selftest/test-structure.ts                  # empty fields keep their rows and columns
node supabase/functions/_selftest/audit.ts                           # layout audit of out/SAMPLE_original.pdf
node supabase/functions/_selftest/audit.ts "BILL 301 TO_original.pdf" # …or any other copy
node supabase/functions/_selftest/serve.ts 8123                      # open the PDFs in a browser
npx tsc -p tsconfig.edge.json                                        # typecheck the edge function
```

All the checking scripts accept a workbook path as their first argument; the
default is `<repo root>/SAMPLE.xlsx`. Two workbooks are checked in this repo:
`SAMPLE.xlsx` (2 invoices, the acceptance fixtures) and `BILL 301 TO.xlsx`
(20 production-format invoices, the layout reference).

`npm run bills:selftest` runs the five checking scripts in order.

## What each one proves

| Script | Answers |
| --- | --- |
| `test-parse.ts` | Did every sheet become a bill, with no sheet skipped? Are the three copy spans derived correctly, and do the duplicate/triplicate copies agree with the original on invoice number and total? Prints every derived field so the numbers can be read against the source workbook. |
| `test-pdf.ts` | Is the output **three** documents named `<base>_original/_duplicate/_triplicate.pdf`, with a valid header, trailer, `/Pages /Count`, a `startxref` that lands on the xref, every xref offset resolving to its own object, and one content stream per page? Does every page belong to an invoice, are the pages in worksheet order, and did every bill keep its invoice number, total and quantity? A bill may legitimately span two pages, so pages are attributed through the footer rather than assumed. |
| `test-jobkind.ts` | Is each page's job classification the *display* label (`LABOUR JOB`, `WITH METAL`) and not the raw stored token, and is it on the page belonging to its own invoice rather than swapped? Reports which sheets are which kind. |
| `test-structure.ts` | The requirement that empty must not mean absent. Every reference row the source declared is still drawn, rows whose value is blank still carry their label, all seven line-item columns are present on every table, no text starts outside the printable width, and no empty cell was given a dash the workbook did not contain. |
| `audit.ts` | Does the page *look* like an invoice? Content streams are uncompressed, so the script reads back every `Tm`/`Tj`/`re`/`l` operator and reconstructs the geometry. It then checks: nothing off the page, no overlapping text on a baseline, no body text in the footer band, right-aligned money columns sharing a right edge, no >90pt hole mid-page — and prints an ASCII map of the page with the y coordinate in points, which is how the layout is debugged. |
| `dump-page.ts` | Prints one page's text runs with their coordinates, for when the ASCII map is ambiguous about which page a mark belongs to. `node dump-page.ts "BILL 301 TO_original.pdf" 6` |
| `probe-format.ts` / `probe-fields.ts` | Read-only probes that dump a real workbook's structure: sheets, label rows, which labels carry a value, and how continuation rows are detected. Used to build the renderer against the real format rather than a guess. |
| `serve.ts` | Serves `out/` on a port so the PDFs can be opened and looked at. Nothing else. |

`test-pdf.ts` proves the files are well-formed; `audit.ts` proves the layout is
sane. Neither needs a PDF library, a headless browser, or a round trip through
a print driver.

## Requirements and caveats

- **Node 22.6+** (type stripping) — developed on 25.2.1. Run them as
  `node file.ts`, not through `ts-node`.
- The `MODULE_TYPELESS_PACKAGE_JSON` / `ExperimentalWarning` noise on stderr is
  expected and harmless.
- Under PowerShell, `node …` returning a non-zero `$LASTEXITCODE` with no output
  is a red herring: the harness reports a stderr artifact as a failure. Check the
  script's own `FAIL` lines and its final `… CHECKS:` verdict instead.
- `audit.ts` mirrors the Helvetica advance widths from
  `_shared/fontMetrics.ts`. **If those widths change, the auditor's overlap and
  right-edge checks become unreliable** — update the copy in `audit.ts` at the
  same time.

## The shim

`shims/supabase-js.d.ts` declares just enough of
`npm:@supabase/supabase-js@2` and of the `Deno` global for `tsc` to typecheck
the edge function on a machine without Deno. It is referenced by
`tsconfig.edge.json` and by nothing else. On a machine with Deno installed,
prefer `deno check supabase/functions/process-bill-upload/index.ts`.
