// src/services/draftSessionStore.ts
//
// The platform half of draft recovery: AsyncStorage on a phone (and on web, where
// AsyncStorage itself uses localStorage). See `draftSessionStoreCore.ts` for why the
// creator cannot use `window.sessionStorage`.

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  createDraftSessionStore,
  type AsyncDraftBackend,
} from "./draftSessionStoreCore";

const backend: AsyncDraftBackend = {
  getAllKeys: () => AsyncStorage.getAllKeys(),
  multiGet: (keys) => AsyncStorage.multiGet([...keys]),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

export const draftSessionStore = createDraftSessionStore(backend);
export type {
  CreatorMode,
  CreatorSessionRecord,
  CreatorSessionPatch,
} from "./draftSessionStoreCore";
