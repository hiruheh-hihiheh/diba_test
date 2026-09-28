/**
 * Turns whatever the network / Supabase / Cloudinary hands us into a sentence
 * a labour worker can act on, and tells the UI whether offering "Retry" is any
 * use. Anything we cannot classify is reported as a connection problem rather
 * than leaking a library message like "AuthApiError: invalid login credentials".
 */

export type ErrorKind = "offline" | "timeout" | "auth" | "permission" | "notFound" | "server" | "unknown";

export interface ReadableError {
  /** Sentence to show the user. Never a stack trace, never a library name. */
  message: string;
  kind: ErrorKind;
  /** True when tapping Retry could plausibly succeed. */
  retryable: boolean;
}

const OFFLINE_PATTERNS = [
  "failed to fetch",
  "network request failed",
  "networkerror",
  "econnrefused",
  "econnreset",
  "enetunreach",
  "ehostunreach",
  "etimedout",
  "socket hang up",
  "load failed",
  "unable to resolve host",
  "connection closed",
  "request timed out",
  "aborterror",
  "the internet connection appears to be offline",
  "fetch failed",
];

const TIMEOUT_PATTERNS = ["timeout", "timed out", "deadline exceeded", "etimedout"];

const AUTH_PATTERNS = [
  "invalid login credentials",
  "invalid_grant",
  "token has expired",
  "jwt",
  "refresh token",
  "session not found",
  "not authenticated",
  "email not confirmed",
  "user not found",
];

const PERMISSION_PATTERNS = [
  "permission",
  "not allowed",
  "forbidden",
  "row-level security",
  "rls",
  "denied",
  "unauthorized",
  "401",
  "403",
];

const NOT_FOUND_PATTERNS = ["not found", "does not exist", "404", "no rows returned"];

const SERVER_PATTERNS = ["500", "502", "503", "504", "internal server error", "service unavailable"];

function normalise(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.toLowerCase();
  if (input instanceof Error) return `${input.name} ${input.message}`.toLowerCase();
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    // PostgrestError shape
    if (typeof o.message === "string") return o.message.toLowerCase();
    if (typeof o.error_description === "string") return o.error_description.toLowerCase();
    if (typeof o.error === "string") return o.error.toLowerCase();
    if (o.error && typeof o.error === "object") {
      const inner = o.error as Record<string, unknown>;
      if (typeof inner.message === "string") return inner.message.toLowerCase();
    }
    try {
      return JSON.stringify(o).toLowerCase();
    } catch {
      return "";
    }
  }
  return String(input).toLowerCase();
}

function hits(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

export type ReadableErrorMessages = {
  offline: string;
  timeout: string;
  server: string;
  auth: string;
  permission: string;
  notFound: string;
  unknown: string;
};

const DEFAULT_MESSAGES: ReadableErrorMessages = {
  offline: "No internet connection. Check your network and try again.",
  timeout: "The connection is too slow. Try again in a moment.",
  server: "The server had a problem. Please try again shortly.",
  auth: "Your session has expired. Please log in again.",
  permission: "You do not have permission to do that.",
  notFound: "We could not find that record.",
  unknown: "Something went wrong. Please try again.",
};

export function classifyError(input: unknown): ErrorKind {
  const raw = normalise(input);
  if (!raw) return "unknown";
  if (hits(raw, AUTH_PATTERNS)) return "auth";
  if (hits(raw, OFFLINE_PATTERNS) || hits(raw, TIMEOUT_PATTERNS)) return "offline";
  if (hits(raw, SERVER_PATTERNS)) return "server";
  if (hits(raw, PERMISSION_PATTERNS)) return "permission";
  if (hits(raw, NOT_FOUND_PATTERNS)) return "notFound";
  return "unknown";
}

export function isRetryable(input: unknown): boolean {
  const kind = classifyError(input);
  // A missing record or a permissions problem will not fix itself on a retry.
  return kind !== "permission" && kind !== "notFound";
}

export function readableError(input: unknown, overrides?: Partial<ReadableErrorMessages>): ReadableError {
  const m = { ...DEFAULT_MESSAGES, ...overrides };
  const kind = classifyError(input);
  return {
    kind,
    retryable: isRetryable(input),
    message: m[kind] ?? m.unknown,
  };
}

/** Convenience: just the sentence. */
export function readableErrorMessage(input: unknown, overrides?: Partial<ReadableErrorMessages>): string {
  return readableError(input, overrides).message;
}
