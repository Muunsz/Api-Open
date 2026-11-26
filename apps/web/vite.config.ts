import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    cssTarget: ['chrome120', 'edge120', 'firefox121', 'safari17.2'],
  },
  server: {
    port: 9999,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
