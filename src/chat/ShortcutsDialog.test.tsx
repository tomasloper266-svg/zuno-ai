// @vitest-environment jsdom
/** ShortcutsDialog: every available shortcut is listed with its keys (EN and
 * AR), focus lands on the Close button on open, and Escape / an outside
 * pointerdown close it — the caller re-focusing the opener. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsDialog } from './ShortcutsDialog'
import { strings } from '../i18n/strings'

const t = strings.en

afterEach(() => {
  cleanup()
})

describe('ShortcutsDialog', () => {
  it('lists every available shortcut with its keys, in English and in Arabic', () => {
    render(<ShortcutsDialog t={t} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: t.chat.shortcuts.title })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    for (const row of t.chat.shortcuts.rows) {
      expect(screen.getByText(row.action)).toBeTruthy()
      expect(screen.getByText(row.keys)).toBeTruthy()
    }
    cleanup()
    render(<ShortcutsDialog t={strings.ar} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: strings.ar.chat.shortcuts.title })).toBeTruthy()
    expect(screen.getByText('إيقاف الرد الجاري')).toBeTruthy()
    expect(screen.getByText('إدراج سطر جديد')).toBeTruthy()
  })

  it('focuses the Close button on open; Escape closes and the caller returns focus to the opener', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    // The caller (Chat) owns the opener ref — mirrored here to prove the
    // contract: onClose runs, then focus lands back on the opener.
    const onClose = vi.fn(() => opener.focus())
    render(<ShortcutsDialog t={t} onClose={onClose} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t.chat.shortcuts.close }))
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('the Close button and an outside pointerdown close the panel', async () => {
    const onClose = vi.fn()
    render(<ShortcutsDialog t={t} onClose={onClose} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.chat.shortcuts.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()
    const onClose2 = vi.fn()
    const second = render(<ShortcutsDialog t={t} onClose={onClose2} />)
    fireEvent.pointerDown(second.container.firstElementChild as Element)
    expect(onClose2).toHaveBeenCalledTimes(1)
  })
})
