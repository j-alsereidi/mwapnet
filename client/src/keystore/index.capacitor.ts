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
export const sfxVolumeStore = makeStore('duo_sfx_volume');
export const sfxMutedStore = makeStore('duo_sfx_muted');
export const vineBoomVolumeStore = makeStore('duo_vineboom_volume');
export const vineBoomMutedStore = makeStore('duo_vineboom_muted');
export const exitMeowsEnabledStore = makeStore('duo_exit_meows_enabled');
export const debugModeStore = makeStore('duo_debug_mode');
