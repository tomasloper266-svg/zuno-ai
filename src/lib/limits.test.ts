import { describe, expect, it } from 'vitest'
import { limitStatus, MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS } from './limits'

/**
 * The composer's numbers ARE the Worker's wire contract — this suite pins the
 * mirror so a one-sided change (frontend or worker/src/validate.ts) fails a
 * test instead of drifting silently.
 */
describe('limitStatus — composer limit feedback', () => {
  it('matches the Worker wire contract numbers', () => {
    expect(MAX_MESSAGE_CHARS).toBe(4000)
    expect(MAX_TOTAL_CHARS).toBe(8000)
  })

  it('counts the trimmed draft and sits far from the limits by default', () => {
    const s = limitStatus('  hello  ', 0)
    expect(s.messageChars).toBe(5)
    expect(s.totalChars).toBe(5)
    expect(s.nearLimit).toBe(false)
    expect(s.messageOver).toBe(false)
    expect(s.totalOver).toBe(false)
  })

  it('turns on nearLimit exactly at 90% of the message limit', () => {
    expect(limitStatus('a'.repeat(3599), 0).nearLimit).toBe(false)
    expect(limitStatus('a'.repeat(3600), 0).nearLimit).toBe(true)
  })

  it('turns on nearLimit from the request total as well', () => {
    expect(limitStatus('a'.repeat(100), 7099).nearLimit).toBe(false)
    expect(limitStatus('a'.repeat(100), 7100).nearLimit).toBe(true) // 7200 = 90% of 8000
  })

  it('marks the message over only past the exact limit', () => {
    expect(limitStatus('a'.repeat(4000), 0).messageOver).toBe(false)
    expect(limitStatus('a'.repeat(4001), 0).messageOver).toBe(true)
  })

  it('marks the request total over only past the exact limit', () => {
    expect(limitStatus('a'.repeat(500), 7500).totalOver).toBe(false)
    expect(limitStatus('a'.repeat(501), 7500).totalOver).toBe(true)
  })
})
