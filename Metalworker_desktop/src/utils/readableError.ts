// src/utils/readableError.ts
// Turns whatever the database or the network threw into something an admin can
// act on.
//
// Every service in this app rethrows `error.message` straight from
// supabase-js, which means the UI was printing PostgREST internals at the user:
// "Cannot coerce the result to a single JSON object", "code: 42P01", "relation
// ... does not exist". None of those tell an operator whether to retry, whether
// the record is gone, or whether they should call someone. Worse, the row that
// produced them was often a genuine "this id is not there", for which the
// correct response is a dead-end state with a way out — not a "Try again"
// button that can never succeed.
//
// The rule here: recognise the messages we know, and fall back to the raw text
// only when it is already plain English. Guessing at an unknown message is worse
// than showing it, so unknown messages pass through unchanged.

/** Substrings PostgREST/Postgres use for "no such row" and access problems. */
const NOT_FOUND_PATTERNS = [
  "cannot coerce the result to a single json object",
  "json object requested, multiple (or no) rows returned",
  "0 rows",
];

/** Substrings that mean "you are not allowed to see this". */
const FORBIDDEN_PATTERNS = [
  "row-level security",
  "violates row level security policy",
  "permission denied",
  "not authorized",
  "new row violates row-level security policy",
];

/** Substrings that mean "this table or column is not there". */
const SCHEMA_PATTERNS = [
  "does not exist",
  "undefined_table",
  "undefined_column",
  "42p01",
  "42703",
];

/** Substrings that mean "the server is unreachable or busy". */
const CONNECTION_PATTERNS = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "load failed",
  "econnrefused",
  "etimedout",
  "timeout",
];

/** PostgREST error codes, checked before the message text. */
const CODE_KIND: Record<string, ErrorKind> = {
  PGRST116: "not-found",
  PGRST301: "forbidden",
  "42P01": "schema",
  "42703": "schema",
  "42501": "forbidden",
};

export type ErrorKind =
  | "not-found"
  | "forbidden"
  | "schema"
  | "connection"
  | "unknown";

/**
 * Supabase errors carry a `code`. Services in this app mostly rethrow
 * `new Error(error.message)`, which drops it, so the message text is the only
 * signal we usually have. Reading the code when it survives is strictly better.
 */
function codeOf(e: unknown): string | null {
  if (e && typeof e === "object" && "code" in e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return null;
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "";
}

export function classifyError(e: unknown): ErrorKind {
  const code = codeOf(e);
  if (code && CODE_KIND[code]) return CODE_KIND[code];

  const msg = messageOf(e).toLowerCase();

  if (FORBIDDEN_PATTERNS.some((p) => msg.includes(p))) return "forbidden";
  if (CONNECTION_PATTERNS.some((p) => msg.includes(p))) return "connection";
  if (SCHEMA_PATTERNS.some((p) => msg.includes(p))) return "schema";
  if (NOT_FOUND_PATTERNS.some((p) => msg.includes(p))) return "not-found";
  return "unknown";
}

export function isNotFound(e: unknown): boolean {
  return classifyError(e) === "not-found";
}

/** Does this message read like something a person wrote? */
function readsAsEnglish(msg: string): boolean {
  if (!msg) return false;
  // Code prefixes, SQL fragments and snake_case identifiers are the tell.
  if (/\b(code|detail|hint):/i.test(msg)) return false;
  if (/\b(select|insert|update|delete|from|where|relation|column|table)\b/i.test(msg)) {
    // Allow ordinary sentences that merely contain these words, but not ones
    // that look like a query echo.
    if (/[{}()\[\]]/.test(msg) || /_/.test(msg)) return false;
  }
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-/i.test(msg)) return false;
  return /^[A-Z]/.test(msg.trim());
}

export interface ReadableErrorOptions {
  /** What was being attempted, e.g. "this folder" or "the labour user list". */
  subject: string;
  /**
   * Sentence to use when the underlying message is not recognisable. Defaults
   * to a sentence built from `subject`.
   */
  fallback?: string;
  /**
   * Sentences keyed by error kind. Any kind left out falls back to `fallback`.
   */
  byKind?: Partial<Record<ErrorKind, string>>;
}

/**
 * Returns a sentence worth showing, plus whether retrying could plausibly help.
 *
 * `retryable` is false for "not found" and "forbidden": those outcomes are
 * stable, so a "Try again" button only wastes the user's time and teaches them
 * that the app's buttons do not work.
 */
export function readableError(
  e: unknown,
  { subject, fallback, byKind }: ReadableErrorOptions
): { message: string; retryable: boolean; kind: ErrorKind } {
  const kind = classifyError(e);
  const raw = messageOf(e).trim();
  const lastResort = fallback ?? `Something went wrong loading ${subject}.`;

  if (byKind && byKind[kind]) {
    return { message: byKind[kind] as string, retryable: isRetryable(kind), kind };
  }

  if (raw && readsAsEnglish(raw)) {
    return { message: raw, retryable: isRetryable(kind), kind };
  }

  return { message: lastResort, retryable: isRetryable(kind), kind };
}

export function isRetryable(kind: ErrorKind): boolean {
  /* "Not found" and "not allowed" are answers, not outages. Offering a retry
     for them invites the user to click a button that provably cannot work. */
  return kind !== "not-found" && kind !== "forbidden";
}
