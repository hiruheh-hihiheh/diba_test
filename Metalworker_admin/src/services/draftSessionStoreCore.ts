// src/services/draftSessionStoreCore.ts
//
// DURABLE RECOVERY FOR AN UNFINISHED CREATION SESSION.
//
// The mobile creator used `window.sessionStorage`, which is a browser API. In an
// Android build it is either missing or cleared with the process, so an admin who
// force-stopped the app lost the idempotency key and the canonical bill id and could
// start a second draft for the same work.
//
// This module is the pure half: it owns an in-memory cache, hydrates it from an
// asynchronous backend, and exposes the SYNCHRONOUS `DraftStorage` shape that
// `draftLifecycle.draftKeyForSession` already understands. The platform half lives in
// `draftSessionStore.ts` and supplies AsyncStorage.
//
// Two promises are kept explicitly:
//
//   * a write is attempted on the backend, and a failure is REPORTED rather than
//     swallowed. The in-memory copy keeps the current session usable, but the caller
//     is told that recovery across a restart is not guaranteed.
//   * `forget()` removes both the active record and the idempotency key, so the next
//     Create action mints a fresh intent instead of resolving to a finalized bill.

/* The explicit `.ts` is required by Node's ESM loader, because the self-test runs this
   module directly under plain Node. Metro and `tsc` both resolve the literal path. */
import { draftSessionStorageKey, type DraftStorage } from "./draftLifecycle.ts";

const ACTIVE_KEY = "bill-creator:active";
const PREFIX = "bill-creator:";

