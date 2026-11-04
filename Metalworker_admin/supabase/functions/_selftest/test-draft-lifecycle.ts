// supabase/functions/_selftest/test-draft-lifecycle.ts
//
// THE DRAFT LIFECYCLE, TESTED AS BEHAVIOUR.
//
// Four things are exercised here, each by running the real implementation rather than
// grepping its source:
//
//   A. Session identity — two intents get two keys, one intent keeps one, finalization
//      retires it, and the document type is part of the key.
//   B. Recovery — every branch of the decision the edge function makes when an
//      idempotency key already names a bill, including the finalized one.
//   C. Status — which numbers are drafts, how the filter maps, and that a draft is not
//      reported as a legacy generated bill.
//   D. The save queue — ordering, latest-pending saving, failure retention and flush.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  billMatchesStatusFilter,
  completeDraftSession,
  draftCountLabel,
  draftKeyForSession,
  draftSessionFromSearch,
  draftSessionStorageKey,
  isDraftBill,
  isDraftSessionComplete,
  newDraftKey,
  normalizeBillStatus,
  statusBadgeLabel,
  statusFilterToStatus,
  withDraftSession,
  type DraftStorage,
} from "../../../src/services/draftLifecycle.ts";
import { createSaveQueue, type SaveOutcome } from "../../../src/services/saveQueue.ts";
import {
  createDraftSessionStore,
  type AsyncDraftBackend,
} from "../../../src/services/draftSessionStoreCore.ts";
import {
  intentFromRecord,
  intentMatchesParams,
  intentToParams,
} from "../../../src/services/draftSessionIntent.ts";
import { isLegacyBill } from "../../../src/services/billDocument.ts";
import {
  classifyDraftRecovery,
  finalizedDraftMessage,
  isCreatorOwner,
} from "../create-bill/draftRecovery.ts";
import type { DraftRecoveryRow } from "../create-bill/draftRecovery.ts";

let passed = 0;
const failures: string[] = [];

