import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Identificador de esta versión (se ve al final del menú): así se comprueba qué versión se está usando en el móvil.
const sha = (() => { try { return execSync('git rev-parse --short HEAD').toString().trim(); } catch { return 'local'; } })();
const BUILD = `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;

// base './' → funciona igual en GitHub Pages (subcarpeta) que en local.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,wasm,glb,mp3,ogg,bin,json}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        name: 'Geonosis: Última Defensa',
        short_name: 'Geonosis',
        description: 'Defensa por oleadas en primera persona. Proyecto personal.',
        lang: 'es',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#1a0d08',
        theme_color: '#1a0d08',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
