import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [vue()],
  build: {
    cssTarget: ['chrome120', 'edge120', 'firefox121', 'safari17.2'],
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'pinia', 'vue-router'],
          'vendor-element': ['element-plus', '@element-plus/icons-vue'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-utils': ['js-yaml', '@keenthemes/ktui'],
        },
      },
    },
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
