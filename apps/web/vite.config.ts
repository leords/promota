import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Cacheia apenas o app shell/assets estáticos. Dados de negócio (rotas, visitas,
      // fotos pendentes) NUNCA vivem no cache do Service Worker — ficam no IndexedDB
      // (ver src/offline/db.ts). Ver docs/ARCHITECTURE.md, seção Offline First.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      manifest: {
        name: 'Promota — Gestão de Promotores',
        short_name: 'Promota',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [],
      },
    }),
  ],
})
