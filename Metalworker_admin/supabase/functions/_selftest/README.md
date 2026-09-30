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
node supabase/functions/_selftest/audit.ts                           # layout audit of out/SAMPLE_original.pdf
node supabase/functions/_selftest/audit.ts SAMPLE_duplicate.pdf      # …or any other copy
npx tsc -p tsconfig.edge.json                                        # typecheck the edge function
```

All three accept a workbook path as their first argument; the default is
`<repo root>/SAMPLE.xlsx`.

`npm run bills:selftest` runs the first three in order.

## What each one proves

| Script | Answers |
| --- | --- |
| `test-parse.ts` | Did every sheet become a bill, with no sheet skipped? Are the three copy spans derived correctly, and do the duplicate/triplicate copies agree with the original on invoice number and total? Prints every derived field so the numbers can be read against the source workbook. |
| `test-pdf.ts` | Is the output **three** documents named `<base>_original/_duplicate/_triplicate.pdf`, one page per bill, with a valid header, trailer, `/Pages /Count`, a `startxref` that lands on the xref, every xref offset resolving to its own object, one content stream per page, and each page carrying its own invoice number, grand total and quantity? |
| `audit.ts` | Does the page *look* like an invoice? Content streams are uncompressed, so the script reads back every `Tm`/`Tj`/`re`/`l` operator and reconstructs the geometry. It then checks: nothing off the page, no overlapping text on a baseline, no body text in the footer band, right-aligned money columns sharing a right edge, no >90pt hole mid-page — and prints an ASCII map of the page with the y coordinate in points, which is how the layout was actually debugged. |

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
