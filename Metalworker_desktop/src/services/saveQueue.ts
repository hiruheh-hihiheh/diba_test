// src/services/saveQueue.ts
//
// ONE WRITE AT A TIME, AND ALWAYS THE LATEST ONE.
//
// Autosave used to be a debounce that called `save()` and hoped. Two problems followed:
//
//   * A save still in flight when the next debounce fired produced two concurrent
//     writes. Whichever the server processed second won, and that was not necessarily
//     the newer values.
//   * The form reported "Saved at 10:41" for a request that started before the most
//     recent keystrokes, so the label described a version the user had already moved
//     on from.
//
// This is a small serialized queue rather than a general job runner. It has one
// version counter, one in-flight promise, and one pending flag:
//
//   change()   — a new version exists; schedule a save after the debounce.
//   flush()    — save now if anything is dirty, and keep going until the LATEST
//                version is persisted.
//   saveNow()  — force one write even when the queue considers itself clean. This is
//                what an explicit "Save Draft" uses, so a draft can be created before
//                the first autosave has ever been scheduled.
//   state()    — what the footer should say.
//
// A save is never started while another is running. If edits arrive while one runs,
// the version counter moves, and the loop runs again the moment the first finishes. A
// failure does NOT advance the saved version, so the form stays dirty: the next
// `change()` or `flush()` retries with the same draft key, and a retry therefore cannot
// create a second bill.
//
// THE QUEUE OWNS THE BOOKKEEPING
//
// A successful write marks only the version that request represented. Callers never
// say "everything is saved"; they either send a version through `change()` or ask the
// queue to save. That is what stops an old request from marking a newer edit saved.
//
// `abandon()` is the "Leave draft" path: stop the debounce, wait for a request that is
// already on the wire to settle, then discard anything that has not been confirmed.
// It never starts another save for the discarded versions.
//
// Timers are injectable so the self-test can run this under plain Node without waiting
// 1.2 seconds per case. The module is pure - no React, no Supabase - and the two app
// copies are byte-identical.

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface SaveQueueState {
  status: SaveStatus;
  /** The newest form version the queue has been told about. */
  dirtyVersion: number;
  /** The newest version the server has confirmed. */
  savedVersion: number;
  /** ISO instant of the last SUCCESSFUL save, or null. Never advanced by a failure. */
  savedAt: string | null;
  /** The last failure's message, kept until a save succeeds. */
  error: string | null;
  /** True while a request is on the wire. */
  running: boolean;
}

export type SaveOutcome =
  | { ok: true; savedAt?: string | null }
  | { ok: false; error: string };

export interface SaveContext {
  /**
   * The form version this request represents. The queue advances `savedVersion` to
   * exactly this value on success - never to whatever the form happens to be showing
   * when the response arrives.
   */
  version: number;
}

