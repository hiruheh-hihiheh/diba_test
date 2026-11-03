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
//   change()  — a new version exists; schedule a save after the debounce.
//   flush()   — save now, and keep going until the LATEST version is persisted.
//   state()   — what the footer should say.
//
// A save is never started while another is running. If edits arrive while one runs,
// the version counter moves, and the loop runs again the moment the first finishes. A
// failure does NOT advance the saved version, so the form stays dirty: the next
// `change()` or `flush()` retries with the same draft key, and a retry therefore cannot
// create a second bill.
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
}

export type SaveOutcome =
  | { ok: true; savedAt?: string | null }
  | { ok: false; error: string };

export interface SaveQueueOptions {
  /** Perform one save. Always called with no save already running. */
  save: () => Promise<SaveOutcome>;
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
   * Persist everything up to the newest version now.
   *
   * Resolves true only when the LATEST version was saved. A failure, or a newer edit
   * arriving while the request was out, is reported as false so Save & Exit can refuse
   * to navigate away.
   */
  flush(): Promise<boolean>;
  /**
   * Mark everything saved by a write that did not come through the queue (an explicit
   * "Save Draft", a preview's save-before-render, a finalize).
   */
  markSaved(at?: string | null): void;
  /** True when the newest version has not been persisted. */
  isDirty(): boolean;
  state(): SaveQueueState;
  /** Clear the timer. Does not cancel an in-flight request, which is already sent. */
  dispose(): void;
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

  function snapshot(): SaveQueueState {
    return { status, dirtyVersion, savedVersion, savedAt, error };
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
      void run();
    }, debounceMs);
  }

  /**
   * The loop. One request at a time; after each success, re-check whether the form
   * moved on while the request was out, and if so save again immediately.
   *
   * A failure leaves `savedVersion` behind `dirtyVersion`, so the queue remains dirty
   * and a later `flush()` (or edit) retries rather than pretending the work is saved.
   */
  function run(): Promise<boolean> {
    if (running) return running;
    if (dirtyVersion <= savedVersion) return Promise.resolve(status !== "error");

    running = (async () => {
      while (dirtyVersion > savedVersion) {
        const targetVersion = dirtyVersion;
        status = "saving";
        emit();
        let outcome: SaveOutcome;
        try {
          outcome = await options.save();
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
        savedVersion = targetVersion;
        savedAt = outcome.savedAt ?? now().toISOString();
        error = null;
        /* Only "saved" when nothing newer is waiting. If the user typed during the
           request, the loop saves again and the label stays honest. */
        status = dirtyVersion > savedVersion ? "pending" : "saved";
        emit();
      }
      return true;
    })().finally(() => {
      running = null;
    });

    return running;
  }

  return {
    change() {
      if (disposed) return;
      dirtyVersion += 1;
      error = null;
      status = "pending";
      emit();
      schedule();
    },
    async flush() {
      cancelTimer();
      if (running) {
        const finished = await running;
        if (!finished) return false;
      }
      if (dirtyVersion <= savedVersion) return true;
      const done = await run();
      return done && dirtyVersion <= savedVersion;
    },
    markSaved(at) {
      cancelTimer();
      savedVersion = dirtyVersion;
      savedAt = at ?? now().toISOString();
      error = null;
      status = "saved";
      emit();
    },
    isDirty() {
      return dirtyVersion > savedVersion;
    },
    state: snapshot,
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
