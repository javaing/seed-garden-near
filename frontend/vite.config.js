import { defineConfig } from 'vite';

export default defineConfig({
  // 部分錢包 SDK 會讀 global / process.env
  define: { global: 'globalThis', 'process.env': {} },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
