import { pairKeyStore } from '@keystore';

export async function getPairSecret(): Promise<string> {
  // 1. URL fragment — never sent to server in HTTP requests. Web-only in
  // practice: native shells have no address bar to put a fragment in, so
  // this branch never fires there and falls through to steps 2/3.
  const hash = location.hash;
  if (hash.startsWith('#k=')) {
    const secret = decodeURIComponent(hash.slice(3));
    if (secret) {
      await pairKeyStore.set(secret);
      // Scrub the secret from the address bar immediately
      history.replaceState({}, '', location.pathname + location.search);
      return secret;
    }
  }

  // 2. Persisted key. A read failure here must NOT brick the app — treat it
  // as "nothing stored" and fall through to manual entry. Otherwise a
  // storage-layer problem (e.g. a native plugin not registered) throws all
  // the way up to bootstrap and dead-ends on the error screen, when the
  // right thing is simply to ask the user for their key.
  let stored: string | null = null;
  try {
    stored = await pairKeyStore.get();
  } catch (err) {
    console.warn('[auth] key store read failed, falling back to manual entry:', err);
  }
  if (stored) return stored;

  // 3. Manual entry via auth screen
  return new Promise((resolve) => {
    const authScreen = document.getElementById('screen-auth')!;
    const connecting = document.getElementById('screen-connecting')!;
    const input = document.getElementById('key-input') as HTMLInputElement;
    const btn   = document.getElementById('key-submit') as HTMLButtonElement;

    connecting.classList.remove('active');
    authScreen.classList.add('active');

    function submit(): void {
      const val = input.value.trim();
      if (!val) return;
      void pairKeyStore.set(val);
      authScreen.classList.remove('active');
      connecting.classList.add('active');
      resolve(val);
    }

    btn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    setTimeout(() => input.focus(), 50);
  });
}

export async function clearPairSecret(): Promise<void> {
  await pairKeyStore.clear();
}
