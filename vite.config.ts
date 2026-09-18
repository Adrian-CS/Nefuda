import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Nefuda',
        short_name: 'Nefuda',
        // El idioma de la interfaz lo decide la cuenta; esto es solo el que
        // ve el sistema operativo al instalar.
        lang: 'ja',
        start_url: '/',
        display: 'standalone',
        background_color: '#F4F1EA',
        theme_color: '#B23A26',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // La colección se cachea para poder consultarla en una tienda sin
        // cobertura. Nunca se cachea /api/lookup: un precio viejo engaña.
        runtimeCaching: [
          {
            urlPattern: /\/api\/items$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'coleccion',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /\/api\/(categories|shops|vocab)/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'vocabularios' },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
  server: {
    // En desarrollo, la API la sirve `wrangler dev` en otro puerto.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
