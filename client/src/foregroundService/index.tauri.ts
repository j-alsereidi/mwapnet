// No screen-lock/background-suspension problem to work around on desktop —
// the OS doesn't suspend media capture for a backgrounded window the way
// Android suspends a backgrounded WebView tab.
export function syncForegroundService(): void { /* no-op */ }
