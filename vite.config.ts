import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' keeps the built app portable (serve it from any path or static host later).
export default defineConfig({
  base: './',
  plugins: [react()],
})
