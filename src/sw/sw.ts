/**
 * ZUNO service worker.
 *
 * Caching policy (decisions live in strategy.ts, unit-tested there):
 * - GET build assets under /assets/ (content-hashed → immutable): cache-first.
 * - Navigations and other same-origin files: network-first with a cached
 *   offline fallback — a deploy is never shadowed by a stale shell.
 * - API and SSE traffic (POST /chat): NEVER intercepted, NEVER cached —
 *   the strategy returns 'passthrough' and this worker does nothing.
 *
 * Updates: a new build changes this file's bytes (the cache version is a
 * build-time constant), so the browser re-installs on the next visit. The new
 * worker waits while old tabs run; it activates when they close, purges every
 * cache it does not own, and claims clients. No skipWaiting is issued on our
 * own — an unprompted swap could cut an in-flight SSE stream.
 */

import { cacheStrategyFor } from './strategy'

declare const __SW_CACHE_VERSION__: string

/** Minimal service-worker-global surface used here. The DOM lib and the
 * WebWorker lib cannot both be loaded cleanly, so the boundary is declared
 * locally — tightly typed, exactly the members this file touches. */
interface SWExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void
}
interface SWFetchEvent extends Event {
  readonly request: Request
  respondWith(value: Promise<Response> | Response): void
}
interface SWMessageEvent extends Event {
  readonly data: unknown
}
interface SWGlobalScope {
  readonly location: { readonly origin: string }
  readonly registration: { readonly scope: string }
  readonly clients: { claim(): Promise<unknown> }
  addEventListener(type: 'activate' | 'install', listener: (event: SWExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: SWFetchEvent) => void): void
  addEventListener(type: 'message', listener: (event: SWMessageEvent) => void): void
  skipWaiting(): Promise<void>
}

// One honest assertion at the boundary: inside this file `self` is always the
// service worker global.
const sw = self as unknown as SWGlobalScope

const ASSET_CACHE = `zuno-assets-${__SW_CACHE_VERSION__}`
const PAGE_CACHE = `zuno-pages-${__SW_CACHE_VERSION__}`
const OWNED_CACHES = [ASSET_CACHE, PAGE_CACHE]

sw.addEventListener('activate', (event: SWExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !OWNED_CACHES.includes(key)).map((key) => caches.delete(key))),
      )
      .then(() => sw.clients.claim()),
  )
})

/** Cache-first: immutable assets only. A cache miss goes to the network and
 * seeds the cache; failed fetches surface as real network errors. */
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request)
  if (cached !== undefined) return cached
  const response = await fetch(request)
  if (response.ok) {
    const cache = await caches.open(ASSET_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

/** Network-first: always try fresh, fall back to the cached copy when offline.
 * Navigations additionally fall back to the app shell at "./" — the offline
 * entry point of a single-page app launched from the scope root. */
async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request)
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(PAGE_CACHE)
      await cache.put(request, response.clone())
    }
    return response
  } catch (err) {
    const cached = await caches.match(request)
    if (cached !== undefined) return cached
    if (request.mode === 'navigate') {
      const shell = await caches.match('./')
      if (shell !== undefined) return shell
    }
    throw err
  }
}

sw.addEventListener('fetch', (event: SWFetchEvent) => {
  const request = event.request
  const strategy = cacheStrategyFor({
    method: request.method,
    url: request.url,
    mode: request.mode,
    accept: request.headers.get('accept') ?? '',
    origin: sw.location.origin,
    scope: sw.registration.scope,
  })
  if (strategy === 'passthrough') return
  event.respondWith(strategy === 'cache-first' ? cacheFirst(request) : networkFirst(request))
})

/** Reserved for a future update prompt: an explicit, user-gated skipWaiting.
 * Nothing in the app sends this message today — updates land naturally. */
sw.addEventListener('message', (event: SWMessageEvent) => {
  if (event.data === 'SKIP_WAITING') void sw.skipWaiting()
})