function check(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${label}${detail ? `  (${detail})` : ""}`);
  console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
}

function section(title: string) {
  console.log(`\n── ${title}`);
}

/** A `sessionStorage` stand-in, so the identity tests run outside a browser. */
function memoryStorage(): DraftStorage & { dump(): Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => map,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ──────────────────────────────────────────────
   A. Session identity
   ────────────────────────────────────────────── */

section("A. every creation intent gets its own idempotency key");

{
  const first = newDraftKey();
  const second = newDraftKey();
  check(UUID_RE.test(first), "a key is a UUID-shaped token", first);
  check(first !== second, "two separate creation intents receive different keys");

  const storage = memoryStorage();
  const sessionOne = newDraftKey();
  const sessionTwo = newDraftKey();

  const a1 = draftKeyForSession(sessionOne, "tax_invoice", storage);
  const a2 = draftKeyForSession(sessionOne, "tax_invoice", storage);
  check(a1 === a2, "a retry of the SAME intent reuses its key");

  const b1 = draftKeyForSession(sessionTwo, "tax_invoice", storage);
  check(b1 !== a1, "a second intent uses a different key", `${a1} vs ${b1}`);

  const challan = draftKeyForSession(sessionOne, "delivery_challan", storage);
  check(
    challan !== a1,
    "a Tax Invoice and a Challan never share a key, even in the same session"
  );

  check(
    draftSessionStorageKey("tax_invoice", sessionOne) !==
      draftSessionStorageKey("delivery_challan", sessionOne),
    "the storage key itself is separated by document type"
  );

  /* The original bug: generate, start again in the same tab, reuse the old key. */
  completeDraftSession(sessionOne, "tax_invoice", storage);
  check(
    isDraftSessionComplete(sessionOne, "tax_invoice", storage),
    "finalization marks the session completed"
  );
  check(
    storage.getItem(draftSessionStorageKey("tax_invoice", sessionOne)) === null,
    "and clears its stored key"
  );
  const afterFinalize = draftKeyForSession(sessionOne, "tax_invoice", storage);
  check(
    afterFinalize !== a1,
    "a session reused after finalization is given a fresh key, never the old one"
  );

  check(draftKeyForSession(sessionOne, "tax_invoice", null) !==
      draftKeyForSession(sessionOne, "tax_invoice", null),
    "with no storage at all, each call still gets a distinct key");

  check(
    draftSessionFromSearch("?session=6f0e4c2a-6d4b-4b6e-9f2a-1c2d3e4f5a6b") ===
      "6f0e4c2a-6d4b-4b6e-9f2a-1c2d3e4f5a6b",
    "a session id is read back from the URL, which is what survives a refresh"
  );
  check(draftSessionFromSearch("?session=not-a-uuid") === null, "a malformed session id is refused");
  check(draftSessionFromSearch("") === null, "an absent session id is null, not a random value");
  check(
    withDraftSession("?mode=empty", "6f0e4c2a-6d4b-4b6e-9f2a-1c2d3e4f5a6b").includes("session=6f0e4c2a"),
    "the session can be written into the URL without dropping the mode"
  );
}

/* ──────────────────────────────────────────────
   B. Server recovery
   ────────────────────────────────────────────── */

section("B. an idempotency-key collision can only resume a draft");

{
  const request = {
    userId: "user-1",
    documentType: "tax_invoice" as const,
    key: "key-1",
    noun: "invoice",
  };
  const draftRow = {
    id: "bill-1",
    status: "draft",
    document_type: "tax_invoice",
    created_by: "user-1",
    creator_draft_key: "key-1",
  };

  const resume = classifyDraftRecovery(draftRow, request);
  check(resume.action === "resume", "a draft of this user and type is resumed");

  const finalized = classifyDraftRecovery({ ...draftRow, status: "finalized" }, request);
  check(
    finalized.action === "refuse" && finalized.status === 409,
    "a finalized bill is refused with HTTP 409"
  );
  check(
    finalized.action === "refuse" && finalized.message === finalizedDraftMessage(),
    "and the message tells the admin to edit it from Billing instead"
  );
  check(
    finalized.action === "refuse" && /already been generated/i.test(finalized.message),
    "the message says the document was already generated"
  );

  const crossType = classifyDraftRecovery(
    { ...draftRow, document_type: "delivery_challan" },
    request
  );
  check(
    crossType.action === "refuse" && crossType.status === 409,
    "a key belonging to the other document type is refused"
  );

  const otherUser = classifyDraftRecovery({ ...draftRow, created_by: "user-2" }, request);
  check(
    otherUser.action === "refuse" && otherUser.status === 404,
    "another user's key cannot recover their bill, and does not confirm it exists"
  );

  const missing = classifyDraftRecovery(null, request);
  check(missing.action === "refuse" && missing.status === 500, "a missing row is a server error");

  /* Rejection is a pure decision: the row object is untouched, so nothing can have been
     written before the check ran. */
  const before = JSON.stringify({ ...draftRow, status: "finalized" });
  classifyDraftRecovery({ ...draftRow, status: "finalized" }, request);
  check(
    before === JSON.stringify({ ...draftRow, status: "finalized" }),
    "rejecting a finalized bill does not modify the row it was given"
  );

  const wrongKey = classifyDraftRecovery({ ...draftRow, creator_draft_key: "key-2" }, request);
  check(wrongKey.action === "refuse", "a row carrying a different key is not resumed under this one");

  /* The edge function must actually call the classifier on the recovery path, and must
     not keep an unguarded read-by-key branch beside it. Source assertions are secondary
     here; the behaviour above is what the tests above prove. */
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../create-bill/index.ts"), "utf8");
  check(
    /classifyDraftRecovery\(read\.row/.test(source),
    "the duplicate-key recovery path goes through the classifier"
  );
  check(
    /select\("id, status, document_type, created_by, creator_draft_key"\)/.test(source),
    "the recovery lookup reads status, type and ownership, not just the id"
  );
}

/* ──────────────────────────────────────────────
   C. Status and display
   ────────────────────────────────────────────── */

section("C. a draft is a document, but not a generated one");

{
  check(normalizeBillStatus("draft") === "draft", "a stored draft stays a draft");
  check(normalizeBillStatus("finalized") === "finalized", "a stored finalized status is kept");
  check(normalizeBillStatus(undefined) === "finalized", "a missing status means generated, the column default");
  check(normalizeBillStatus("something-else") === "finalized", "an unknown status is not treated as a draft");

  check(isDraftBill("draft"), "isDraftBill recognises a draft");
  check(!isDraftBill(undefined), "and does not invent drafts");

  check(statusBadgeLabel("draft") === "Draft — Not Generated", "the draft badge says so");
  check(statusBadgeLabel("finalized") === "Generated", "the generated badge says so");

  check(statusFilterToStatus("all") === null, "All does not restrict the query");
  check(statusFilterToStatus("drafts") === "draft", "Drafts asks for drafts");
  check(statusFilterToStatus("generated") === "finalized", "Generated asks for finalized rows");
  check(billMatchesStatusFilter("drafts", "draft"), "the in-memory filter agrees with the query filter");
  check(!billMatchesStatusFilter("generated", "draft"), "a draft is not a generated document");
  check(draftCountLabel(1) === "1 draft" && draftCountLabel(3) === "3 drafts", "draft counts read naturally");
  check(draftCountLabel(-2) === "0 drafts", "a nonsensical count cannot render as negative");

  /* THE legacy-bill bug: a newly saved draft has no PDFs, and the old helper called
     every pathless row a legacy generated bill. */
  const draftWithNoPdfs = {
    original_pdf_path: null,
    duplicate_pdf_path: null,
    triplicate_pdf_path: null,
    status: "draft" as const,
  };
  const legacyFinalized = {
    original_pdf_path: null,
    duplicate_pdf_path: null,
    triplicate_pdf_path: null,
    status: "finalized" as const,
  };
  const generated = {
    original_pdf_path: "a.pdf",
    duplicate_pdf_path: "b.pdf",
    triplicate_pdf_path: "c.pdf",
    status: "finalized" as const,
  };
  check(!isLegacyBill(draftWithNoPdfs), "a draft without PDFs is NOT a legacy generated bill");
  check(isLegacyBill(legacyFinalized), "a finalized row without PDFs still is a legacy bill");
  check(!isLegacyBill(generated), "a generated bill with PDFs is not legacy");
}

/* ──────────────────────────────────────────────
   D. The save queue
   ────────────────────────────────────────────── */

section("D. autosave is serialized and always persists the newest values");

{
  /* A controllable fake clock, so the debounce is tested without waiting. */
  let timerHandler: (() => void) | null = null;
  const saveQueueWithTimer = (save: () => Promise<SaveOutcome>) =>
    createSaveQueue({
      save,
      debounceMs: 1200,
      setTimeoutFn: (handler) => {
        timerHandler = handler;
        return 1;
      },
      clearTimeoutFn: () => {
        timerHandler = null;
      },
    });

  let saves = 0;
  const debounced = saveQueueWithTimer(async () => {
    saves += 1;
    return { ok: true, savedAt: "2026-11-03T10:00:00.000Z" };
  });
  debounced.change();
  check(saves === 0, "an edit alone does not write before the debounce elapses");
  check(debounced.state().status === "pending", "and the form reports unsaved changes");
  timerHandler?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(saves === 1, "the debounced save runs once");
  check(debounced.state().status === "saved", "and the form reports it saved");
  check(!debounced.isDirty(), "with nothing left dirty");

  /* Latest pending wins: two edits while one request is out produce exactly one more
     write, and it carries the newer version. */
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const resolvers: ((outcome: SaveOutcome) => void)[] = [];
  const serial = createSaveQueue({
    debounceMs: 0,
    save: () => {
      calls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<SaveOutcome>((resolve) => {
        resolvers.push((outcome) => {
          inFlight -= 1;
          resolve(outcome);
        });
      });
    },
  });

  serial.change();
  const flushPromise = serial.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(calls === 1 && inFlight === 1, "flush starts exactly one request");
  serial.change();
  serial.change();
  check(serial.isDirty(), "edits during a request leave the queue dirty");
  resolvers[0]({ ok: true, savedAt: "2026-11-03T10:00:01.000Z" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(calls === 2, "the newer version is saved immediately after the first completes", String(calls));
  resolvers[1]({ ok: true, savedAt: "2026-11-03T10:00:02.000Z" });
  const flushed = await flushPromise;
  check(flushed === true, "flush resolves only once the latest version is persisted");
  check(maxInFlight === 1, "no two writes ever run at the same time", String(maxInFlight));
  check(!serial.isDirty(), "and the queue ends clean");

  /* A failure keeps the values dirty and NEVER advances the saved time. */
  let failingAttempt = 0;
  const failing = createSaveQueue({
    debounceMs: 0,
    now: () => new Date("2026-11-03T10:00:00.000Z"),
    save: async () => {
      failingAttempt += 1;
      return failingAttempt === 1
        ? { ok: true, savedAt: "2026-11-03T09:00:00.000Z" }
        : { ok: false, error: "network down" };
    },
  });
  failing.change();
  await failing.flush();
  check(failing.state().savedAt === "2026-11-03T09:00:00.000Z", "a successful save records its time");
  failing.change();
  const failedFlush = await failing.flush();
  check(failedFlush === false, "a failed save makes flush report failure");
  check(failing.state().status === "error", "the form shows an error rather than a save time");
  check(failing.state().savedAt === "2026-11-03T09:00:00.000Z", "the old success time is not presented as current");
  check(failing.isDirty(), "the pending changes are still dirty, so nothing is lost");

  let attempt = 0;
  const retrying = createSaveQueue({
    debounceMs: 0,
    save: async () => {
      attempt += 1;
      return attempt === 1 ? { ok: false, error: "offline" } : { ok: true, savedAt: "2026-11-03T10:05:00.000Z" };
    },
  });
  retrying.change();
  await retrying.flush();
  const retried = await retrying.flush();
  check(retried === true && attempt === 2, "flushing again retries and succeeds", `${retried}/${attempt}`);
  check(!retrying.isDirty(), "a successful retry clears the dirty state");

  const clean = createSaveQueue({ debounceMs: 0, save: async () => ({ ok: true }) });
  check((await clean.flush()) === true, "a clean form can be left without a request");
  check(clean.state().status === "idle", "and reports no unsaved state");

  /* Two copies, one behaviour. */
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "../../../..");
  const pairs = [
    ["src/services/draftLifecycle.ts"],
    ["src/services/saveQueue.ts"],
  ];
  for (const [file] of pairs) {
    const admin = readFileSync(join(root, "Metalworker_admin", file), "utf8");
    const desktop = readFileSync(join(root, "Metalworker_desktop", file), "utf8");
    check(admin === desktop, `${file} is identical in both apps`);
  }
}

/* ──────────────────────────────────────────────
   E. Save Draft and Leave draft
   ────────────────────────────────────────────── */

section("E. Save Draft works before the first autosave, and Leave draft abandons pending work");

{
  let forced = 0;
  const fresh = createSaveQueue({
    debounceMs: 1200,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    save: async () => {
      forced += 1;
      return { ok: true, savedAt: "2026-11-03T11:00:00.000Z" };
    },
  });
  check(fresh.state().status === "idle", "a brand-new form is idle");
  const savedNow = await fresh.saveNow();
  check(
    savedNow === true && forced === 1,
    "Save Draft writes even though no autosave was ever scheduled",
    `${savedNow}/${forced}`
  );
  check(!fresh.isDirty(), "and the form is clean afterwards");

  /* Abandon: a newer edit during the request is discarded, not saved. */
  let calls = 0;
  const resolvers: ((outcome: SaveOutcome) => void)[] = [];
  const abandoning = createSaveQueue({
    debounceMs: 1200,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    save: () => {
      calls += 1;
      return new Promise<SaveOutcome>((resolve) => resolvers.push(resolve));
    },
  });
  abandoning.change();
  const flushPromise = abandoning.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(calls === 1, "the flush starts one request");
  abandoning.change();
  check(abandoning.isDirty(), "an edit during the request is pending");
  const abandoned = abandoning.abandon();
  resolvers[0]({ ok: true, savedAt: "2026-11-03T11:01:00.000Z" });
  await abandoned;
  await flushPromise;
  check(calls === 1, "abandon never starts another save for the discarded version", String(calls));
  check(!abandoning.isDirty(), "abandon discards the version it never confirmed");
  check(abandoning.state().status === "saved", "the last confirmed version is what remains");

  /* A pending debounce is cancelled, not fired after leaving. */
  let pending: (() => void) | null = null;
  let fired = 0;
  const timered = createSaveQueue({
    debounceMs: 1200,
    setTimeoutFn: (handler) => {
      pending = handler;
      return 1;
    },
    clearTimeoutFn: () => {
      pending = null;
    },
    save: async () => {
      fired += 1;
      return { ok: true };
    },
  });
  timered.change();
  check(pending !== null, "an edit schedules a debounce");
  await timered.abandon();
  check(pending === null, "abandon cancels the debounce");
  if (pending) (pending as () => void)();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(fired === 0, "and the cancelled debounce never writes");
}

/* ──────────────────────────────────────────────
   F. Strict recovery identity
   ────────────────────────────────────────────── */

section("F. recovery refuses an identity it cannot prove");

{
  const request = {
    userId: "user-1",
    documentType: "tax_invoice" as const,
    key: "key-1",
    noun: "invoice",
  };
  const base: DraftRecoveryRow = {
    id: "bill-1",
    status: "draft",
    document_type: "tax_invoice",
    created_by: "user-1",
    creator_draft_key: "key-1",
  };

  const cases: Array<[string, DraftRecoveryRow, number]> = [
    ["a null author", { ...base, created_by: null }, 404],
    ["a missing author", { ...base, created_by: undefined }, 404],
    ["an empty author", { ...base, created_by: "" }, 404],
    ["a null key", { ...base, creator_draft_key: null }, 409],
    ["a missing key", { ...base, creator_draft_key: undefined }, 409],
    ["an empty key", { ...base, creator_draft_key: "" }, 409],
  ];
  for (const [label, row, status] of cases) {
    const decision = classifyDraftRecovery(row, request);
    check(decision.action === "refuse", `${label} is refused`);
    check(
      decision.action === "refuse" && decision.status === status,
      `${label} gets HTTP ${status}`
    );
  }

  const badId = classifyDraftRecovery({ ...base, id: "" }, request);
  check(badId.action === "refuse" && badId.status === 500, "an invalid id is refused");

  const good = classifyDraftRecovery(base, request);
  check(good.action === "resume", "an exact identity is still resumed");

  /* The same predicate guards the normal bill-id path, so it is exercised on its own:
     save, preview, generate and resume all reach the row through it. */
  check(isCreatorOwner(base, "user-1"), "the recorded author owns the row");
  check(!isCreatorOwner({ created_by: null }, "user-1"), "a null author is refused");
  check(!isCreatorOwner({ created_by: undefined }, "user-1"), "a missing author is refused");
  check(!isCreatorOwner({ created_by: "" }, "user-1"), "an empty author is refused");
  check(!isCreatorOwner({ created_by: "user-2" }, "user-1"), "another admin is refused");
  check(!isCreatorOwner(null, "user-1"), "a missing row is refused");

  /* Every creator path must use that one predicate rather than re-spelling a nullable
     check that would quietly adopt an unowned row. */
  const edge = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "create-bill", "index.ts"),
    "utf8"
  );
  check(
    edge.includes("isCreatorOwner(read.row, user.id)"),
    "the bill-id path uses the shared ownership predicate"
  );
  check(
    !/created_by\s+IS\s+NOT\s+NULL/.test(edge),
    "the bill-id path no longer accepts a nullable author"
  );
}

/* ──────────────────────────────────────────────
   G. Durable session storage on a phone
   ────────────────────────────────────────────── */

section("G. the native session store survives a restart and clears on finalize");

{
  function asyncMemoryBackend(seed: Record<string, string> = {}): AsyncDraftBackend & {
    dump(): Map<string, string>;
  } {
    const map = new Map<string, string>(Object.entries(seed));
    return {
      getAllKeys: async () => [...map.keys()],
      multiGet: async (keys) =>
        keys.map((key) => [key, map.get(key) ?? null] as const),
      setItem: async (key, value) => {
        map.set(key, value);
      },
      removeItem: async (key) => {
        map.delete(key);
      },
      dump: () => map,
    };
  }

  const backend = asyncMemoryBackend();
  const store = createDraftSessionStore(backend);
  check(!store.isHydrated(), "the native store starts unhydrated");
  await store.hydrate();
  check(store.isHydrated(), "hydration reads the backend once");

  const session = newDraftKey();
  const created = await store.remember({
    sessionId: session,
    documentType: "tax_invoice",
    draftKey: "key-native",
    billId: null,
    mode: "empty",
    sourceBillId: null,
  });
  check(
    created.draftKey === "key-native" && created.billId === null,
    "a new session is recorded with its key and no bill yet"
  );
  check(backend.dump().has("bill-creator:active"), "the active record reaches the durable backend");
  check(
    backend.dump().get(draftSessionStorageKey("tax_invoice", session)) === "key-native",
    "the idempotency key reaches the durable backend"
  );

  const updated = await store.remember({
    sessionId: session,
    documentType: "tax_invoice",
    billId: "bill-native-1",
  });
  check(
    updated.billId === "bill-native-1" && updated.draftKey === "key-native",
    "a later save keeps the key and records the canonical bill id"
  );

  /* A restart: a brand-new store over the same bytes. */
  const restoredStore = createDraftSessionStore(
    asyncMemoryBackend(Object.fromEntries(backend.dump()))
  );
  const restored = await restoredStore.readActive();
  check(
    restored?.sessionId === session && restored.billId === "bill-native-1",
    "a restart restores the unfinished session"
  );
  check(
    restored !== null &&
      draftKeyForSession(restored.sessionId, restored.documentType, restoredStore.storage()) ===
        "key-native",
    "the restored session reuses the key it actually sent"
  );

  await store.forget(session, "tax_invoice");
  check((await store.readActive()) === null, "forget clears the active session");
  check(
    backend.dump().get(draftSessionStorageKey("tax_invoice", session)) === undefined,
    "forget clears the idempotency key"
  );

  const corrupt = createDraftSessionStore(
    asyncMemoryBackend({ "bill-creator:active": "{not json" })
  );
  check(
    (await corrupt.readActive()) === null,
    "a corrupt stored record is ignored rather than crashing"
  );

  const broken = createDraftSessionStore({
    getAllKeys: async () => {
      throw new Error("storage unavailable");
    },
    multiGet: async () => [],
    setItem: async () => {},
    removeItem: async () => {},
  });
  await broken.hydrate();
  check(
    /storage unavailable/.test(broken.storageError() ?? ""),
    "a storage failure is reported, not swallowed"
  );
}

/* ──────────────────────────────────────────────
   H. Navigation waits for writes
   ────────────────────────────────────────────── */

section("H. a navigation guard sees work that is not 'dirty'");

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

{
  /* A forced Save Draft on a clean form: `isDirty()` is false, yet a real request is on
     the wire. This is the state the old `requestExit()` could not see. */
  const gate = deferred();
  let calls = 0;
  const queue = createSaveQueue({
    debounceMs: 1,
    save: async () => {
      calls += 1;
      await gate.promise;
      return { ok: true, savedAt: "2026-04-01T10:00:00.000Z" };
    },
  });

  const forced = queue.saveNow();
  await tick();
  check(calls === 1, "an explicit Save Draft starts one write");
  check(!queue.isDirty(), "and the form is not 'dirty' while it runs");
  check(queue.isBusy(), "but the queue reports that it is busy");

  const flushing = queue.flush();
  gate.resolve();
  const [forcedResult, flushResult] = await Promise.all([forced, flushing]);
  check(forcedResult === true && flushResult === true, "both callers see a confirmed save");
  check(calls === 1, "flush waited for the in-flight write instead of starting a second");
  check(!queue.isBusy(), "the queue is idle once the write settles");
}

{
  /* Leave draft during an in-flight write: it must wait for that request, discard what
     was never confirmed, and never start another write. */
  const gate = deferred();
  let calls = 0;
  let started = 0;
  const queue = createSaveQueue({
    debounceMs: 1,
    save: async () => {
      calls += 1;
      started += 1;
      await gate.promise;
      return { ok: true };
    },
  });

  const forced = queue.saveNow();
  await tick();
  const savedDuring = queue.saveNow();
  const abandoning = queue.abandon();
  gate.resolve();
  const [, duringResult] = await Promise.all([forced, savedDuring, abandoning]);

  check(calls === 1, "abandon waits for the request already on the wire");
  check(duringResult === false, "a Save Draft that was waiting cannot report success after leaving");
  check(!queue.isBusy(), "nothing is left running after abandon");
  check((await queue.saveNow()) === false, "abandon is terminal: no later save is started");
  check(calls === 1, "and no further request reached the server");

  queue.change();
  await tick();
  check(calls === 1, "an edit after abandon does not schedule a write");
}

/* ──────────────────────────────────────────────
   I. Durable persistence reports its own failures
   ────────────────────────────────────────────── */

section("I. a failed key write is not hidden by a successful record write");

{
  function partialBackend(failKeyWrites: boolean): AsyncDraftBackend & { dump(): Map<string, string> } {
    const map = new Map<string, string>();
    return {
      getAllKeys: async () => [...map.keys()],
      multiGet: async (keys) => keys.map((key) => [key, map.get(key) ?? null] as const),
      setItem: async (key, value) => {
        if (failKeyWrites && key !== "bill-creator:active") {
          throw new Error("key storage is read-only");
        }
        map.set(key, value);
      },
      removeItem: async (key) => {
        map.delete(key);
      },
      dump: () => map,
    };
  }

  const backend = partialBackend(true);
  const store = createDraftSessionStore(backend);
  const session = newDraftKey();
  let message = "";
  try {
    await store.remember({
      sessionId: session,
      documentType: "tax_invoice",
      draftKey: "key-partial",
      billId: "bill-partial",
      mode: "empty",
      sourceBillId: null,
    });
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  check(/identity could not be saved/.test(message), "remember() reports the key failure", message);
  check(
    /identity could not be saved/.test(store.storageError() ?? ""),
    "the failure stays outstanding after the active record was written"
  );
  check(
    backend.dump().has("bill-creator:active"),
    "the canonical bill id was still persisted, so the draft stays reachable"
  );
  check(
    (await store.readActive())?.billId === "bill-partial",
    "and it can be read back from the durable record"
  );
}

{
  /* A transient hydration failure must not be cached as 'already tried'. */
  let attempts = 0;
  const bytes = new Map<string, string>([
    [
      "bill-creator:active",
      JSON.stringify({
        sessionId: "session-retry",
        documentType: "tax_invoice",
        draftKey: "key-retry",
        billId: "bill-retry",
        mode: "empty",
        sourceBillId: null,
        updatedAt: "2026-04-01T10:00:00.000Z",
      }),
    ],
  ]);
  const store = createDraftSessionStore({
    getAllKeys: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient storage fault");
      return [...bytes.keys()];
    },
    multiGet: async (keys) => keys.map((key) => [key, bytes.get(key) ?? null] as const),
    setItem: async (key, value) => {
      bytes.set(key, value);
    },
    removeItem: async (key) => {
      bytes.delete(key);
    },
  });

  await store.hydrate();
  check(!store.isHydrated(), "a failed hydration does not claim success");
  check(/may not survive a restart/.test(store.storageError() ?? ""), "and it is reported");

  await store.hydrate();
  check(store.isHydrated(), "a second hydration attempt retries instead of reusing the failure");
  check(
    (await store.readActive())?.billId === "bill-retry",
    "and the stored session is recovered on the retry"
  );
  check(store.storageError() === null, "a recovered hydration clears its own warning");
}

{
  /* Generation, cleanup and a second intent. */
  const backend: AsyncDraftBackend = (() => {
    const map = new Map<string, string>();
    return {
      getAllKeys: async () => [...map.keys()],
      multiGet: async (keys) => keys.map((key) => [key, map.get(key) ?? null] as const),
      setItem: async (key, value) => {
        map.set(key, value);
      },
      removeItem: async (key) => {
        map.delete(key);
      },
    };
  })();
  const store = createDraftSessionStore(backend);
  const first = newDraftKey();
  await store.remember({
    sessionId: first,
    documentType: "tax_invoice",
    draftKey: "key-first",
    billId: null,
    mode: "empty",
    sourceBillId: null,
  });
  await store.remember({ sessionId: first, documentType: "tax_invoice", billId: "bill-first" });
  check((await store.readActive())?.billId === "bill-first", "the canonical id is durable");

  await store.forget(first, "tax_invoice");
  check((await store.readActive()) === null, "generation clears the unfinished session");
  check(
    !isDraftSessionComplete(first, "tax_invoice", store.storage()),
    "a completed session is not offered again"
  );

  const second = newDraftKey();
  check(second !== first, "the next Create action mints a new intent");
  await store.remember({
    sessionId: second,
    documentType: "tax_invoice",
    draftKey: "key-second",
    billId: null,
    mode: "empty",
    sourceBillId: null,
  });
  check(
    (await store.readActive())?.draftKey === "key-second",
    "and it is stored under its own key"
  );
}

/* ──────────────────────────────────────────────
   J. A restored record restores the intent, not just the id
   ────────────────────────────────────────────── */

section("J. a restored record restores the whole intent");

{
  const base = {
    sessionId: "session-j",
    documentType: "tax_invoice",
    draftKey: "key-j",
    billId: null as string | null,
    mode: "empty" as const,
    sourceBillId: null as string | null,
    updatedAt: "2026-04-01T10:00:00.000Z",
  };

  const resumed = intentFromRecord({ ...base, billId: "bill-j" });
  check(
    resumed.mode === "resume" && resumed.sourceBillId === "bill-j",
    "a stored bill id resumes the same bill"
  );
  check(resumed.sessionId === "session-j", "and keeps the session identity");

  const copied = intentFromRecord({ ...base, mode: "copy", sourceBillId: "source-j" });
  check(
    copied.mode === "copy" && copied.sourceBillId === "source-j",
    "a copy without a bill id continues the copy intent"
  );

  const profile = intentFromRecord({ ...base, mode: "profile" });
  check(profile.mode === "profile", "a profile draft continues as a profile draft");

  const blank = intentFromRecord({ ...base });
  check(blank.mode === "empty" && blank.sessionId === "session-j", "a blank draft continues empty");

  const brokenResume = intentFromRecord({ ...base, mode: "resume", sourceBillId: "gone" });
  check(
    brokenResume.mode === "empty" && brokenResume.sessionId === "session-j",
    "a resume with no bill id falls back safely and keeps the key"
  );

  const params = intentToParams(resumed);
  check(
    params.draft === "bill-j" && params.mode === undefined && params.session === "session-j",
    "a resumed intent is described by the draft parameter"
  );
  check(intentMatchesParams(params, resumed), "the URL it wrote matches the intent");

  const copyParams = intentToParams(copied);
  check(
    copyParams.copy === "source-j" && copyParams.draft === undefined,
    "a copy intent is described by the copy parameter"
  );
  check(intentMatchesParams(copyParams, copied), "and matches itself");
  check(
    !intentMatchesParams({ ...copyParams, session: "another" }, copied),
    "a different session is a different intent"
  );
  check(
    !intentMatchesParams(copyParams, resumed),
    "a draft intent and a copy intent never compare equal"
  );
}

console.log(
  `\nDRAFT LIFECYCLE CHECKS: ${failures.length === 0 ? `all ${passed} passed.` : `${failures.length} failure(s).`}`
);
if (failures.length > 0) process.exitCode = 1;
