import type { KeyStore } from './types.js';

function makeStore(storageKey: string): KeyStore {
  return {
    async get() { return localStorage.getItem(storageKey); },
    async set(v) { localStorage.setItem(storageKey, v); },
    async clear() { localStorage.removeItem(storageKey); },
  };
}

export const pairKeyStore = makeStore('duo_pair_secret');
export const serverUrlKeyStore = makeStore('duo_server_base_url');
