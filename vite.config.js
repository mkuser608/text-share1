import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev, proxy backend routes to the Node server on :3000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/w