export interface SaveQueueOptions {
  /** Perform one save. Always called with no save already running. */
  save: (context: SaveContext) => Promise<SaveOutcome>;
  /** How long edits settle before an automatic save. */
  debounceMs?: number;
  onState?: (state: SaveQueueState) => void;
  now?: () => Date;
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface SaveQueue {
  /** Record an edit. Schedules the debounced save and reports "Unsaved changes". */
  change(): void;
  /**
   * Persist everything up to the newest version now, if anything is dirty.
   *
   * Resolves true only when the LATEST version was saved and there is no error. A
   * failure, or a newer edit arriving while the request was out, is reported as false
   * so Save & Exit and Generate can refuse to continue.
   */
  flush(): Promise<boolean>;
  /**
   * Force one write even when the queue is clean. Used by an explicit Save Draft,
   * including the case where the first autosave has not been scheduled yet.
   */
  saveNow(): Promise<boolean>;
  /** True when the newest version has not been persisted. */
  isDirty(): boolean;
  /** True while a request is on the wire. */
  isRunning(): boolean;
  state(): SaveQueueState;
  /** Clear the timer. Does not cancel an in-flight request, which is already sent. */
  dispose(): void;
  /**
   * Leave the creator: cancel pending debounce work, wait for an in-flight request to
   * settle, then discard every version that was not confirmed. Never starts another
   * save for the discarded versions.
   */
  abandon(): Promise<void>;
}

export function createSaveQueue(options: SaveQueueOptions): SaveQueue {
  const debounceMs = options.debounceMs ?? 1200;
  const now = options.now ?? (() => new Date());
  const setTimer =
    options.setTimeoutFn ?? ((handler: () => void, ms: number) => setTimeout(handler, ms));
  const clearTimer =
    options.clearTimeoutFn ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let dirtyVersion = 0;
  let savedVersion = 0;
  let savedAt: string | null = null;
  let error: string | null = null;
  let status: SaveStatus = "idle";
  let timer: unknown = null;
  let running: Promise<boolean> | null = null;
  let disposed = false;
  /** Set by `abandon()`: the current loop must not start another write. */
  let stopAfterCurrent = false;

  function snapshot(): SaveQueueState {
    return { status, dirtyVersion, savedVersion, savedAt, error, running: running !== null };
  }

  function emit() {
    options.onState?.(snapshot());
  }

  function cancelTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function schedule() {
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      void run(false);
    }, debounceMs);
  }

  /**
   * The loop. One request at a time; after each success, re-check whether the form
   * moved on while the request was out, and if so save again immediately.
   *
   * A failure leaves `savedVersion` behind `dirtyVersion`, so the queue remains dirty
   * and a later `flush()` (or edit) retries rather than pretending the work is saved.
   */
  function run(force: boolean): Promise<boolean> {
    if (running) return running;
    if (!force && dirtyVersion <= savedVersion) {
      return Promise.resolve(status !== "error");
    }

    running = (async () => {
      let forced = force;
      while (!stopAfterCurrent && (forced || dirtyVersion > savedVersion)) {
        forced = false;
        const targetVersion = dirtyVersion;
        status = "saving";
        emit();
        let outcome: SaveOutcome;
        try {
          outcome = await options.save({ version: targetVersion });
        } catch (err) {
          outcome = {
            ok: false,
            error: err instanceof Error ? err.message : "The draft could not be saved.",
          };
        }
        if (!outcome.ok) {
          error = outcome.error;
          status = "error";
          emit();
          return false;
        }
        savedVersion = Math.max(savedVersion, targetVersion);
        savedAt = outcome.savedAt ?? now().toISOString();
        error = null;
        /* Only "saved" when nothing newer is waiting. If the user typed during the
           request, the loop saves again and the label stays honest. */
        status = dirtyVersion > savedVersion ? "pending" : "saved";
        emit();
      }
      return dirtyVersion <= savedVersion && status !== "error";
    })().finally(() => {
      running = null;
      emit();
    });

    return running;
  }

  return {
    change() {
      if (disposed) return;
      stopAfterCurrent = false;
      dirtyVersion += 1;
      error = null;
      status = "pending";
      emit();
      schedule();
    },
    async flush() {
      stopAfterCurrent = false;
      cancelTimer();
      if (running) {
        const finished = await running;
        if (!finished) return false;
      }
      if (disposed) return dirtyVersion <= savedVersion && status !== "error";
      if (dirtyVersion <= savedVersion) return status !== "error";
      const done = await run(false);
      return done && dirtyVersion <= savedVersion && status !== "error";
    },
    async saveNow() {
      stopAfterCurrent = false;
      cancelTimer();
      if (running) {
        const finished = await running;
        if (!finished) return false;
      }
      if (disposed) return false;
      const done = await run(true);
      return done && dirtyVersion <= savedVersion && status !== "error";
    },
    isDirty() {
      return dirtyVersion > savedVersion;
    },
    isRunning() {
      return running !== null;
    },
    state: snapshot,
    dispose() {
      disposed = true;
      cancelTimer();
    },
    async abandon() {
      /* Nothing scheduled may fire after this point. */
      cancelTimer();
      stopAfterCurrent = true;
      const inflight = running;
      if (inflight) {
        try {
          await inflight;
        } catch {
          /* A failed request is already reflected in `error`; leaving is still safe
             because the server state is the last confirmed save. */
        }
      }
      /* Discard every version that was never confirmed. The next visit starts from
         the last successfully saved server state, which is exactly what "Leave draft"
         promises. */
      if (dirtyVersion > savedVersion) {
        dirtyVersion = savedVersion;
        error = null;
        status = savedVersion > 0 ? "saved" : "idle";
        emit();
      }
    },
  };
}
