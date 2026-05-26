import { defineConfig } from 'vite';

export default defineConfig({
  server: {
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
});
