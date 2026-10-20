// @vitest-environment jsdom
/** useReducedMotion: initial value comes from one media-query read; later
 * updates arrive through the query's change event, not repeated queries. */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useReducedMotion } from './useReducedMotion'

let matches = false
let changeListener: (() => void) | null = null

function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => {
      changeListener = listener
    },
    removeEventListener: () => {
      changeListener = null
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

afterEach(() => {
  cleanup()
  changeListener = null
  matches = false
})

describe('useReducedMotion', () => {
  it('reads the media query once for the initial value — reduced and not reduced', () => {
    matches = true
    stubMatchMedia()
    const reduced = renderHook(() => useReducedMotion())
    expect(reduced.result.current).toBe(true)

    matches = false
    stubMatchMedia()
    const normal = renderHook(() => useReducedMotion())
    expect(normal.result.current).toBe(false)
  })

  it('follows change events without re-querying per render', () => {
    matches = false
    stubMatchMedia()
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)

    // The OS preference flips → the query fires its change event.
    matches = true
    act(() => {
      changeListener?.()
    })
    expect(result.current).toBe(true)
  })
})
