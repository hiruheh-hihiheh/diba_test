// supabase/functions/process-bill-upload/_shared/formatJobKind.ts
//
// The job classification printed on the invoice.
//
// WHY A NORMALIZER AT ALL
// The workbook is written by hand, so the same classification reaches the parser
// in several spellings: "LABOUR JOB", "LABOUR", "WITHMETAL", "WITH METAL",
// "with  material", and once as "WITH_METAL". The raw token is stored verbatim in
// `bills.job_kind` (migration 0005) because the database must record what the
// source actually said, but "WITHMETAL" is not something to put in front of a
// customer or a print operator. So the stored value stays raw and only the
// DISPLAY is normalized here — one function, used by the PDF renderer, so the
// three print copies and the two admin apps all say the same thing.
//
// This is deliberately NOT a second job-type system. It maps a string to a
// presentable string and nothing else: it never infers the classification from
// the invoice number, the sheet name, an amount or a description. If `jobKind` is
// absent the answer is null and the caller omits it — no default is invented,
// because guessing "LABOUR JOB" onto an invoice that never declared a job type
// would be a fabricated financial classification.

/**
 * Presentation label for `bills.job_kind`, or `null` when there is nothing to
 * show.
 *
 * Known spellings are canonicalized to their canonical form. Anything else
 * non-empty is cleaned up and shown rather than discarded, so an unrecognised
 * classification is visible to the operator instead of silently vanishing.
 */
export function formatJobKind(jobKind: string | null | undefined): string | null {
  if (jobKind === null || jobKind === undefined) return null;

  // Collapse runs of whitespace (including the tabs some templates use) and trim.
  const cleaned = String(jobKind).replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;

  /* Match on a "squashed" key — uppercase, alphanumerics only — so case,
     spacing, hyphens and underscores cannot change the answer. The same trick
     the field parser uses for labels. */
  const key = cleaned.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (key === "LABOURJOB" || key === "LABOUR") return "LABOUR JOB";
  if (key === "WITHMETAL" || key === "WITHMATERIAL") return "WITH METAL";

  /* Unrecognised but non-empty: turn separators into spaces and title-case the
     words, so the operator sees something readable rather than a raw token. */
  return cleaned
    .replace(/[_-]+/g, " ")
    .split(" ")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}
