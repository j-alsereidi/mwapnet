const LS_KEY = 'duo_pair_secret';

export async function getPairSecret(): Promise<string> {
  // 1. URL fragment — never sent to server in HTTP requests
  const hash = location.hash;
  if (hash.startsWith('#k=')) {
    const secret = decodeURIComponent(hash.slice(3));
    if (secret) {
      localStorage.setItem(LS_KEY, secret);
      // Scrub the secret from the address bar immediately
      history.replaceState({}, '', location.pathname + location.search);
      return secret;
    }
  }

  // 2. Persisted key
  const stored = localStorage.getItem(LS_KEY);
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
      localStorage.setItem(LS_KEY, val);
      authScreen.classList.remove('active');
      connecting.classList.add('active');
      resolve(val);
    }

    btn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
    setTimeout(() => input.focus(), 50);
  });
}

export function clearPairSecret(): void {
  localStorage.removeItem(LS_KEY);
}
