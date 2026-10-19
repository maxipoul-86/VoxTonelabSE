import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo-name>/. Set BASE_PATH when building for it,
// e.g. BASE_PATH=/VoxTonelabSE/ npm run build. Locally it stays at /.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Tonelab SE Tone Assistant',
        short_name: 'Tonelab',
        description: 'Song-to-tone assistant for the VOX Tonelab SE',
        theme_color: '#141518',
        background_color: '#141518',
        display: 'standalone',
        orientation: 'any',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
