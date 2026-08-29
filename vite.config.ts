import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from https://<user>.github.io/factory-floor-dash/, so assets need that prefix.
// Override with BASE_PATH=/ when hosting at a domain root instead.
const base = process.env.BASE_PATH ?? '/factory-floor-dash/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
})
