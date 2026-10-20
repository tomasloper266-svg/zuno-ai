/** Service-worker caching decisions. The pinned-in-stone rule: chat API and
 * SSE traffic is passthrough on every path — method, Accept header, and URL
 * path all have to fail together before anything else is even considered. */
import { describe, expect, it } from 'vitest'
import { cacheStrategyFor, isChatApiPath } from './strategy'
import type { RequestFacts } from './strategy'

// Pages project site: scope is the subpath, not the origin root.
const FACTS: RequestFacts = {
  method: 'GET',
  url: 'https://owner.github.io/zuno-ai/',
  mode: 'navigate',
  accept: 'text/html',
  origin: 'https://owner.github.io',
  scope: 'https://owner.github.io/zuno-ai/',
}

function facts(overrides: Partial<RequestFacts>): RequestFacts {
  return { ...FACTS, ...overrides }
}

describe('cacheStrategyFor — the API/SSE never-cached rule', () => {
  it('passes every non-GET request through (all chat calls are POST /chat)', () => {
    expect(cacheStrategyFor(facts({ method: 'POST', url: 'https://worker.example/chat' }))).toBe('passthrough')
    expect(cacheStrategyFor(facts({ method: 'PUT' }))).toBe('passthrough')
    expect(cacheStrategyFor(facts({ method: 'DELETE' }))).toBe('passthrough')
  })

  it('passes SSE requests through by their Accept signature', () => {
    expect(
      cacheStrategyFor(facts({ url: 'https://owner.github.io/zuno-ai/stream', accept: 'text/event-stream' })),
    ).toBe('passthrough')
    expect(
      cacheStrategyFor(facts({ url: 'https://worker.example/chat', method: 'GET', accept: 'text/event-stream' })),
    ).toBe('passthrough')
  })

  it('passes the chat endpoint through on any origin, even as a GET', () => {
    // Live-mode worker is a different origin; a stream reconnect could be a GET.
    expect(
      cacheStrategyFor(facts({ url: 'https://zuno-worker.workers.dev/chat', mode: 'cors', accept: '*/*' })),
    ).toBe('passthrough')
    // Defense in depth: the same rule if the API ever shared our origin.
    expect(
      cacheStrategyFor(facts({ url: 'https://owner.github.io/zuno-ai/chat', mode: 'cors', accept: '*/*' })),
    ).toBe('passthrough')
  })

  it('never mistakes an asset filename for the chat endpoint (and vice versa)', () => {
    expect(isChatApiPath('/zuno-ai/assets/chat-proxy-Ab12cd34.js')).toBe(false)
    expect(isChatApiPath('/chat')).toBe(true)
    expect(isChatApiPath('/zuno-ai/chat')).toBe(true)
  })

  it('passes requests with unparseable URLs through (never guess a cache hit)', () => {
    expect(cacheStrategyFor(facts({ url: 'not a url' }))).toBe('passthrough')
  })
})

describe('cacheStrategyFor — same-origin resources under the subpath', () => {
  it('serves navigations network-first so a deploy is never shadowed', () => {
    expect(cacheStrategyFor(facts({ url: 'https://owner.github.io/zuno-ai/' }))).toBe('network-first')
    expect(cacheStrategyFor(facts({ url: 'https://owner.github.io/zuno-ai/index.html' }))).toBe('network-first')
  })

  it('serves hashed build assets cache-first', () => {
    expect(
      cacheStrategyFor(facts({ url: 'https://owner.github.io/zuno-ai/assets/index-Rhc82e6D.js', mode: 'cors' })),
    ).toBe('cache-first')
    expect(
      cacheStrategyFor(facts({ url: 'https://owner.github.io/zuno-ai/assets/index-CfFsbm6-.css', mode: 'cors' })),
    ).toBe('cache-first')
  })

  it('serves non-hashed same-origin files (manifest, icons) network-first', () => {
    expect(
      cacheStrategyFor(facts({ url: 'https://owner.github.io/zuno-ai/manifest.webmanifest', mode: 'cors' })),
    ).toBe('network-first')
    expect(
      cacheStrategyFor(facts({ url: 'https://owner.github.io/zuno-ai/icons/icon-192.png', mode: 'cors' })),
    ).toBe('network-first')
  })

  it('passes through anything outside its scope — other apps on the origin', () => {
    expect(
      cacheStrategyFor(facts({ url: 'https://owner.github.io/other-app/page', mode: 'navigate' })),
    ).toBe('passthrough')
  })
})

describe('cacheStrategyFor — cross-origin is always passthrough', () => {
  it('never caches or serves cross-origin traffic (fonts, APIs, anything)', () => {
    expect(
      cacheStrategyFor(facts({ url: 'https://fonts.gstatic.com/s/inter/v13.woff2', mode: 'cors' })),
    ).toBe('passthrough')
    expect(
      cacheStrategyFor(facts({ url: 'https://fonts.googleapis.com/css2?family=Inter', mode: 'cors' })),
    ).toBe('passthrough')
  })

  it('rejects a malformed scope as passthrough', () => {
    expect(cacheStrategyFor(facts({ scope: 'https://owner.github.io/zuno-ai' }))).toBe('passthrough')
  })
})
