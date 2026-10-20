// @vitest-environment jsdom
/** isTypingTarget: the typing-guard truth table behind the shortcut router —
 * global shortcuts must never fire while the user is typing text. */
import { describe, expect, it } from 'vitest'
import { isTypingTarget } from './util'

describe('isTypingTarget', () => {
  it('is true for text-entry surfaces: textarea, input and select', () => {
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true)
    expect(isTypingTarget(document.createElement('input'))).toBe(true)
    expect(isTypingTarget(document.createElement('select'))).toBe(true)
    // The contentEditable branch (element.isContentEditable) is browser-native:
    // jsdom never implements it (isContentEditable is undefined there), so it
    // is intentionally not asserted in this suite.
  })

  it('is false for everything else, including null targets', () => {
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(document.body)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
