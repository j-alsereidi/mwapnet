import { ForegroundService, ServiceType } from '@capawesome-team/capacitor-android-foreground-service';
import { store } from '../store.js';

// ponytail: this keeps mic access alive when Android 14+ backgrounds the app
// via an app-switch (a real FGS requirement) and is table-stakes for a "real"
// installed app. It does NOT survive a deliberate power-button screen lock —
// that's a WebView page-visibility media-suspension issue (a long-standing,
// unresolved upstream Chromium bug), not a process-death issue a foreground
// service fixes. Same documented ceiling as the wake lock in
// client/src/main.ts — do not market this as fixing screen-lock audio.

let running = false;
let permissionRequested = false;

export function syncForegroundService(): void {
  const want = store.get().phase === 'room';
  if (want && !running) {
    running = true;
    void (async () => {
      // Android 13+ requires POST_NOTIFICATIONS to actually display the
      // notification; the service itself still runs without it, but the
      // notification would silently fail to show. Ask once, best-effort.
      if (!permissionRequested) {
        permissionRequested = true;
        try { await ForegroundService.requestPermissions(); } catch { /* non-fatal */ }
      }
      try {
        await ForegroundService.startForegroundService({
          id: 1,
          title: 'MWAPNET',
          body: 'Call in progress',
          smallIcon: 'ic_stat_icon',
          serviceType: ServiceType.Microphone,
        });
      } catch (err) {
        console.warn('[foreground-service] start failed:', err);
      }
    })();
  } else if (!want && running) {
    running = false;
    void ForegroundService.stopForegroundService().catch(() => { /* already stopped */ });
  }
}
