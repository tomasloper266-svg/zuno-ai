/** Launcher deep-link parsing: the manifest shortcuts land as ?action=…
 * URLs; only the exact known actions count, and URL cleanup preserves the
 * Pages subpath and any other query parameters. */
import { describe, expect, it } from 'vitest'
import { parseLaunchAction, stripLaunchAction } from './launchIntent'

describe('parseLaunchAction', () => {
  it('recognizes the two launcher actions', () => {
    expect(parseLaunchAction('?action=new-chat')).toEqual({ kind: 'new-chat' })
    expect(parseLaunchAction('?action=search')).toEqual({ kind: 'search' })
  })

  it('tolerates extra query parameters', () => {
    expect(parseLaunchAction('?action=new-chat&utm_source=homescreen')).toEqual({ kind: 'new-chat' })
  })

  it('treats missing, empty, and unknown actions as no action', () => {
    expect(parseLaunchAction('')).toBeNull()
    expect(parseLaunchAction('?')).toBeNull()
    expect(parseLaunchAction('?other=1')).toBeNull()
    expect(parseLaunchAction('?action=bogus')).toBeNull()
    // No guessing: case differences are not the action either.
    expect(parseLaunchAction('?action=New-Chat')).toBeNull()
  })
})

describe('stripLaunchAction', () => {
  it('removes the action parameter and keeps the subpath and other params', () => {
    expect(stripLaunchAction('https://owner.github.io/zuno-ai/?action=search')).toBe(
      'https://owner.github.io/zuno-ai/',
    )
    expect(stripLaunchAction('https://owner.github.io/zuno-ai/?action=new-chat&x=1')).toBe(
      'https://owner.github.io/zuno-ai/?x=1',
    )
  })

  it('leaves URLs without an action untouched in meaning', () => {
    expect(stripLaunchAction('https://owner.github.io/zuno-ai/?x=1')).toBe(
      'https://owner.github.io/zuno-ai/?x=1',
    )
    expect(stripLaunchAction('https://owner.github.io/zuno-ai/')).toBe('https://owner.github.io/zuno-ai/')
  })
})
