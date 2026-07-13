// Platform-agnostic small-value persistence. One implementation file per
// target (index.web.ts / index.capacitor.ts / index.tauri.ts) is selected at
// build time via a Vite resolve.alias keyed on --mode — see vite.config.ts.
// Only the file matching the active build survives tree-shaking, so e.g. the
// web bundle never references @capacitor/preferences.
export interface KeyStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}
