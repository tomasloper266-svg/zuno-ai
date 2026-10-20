/**
 * Service-worker caching decisions as pure functions.
 *
 * The hard, non-negotiable rule: NO API request or SSE stream is ever
 * intercepted, cached, or served from cache — chat traffic always goes to the
 * network, live or offline. Everything else splits between cache-first
 * (immutable hashed build assets) and network-first (navigations and other
 * same-origin files, so a deploy can never be shadowed by a stale copy).
 *
 * sw.ts applies these decisions inside its fetch handler; the tests pin them
 * here, independently of any service-worker runtime.
 */

/** What the fetch handler does with a request. */
export type CacheStrategy =
  /** Hand to the browser untouched — the only sane answer for API/SSE traffic. */
  | 'passthrough'
  /** Immutable build assets: cache, then network. */
  | 'cache-first'
  /** Fresh when online, cache only as an offline fallback. */
  | 'network-first'

/** Everything the strategy needs to know about one request — plain data, no
 * FetchEvent objects, so decisions are testable without a worker runtime. */
export interface RequestFacts {
  readonly method: string
  readonly url: string
  readonly mode: string
  readonly accept: string
  /** Origin of the service worker's own script. */
  readonly origin: string
  /** Absolute registration scope (always ends with "/"). */
  readonly scope: string
}

/** The chat endpoint of the worker contract — never cached on any origin. */
const CHAT_PATH_SEGMENT = 'chat'

/** True when the URL path carries the chat endpoint as a path segment
 * ("/chat", "/zuno/chat") — never fooled by a sibling like an asset filename. */
export function isChatApiPath(pathname: string): boolean {
  return pathname.split('/').includes(CHAT_PATH_SEGMENT)
}

/** True for Server-Sent-Events requests by their Accept signature. */
export function isEventStream(accept: string): boolean {
  return /\btext\/event-stream\b/i.test(accept)
}

/** True for Vite's hashed build output — every entry under /assets/ is
 * content-hashed by the build, so a cached copy can never be stale. */
export function isHashedBuildAsset(pathname: string): boolean {
  return pathname.includes('/assets/')
}

/** Decide, for one request, how the service worker may serve it. */
export function cacheStrategyFor(facts: RequestFacts): CacheStrategy {
  // Mutations (every API call today is POST /chat) are never ours to touch.
  if (facts.method !== 'GET') return 'passthrough'

  // SSE streams — EventSource-style GETs included — always hit the network.
  if (isEventStream(facts.accept)) return 'passthrough'

  // The chat endpoint is network-only on any origin, even if a future caller
  // reached it with GET (stream reconnects, proxies).
  let pathname: string
  try {
    pathname = new URL(facts.url).pathname
  } catch {
    // Unparseable URL: cannot classify → must never be served from cache.
    return 'passthrough'
  }
  if (isChatApiPath(pathname)) return 'passthrough'

  // Same-origin-only beyond this point: cross-origin resources (fonts) and any
  // sibling app outside our scope are passed straight through.
  if (facts.origin !== new URL(facts.url).origin) return 'passthrough'
  if (!facts.scope.endsWith('/') || !facts.url.startsWith(facts.scope)) return 'passthrough'

  // Navigations: fresh index.html whenever online — the shell a deploy must
  // never be able to shadow with a stale copy.
  if (facts.mode === 'navigate') return 'network-first'

  // Hashed build assets: immutable by construction — cache-first is safe.
  if (isHashedBuildAsset(pathname)) return 'cache-first'

  // Remaining same-origin files (manifest, icons, …): fresh when online,
  // cached only for offline.
  return 'network-first'
}
