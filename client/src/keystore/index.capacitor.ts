import { Preferences } from '@capacitor/preferences';
import type { KeyStore } from './types.js';

function makeStore(storageKey: string): KeyStore {
  return {
    async get() {
      const { value } = await Preferences.get({ key: storageKey });
      return value;
    },
    async set(v) {
      await Preferences.set({ key: storageKey, value: v });
    },
    async clear() {
      await Preferences.remove({ key: storageKey });
    },
  };
}

export const pairKeyStore = makeStore('duo_pair_secret');
export const serverUrlKeyStore = makeStore('duo_server_base_url');