export interface AsyncDraftBackend {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type CreatorMode = "empty" | "profile" | "copy" | "resume";

export interface CreatorSessionRecord {
  sessionId: string;
  documentType: string;
  /** The idempotency token sent on the first save. */
  draftKey: string;
  /** The canonical row id, once the server has returned it. */
  billId: string | null;
  mode: CreatorMode;
  sourceBillId: string | null;
  updatedAt: string;
}

export interface CreatorSessionPatch {
  sessionId: string;
  documentType: string;
  draftKey?: string;
  billId?: string | null;
  mode?: CreatorMode;
  sourceBillId?: string | null;
}

export interface DraftSessionStore {
  hydrate(): Promise<void>;
  isHydrated(): boolean;
  storageError(): string | null;
  /** The synchronous adapter for `draftKeyForSession` / `completeDraftSession`. */
  storage(): DraftStorage;
  readActive(): Promise<CreatorSessionRecord | null>;
  writeActive(record: CreatorSessionRecord): Promise<void>;
  remember(patch: CreatorSessionPatch): Promise<CreatorSessionRecord>;
  forget(sessionId: string, documentType: string): Promise<void>;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Draft storage is unavailable on this device.";
}

export function createDraftSessionStore(backend: AsyncDraftBackend): DraftSessionStore {
  const memory = new Map<string, string>();
  let hydrated = false;
  let hydratePromise: Promise<void> | null = null;
  let failure: string | null = null;

  async function hydrate(): Promise<void> {
    if (hydrated) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      try {
        const keys = (await backend.getAllKeys()).filter((key) => key.startsWith(PREFIX));
        if (keys.length > 0) {
          const pairs = await backend.multiGet(keys);
          for (const [key, value] of pairs) {
            if (typeof value === "string") memory.set(key, value);
          }
        }
        hydrated = true;
        failure = null;
      } catch (err) {
        /* The form can still save with an in-memory key. It just cannot promise that
           the same intent comes back after a restart, and the caller is told so. */
        failure = `Unfinished drafts may not survive a restart: ${errorText(err)}`;
      }
    })();
    return hydratePromise;
  }

  const storage: DraftStorage = {
    getItem(key) {
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      void backend.setItem(key, value).catch((err) => {
        failure = `The draft identity could not be saved: ${errorText(err)}`;
      });
    },
    removeItem(key) {
      memory.delete(key);
      void backend.removeItem(key).catch((err) => {
        failure = `The draft identity could not be cleared: ${errorText(err)}`;
      });
    },
  };

  async function readActive(): Promise<CreatorSessionRecord | null> {
    await hydrate();
    const raw = memory.get(ACTIVE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<CreatorSessionRecord>;
      if (
        typeof parsed.sessionId !== "string" ||
        parsed.sessionId === "" ||
        typeof parsed.documentType !== "string" ||
        typeof parsed.draftKey !== "string" ||
        parsed.draftKey === ""
      ) {
        return null;
      }
      return {
        sessionId: parsed.sessionId,
        documentType: parsed.documentType,
        draftKey: parsed.draftKey,
        billId: typeof parsed.billId === "string" ? parsed.billId : null,
        mode: parsed.mode === "profile" || parsed.mode === "copy" || parsed.mode === "resume"
          ? parsed.mode
          : "empty",
        sourceBillId: typeof parsed.sourceBillId === "string" ? parsed.sourceBillId : null,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      };
    } catch {
      return null;
    }
  }

  async function writeActive(record: CreatorSessionRecord): Promise<void> {
    await hydrate();
    const raw = JSON.stringify(record);
    memory.set(ACTIVE_KEY, raw);
    try {
      await backend.setItem(ACTIVE_KEY, raw);
      failure = null;
    } catch (err) {
      failure = `The unfinished draft could not be recorded: ${errorText(err)}`;
      throw new Error(failure);
    }
  }

  async function remember(patch: CreatorSessionPatch): Promise<CreatorSessionRecord> {
    await hydrate();
    const existing = await readActive();
    const same = existing && existing.sessionId === patch.sessionId;
    const draftKey =
      patch.draftKey ??
      (same ? existing.draftKey : storage.getItem(draftSessionStorageKey(patch.documentType, patch.sessionId)));
    if (!draftKey) {
      throw new Error("The draft could not be identified. Reload the page.");
    }
    const record: CreatorSessionRecord = {
      sessionId: patch.sessionId,
      documentType: patch.documentType,
      draftKey,
      billId: patch.billId !== undefined ? patch.billId : same ? existing.billId : null,
      mode: patch.mode ?? (same ? existing.mode : "empty"),
      sourceBillId:
        patch.sourceBillId !== undefined ? patch.sourceBillId : same ? existing.sourceBillId : null,
      updatedAt: new Date().toISOString(),
    };
    /* The key is stored under the same name `draftLifecycle` uses, so a reload reads
       the exact token this session sent on its first save. Awaiting the backend write
       matters: a phone can be killed between the save and the next render, and a key
       that only reached memory would not survive it. */
    const keyStorageKey = draftSessionStorageKey(record.documentType, record.sessionId);
    memory.set(keyStorageKey, record.draftKey);
    try {
      await backend.setItem(keyStorageKey, record.draftKey);
    } catch (err) {
      failure = `The draft identity could not be saved: ${errorText(err)}`;
    }
    await writeActive(record);
    return record;
  }

  async function forget(sessionId: string, documentType: string): Promise<void> {
    await hydrate();
    const existing = await readActive();
    if (existing && existing.sessionId === sessionId && existing.documentType === documentType) {
      memory.delete(ACTIVE_KEY);
      try {
        await backend.removeItem(ACTIVE_KEY);
      } catch (err) {
        failure = `The completed draft session could not be cleared: ${errorText(err)}`;
      }
    }
    const keyStorageKey = draftSessionStorageKey(documentType, sessionId);
    memory.delete(keyStorageKey);
    try {
      await backend.removeItem(keyStorageKey);
    } catch (err) {
      failure = `The draft identity could not be cleared: ${errorText(err)}`;
    }
  }

  return {
    hydrate,
    isHydrated: () => hydrated,
    storageError: () => failure,
    storage: () => storage,
    readActive,
    writeActive,
    remember,
    forget,
  };
}
