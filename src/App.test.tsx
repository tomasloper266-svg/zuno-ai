// @vitest-environment jsdom
/** Launcher deep links end-to-end: the manifest shortcut URLs (?action=…)
 * execute their real behavior at load — a fresh chat view, or the chat view
 * with the sidebar search focused — and the URL parameter is consumed so a
 * reload never re-triggers the action. No action means the home screen. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from './App'
import { strings } from './i18n/strings'
import type { Conversation } from './types'

const t = strings.en

// Chat's auto-follow effect calls el.scrollTo(...) — jsdom does not implement
// element scrolling, so provide a no-op when it is missing.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function scrollTo(): void {}
}

// jsdom has no matchMedia; useReducedMotion only needs a static query result.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function conversation(): Conversation {
  return {
    id: 'c1',
    title: 'React tips',
    createdAt: 1,
    messages: [{ id: 'm1', role: 'user', content: 'react tips', ts: 1 }],
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('PWA launcher deep links', () => {
  it('?action=new-chat opens a fresh chat view and consumes the URL parameter', () => {
    window.history.replaceState(null, '', '/?action=new-chat')
    render(<App />)

    // Chat view is up (composer textarea + sidebar search), home is not, URL clean.
    expect(screen.getByPlaceholderText(t.chat.placeholder).tagName).toBe('TEXTAREA')
    expect(screen.getByPlaceholderText(t.chat.searchPlaceholder)).toBeTruthy()
    expect(screen.queryByText(t.tagline)).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('?action=search opens the chat view with the sidebar search focused', () => {
    window.localStorage.setItem('zuno.conversations.v1', JSON.stringify([conversation()]))
    window.history.replaceState(null, '', '/?action=search')
    render(<App />)

    const search = screen.getByPlaceholderText(t.chat.searchPlaceholder)
    expect(document.activeElement).toBe(search)
    expect(window.location.search).toBe('')
  })

  it('?action=search with no saved history still lands in chat with search focused', () => {
    window.history.replaceState(null, '', '/?action=search')
    render(<App />)

    expect(screen.getByPlaceholderText(t.chat.placeholder).tagName).toBe('TEXTAREA')
    expect(document.activeElement).toBe(screen.getByPlaceholderText(t.chat.searchPlaceholder))
  })

  it('without an action the app opens the home screen', () => {
    render(<App />)

    // Home has no sidebar search; the tagline pill is home-only.
    expect(screen.queryByPlaceholderText(t.chat.searchPlaceholder)).toBeNull()
    expect(screen.getByText(t.tagline)).toBeTruthy()
  })

  it('unknown action values are ignored and left in the URL', () => {
    window.history.replaceState(null, '', '/?action=bogus')
    render(<App />)

    expect(screen.queryByPlaceholderText(t.chat.searchPlaceholder)).toBeNull()
    expect(window.location.search).toBe('?action=bogus')
  })
})
