// supabase/functions/create-bill/draftRecovery.ts
//
// THE DECISION MADE WHEN AN IDEMPOTENCY KEY ALREADY HAS A BILL.
//
// When `createDraft` hits the unique index on `bills.creator_draft_key`, the request
// did not fail - it lost its response. The correct response is to carry on and save
// onto the bill that already exists, so a retried autosave is one draft instead of two.
//
// The OLD recovery path did that unconditionally. It read the existing bill by id and
// continued into the save, which meant a reused key could reach a FINALIZED document
// and overwrite its columns, line items and PDF paths through the draft-save path - the
// exact thing this function exists to prevent. A key is client-supplied, so "the stored
// row is a draft" is a decision the server makes from the database, never from anything
// the client sent.
//
// Kept in its own module with no Supabase import: it is a pure decision over a row, so
// the Node self-test can exercise every branch without Deno or a database.

export interface DraftRecoveryRow {
  id?: unknown;
  status?: unknown;
  document_type?: unknown;
  created_by?: unknown;
  creator_draft_key?: unknown;
}

export interface DraftRecoveryRequest {
  /** The authenticated user making the request. Never client-supplied. */
  userId: string;
  /** The document type the form is creating. */
  documentType: "tax_invoice" | "delivery_challan";
  /** The key that collided. */
  key: string;
  /** "invoice" or "challan", for the user-facing sentence. */
  noun: string;
}

export type DraftRecoveryDecision =
  | { action: "resume" }
  | { action: "refuse"; status: number; reason: string; message: string };

/** The finalized-document message, worded once so every path says the same thing. */
export function finalizedDraftMessage(): string {
  return "This document has already been generated. Open it from Billing to make an edit.";
}

/**
 * Exact creator ownership, used by EVERY creator path: the bill-id save/preview/
 * generate/resume path and the idempotency-key recovery path.
 *
 * A missing, null or empty `created_by` is not ownership. Historical drafts without an
 * author cannot be proved to belong to the caller, so they are refused exactly like
 * somebody else's row; the safe recovery is to start a new draft, and this predicate is
 * what stops that refusal from being softened in one place and not the other.
 */
export function isCreatorOwner(row: { created_by?: unknown } | null | undefined, userId: string): boolean {
  return (
    typeof row?.created_by === "string" &&
    row.created_by !== "" &&
    row.created_by === userId
  );
}

export function classifyDraftRecovery(
  row: DraftRecoveryRow | null | undefined,
  request: DraftRecoveryRequest
): DraftRecoveryDecision {
  if (!row || typeof row.id !== "string" || row.id === "") {
    return {
      action: "refuse",
      status: 500,
      reason: "draft_missing",
      message: "The draft could not be prepared.",
    };
  }

  /* Ownership first, and EXACTLY. A missing or null author is not "probably mine":
     recovery is an idempotency path, and the only safe answer to an identity that
     does not match is to refuse. A key is a UUID the client chose, so another
     admin's key can be guessed or copied from a shared link; without this check that
     would be a way to write to somebody else's draft. 404 rather than 403 so a wrong
     key does not confirm that a bill exists at that id. */
  if (!isCreatorOwner(row, request.userId)) {
    return {
      action: "refuse",
      status: 404,
      reason: "draft_not_found",
      message: "That draft could not be found.",
    };
  }

  /* The key must be exactly the one that actually matched. `createDraft` looks the
     row up by key, but checking it here keeps the rule true even if a caller passes
     a row read by id. A null or missing key is a mismatch, not a pass. */
  if (
    typeof row.creator_draft_key !== "string" ||
    row.creator_draft_key === "" ||
    row.creator_draft_key !== request.key
  ) {
    return {
      action: "refuse",
      status: 409,
      reason: "draft_key_mismatch",
      message: `This ${request.noun} was started by a different form. Reload the page and try again.`,
    };
  }

  if (row.document_type !== request.documentType) {
    return {
      action: "refuse",
      status: 409,
      reason: "draft_document_type_mismatch",
      message:
        request.documentType === "delivery_challan"
          ? "That is a Tax Invoice; a Delivery Challan draft must be created from the Challan Bills section."
          : "That is a Delivery Challan; a Tax Invoice draft must be created from the Tax Bills section.",
    };
  }

  /* THE important one. Checked against the stored row, before any update, and after
     ownership, so a finalized bill is never touched and never disclosed to a stranger. */
  if (row.status !== "draft") {
    return {
      action: "refuse",
      status: 409,
      reason: "already_finalized",
      message: finalizedDraftMessage(),
    };
  }

  return { action: "resume" };
}
