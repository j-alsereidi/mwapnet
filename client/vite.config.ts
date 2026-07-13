import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// mode is 'development'/'production' for the normal web build (npm run
// dev/build — unchanged), or explicitly 'capacitor'/'tauri' when invoked via
// the platform-specific scripts below. Anything else falls through to 'web'.
export default defineConfig(({ mode }) => {
  const platform = mode === 'capacitor' || mode === 'tauri' ? mode : 'web';
  return {
    resolve: {
      alias: {
        // Only the file matching the active platform is ever bundled — the
        // other two implementations (and their native-only deps) are never
        // even parsed by Rollup, so e.g. the web build never references
        // @capacitor/preferences or tauri-plugin-store.
        '@keystore': fileURLToPath(new URL(`./src/keystore/index.${platform}.ts`, import.meta.url)),
        '@foreground-service': fileURLToPath(new URL(`./src/foregroundService/index.${platform}.ts`, import.meta.url)),
      },
    },
    server: {
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**', '**/capacitor/**'] },
      proxy: {
        '/ice-config': 'http://localhost:8080',
        '/health': 'http://localhost:8080',
        '/signal': {
          target: 'ws://localhost:8080',
          ws: true,
        },
      },
    },
    build: {
      target: 'es2020',
    },
    define: {
      __PLATFORM__: JSON.stringify(platform),
      __SERVER_BASE_URL_DEFAULT__: JSON.stringify(process.env.VITE_SERVER_BASE_URL ?? 'https://51.170.91.89.nip.io'),
    },
  };
});
