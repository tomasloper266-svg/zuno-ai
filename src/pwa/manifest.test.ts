/** Manifest validity: required PWA members, relative URLs that survive the
 * GitHub Pages subpath (/zuno-ai/), theme colors synced with tokens.css, and
 * icon files that really exist at their declared PNG dimensions. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

interface ManifestIcon {
  src: string
  sizes: string
  type: string
  purpose: string
}

interface WebManifest {
  name: string
  short_name: string
  description: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: ManifestIcon[]
  shortcuts?: { name: string; short_name: string; url: string; description?: string; icons?: ManifestIcon[] }[]
}

const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'public/manifest.webmanifest'), 'utf8'),
) as WebManifest

/** Real pixel size of a PNG from its IHDR chunk (width at byte 16, height at 20). */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path)
  const pngSignature = 0x89
  expect(buf[0]).toBe(pngSignature)
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG')
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('PWA manifest', () => {
  it('carries identity fields for an installable app', () => {
    expect(manifest.name.trim().length).toBeGreaterThan(0)
    expect(manifest.short_name.trim().length).toBeGreaterThan(0)
    expect(manifest.description.trim().length).toBeGreaterThan(0)
    expect(manifest.display).toBe('standalone')
  })

  it('uses relative start_url and scope so it works under the Pages subpath', () => {
    // "./" resolves against the manifest URL — under /zuno-ai/ the start URL is
    // /zuno-ai/ and the scope contains it; nothing may hardcode the origin root.
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.start_url.startsWith('/')).toBe(false)
    expect(manifest.scope.startsWith('/')).toBe(false)
  })

  it('theme and background colors match the --bg design token', () => {
    const tokens = readFileSync(resolve(ROOT, 'src/styles/tokens.css'), 'utf8')
    const bg = tokens.match(/^ {2}--bg: (#\w+);$/m)?.[1]
    expect(bg).toBeTruthy()
    expect(manifest.theme_color.toLowerCase()).toBe(bg?.toLowerCase())
    expect(manifest.background_color.toLowerCase()).toBe(bg?.toLowerCase())
  })

  it('declares any-purpose icons at 192 and 512 plus a maskable set', () => {
    const anyIcons = manifest.icons.filter((i) => i.purpose === 'any')
    const maskableIcons = manifest.icons.filter((i) => i.purpose === 'maskable')
    expect(anyIcons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(maskableIcons.length).toBeGreaterThanOrEqual(1)
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(icon.src.startsWith('./')).toBe(true)
      expect(icon.src.startsWith('/')).toBe(false)
    }
  })

  it('every declared icon file exists with the exact declared pixel size', () => {
    for (const icon of manifest.icons) {
      const path = resolve(ROOT, 'public', icon.src.replace(/^\.\//, ''))
      const [w, h] = icon.sizes.split('x').map(Number)
      expect(pngSize(path)).toEqual({ width: w, height: h })
    }
  })

  it('is linked from index.html with relative URLs and iOS meta tags', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    expect(html).toContain('<link rel="manifest" href="./manifest.webmanifest" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="ZUNO" />')
    // The manifest link must be relative — an absolute "/manifest.webmanifest"
    // would 404 under the /zuno-ai/ subpath.
    expect(html).not.toContain('href="/manifest.webmanifest"')
  })

  it('declares launcher shortcuts wired to the app deep-link actions', () => {
    // The URLs must stay relative (they resolve against the manifest URL, so
    // they work under the Pages subpath) and must carry the exact `action`
    // parameters App.tsx consumes at load.
    expect(manifest.shortcuts?.map((s) => s.url)).toEqual(['./?action=new-chat', './?action=search'])
    for (const shortcut of manifest.shortcuts ?? []) {
      expect(shortcut.name.trim().length).toBeGreaterThan(0)
      expect(shortcut.short_name.trim().length).toBeGreaterThan(0)
      expect(shortcut.url.startsWith('./')).toBe(true)
      expect(shortcut.icons?.every((icon) => icon.src.startsWith('./icons/'))).toBe(true)
    }
  })
})
