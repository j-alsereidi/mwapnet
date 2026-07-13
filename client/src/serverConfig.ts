import { serverUrlKeyStore } from '@keystore';

// Web: the app is served BY the backend, so location.origin IS the backend.
// Native (Capacitor/Tauri): the webview's own origin (capacitor://localhost,
// tauri://localhost, etc.) has nothing to do with where the backend lives —
// use the configured absolute URL instead, editable via the lobby settings
// panel and persisted through the same keyStore as the pair key.
export async function getServerBaseUrl(): Promise<string> {
  if (__PLATFORM__ === 'web') return location.origin;
  const override = await serverUrlKeyStore.get();
  return override?.trim() || __SERVER_BASE_URL_DEFAULT__;
}
