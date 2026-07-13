import { LazyStore } from '@tauri-apps/plugin-store';
import type { KeyStore } from './types.js';

// One store.json shared across both keys; LazyStore defers actually loading
// the file until first access rather than at import time.
const store = new LazyStore('store.json');

function makeStore(storageKey: string): KeyStore {
  return {
    async get() {
      return (await store.get<string>(storageKey)) ?? null;
    },
    async set(v) {
      await store.set(storageKey, v);
      await store.save();
    },
    async clear() {
      await store.delete(storageKey);
      await store.save();
    },
  };
}

export const pairKeyStore = makeStore('duo_pair_secret');
export const serverUrlKeyStore = makeStore('duo_server_base_url');
