// @vitest-environment jsdom
/** Demo-mode guard: the smart-title request must never claim intelligence
 * that isn't there — demo mode runs scripted replies with no backend, so no
 * /title call may ever leave the app. Separate file because the engine mock
 * differs (IS_DEMO: true here; the live-config tests mock IS_DEMO: false). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestSmartTitle } from './smartTitle'

vi.mock('./engine', () => ({ API_BASE: '', IS_DEMO: true }))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestSmartTitle in demo mode', () => {
  it('returns null without any fetch — demo replies stay network-free', async () => {
    await expect(
      requestSmartTitle({ user: 'q', assistant: 'a' }, new AbortController().signal),
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
