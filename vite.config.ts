import { defineConfig, type Plugin } from 'vite'
import { build as esbuild } from 'esbuild'
import react from '@vitejs/plugin-react'

/**
 * Bundles src/sw/sw.ts into a single classic-script dist/sw.js.
 *
 * A service worker must be one self-contained file (module workers are not
 * universally supported), so the source is bundled with esbuild at build time
 * instead of living as an unprocessed file in public/. The cache version is a
 * build-time constant: every build produces different sw.js bytes, so the
 * browser detects the update, and the new worker's activate handler purges
 * caches from older versions — no stale cache can survive a deploy.
 */
function zunoServiceWorker(): Plugin {
  return {
    name: 'zuno-service-worker',
    apply: 'build',
    async generateBundle() {
      const result = await esbuild({
        entryPoints: ['src/sw/sw.ts'],
        bundle: true,
        format: 'iife',
        target: 'es2020',
        minify: false,
        write: false,
        logLevel: 'warning',
        define: {
          __SW_CACHE_VERSION__: JSON.stringify(`v${Date.now().toString(36)}`),
        },
      })
      for (const file of result.outputFiles) {
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: file.text })
      }
    },
  }
}

// base './' keeps the built app portable (serve it from any path or static host later).
export default defineConfig({
  base: './',
  plugins: [react(), zunoServiceWorker()],
})
