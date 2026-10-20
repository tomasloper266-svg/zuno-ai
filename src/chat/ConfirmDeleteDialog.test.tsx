// @vitest-environment jsdom
/** ConfirmDeleteDialog: focus lands on the safe Cancel button when it opens,
 * Escape and outside pointerdown cancel, and only the danger button confirms. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { strings } from '../i18n/strings'

const t = strings.en

function renderDialog(onConfirm = vi.fn(), onCancel = vi.fn()): void {
  render(<ConfirmDeleteDialog t={t} onConfirm={onConfirm} onCancel={onCancel} />)
}

afterEach(() => {
  cleanup()
})

describe('ConfirmDeleteDialog', () => {
  it('renders the copy as a labelled modal dialog with both actions', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: t.chat.deleteConfirmTitle })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText(t.chat.deleteConfirmBody)).not.toBeNull()
    expect(screen.getByRole('button', { name: t.chat.cancel })).not.toBeNull()
    expect(screen.getByRole('button', { name: t.chat.deleteConfirmAction })).not.toBeNull()
  })

  it('focuses the safe Cancel button on open — a stray Enter can never delete', () => {
    renderDialog()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t.chat.cancel }))
  })

  it('Escape cancels and never confirms', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    renderDialog(onConfirm, onCancel)
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a pointerdown on the overlay (outside the card) cancels; one inside the card does not', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    renderDialog(onConfirm, onCancel)
    const user = userEvent.setup()

    fireEvent.pointerDown(document.querySelector('.dialog-overlay') as Element)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    cleanup()
    const onConfirm2 = vi.fn()
    const onCancel2 = vi.fn()
    renderDialog(onConfirm2, onCancel2)
    await user.click(screen.getByText(t.chat.deleteConfirmBody)) // inside the card
    expect(onCancel2).not.toHaveBeenCalled()
    expect(onConfirm2).not.toHaveBeenCalled()
  })

  it('the danger button confirms; the Cancel button cancels', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    renderDialog(onConfirm, onCancel)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: t.chat.deleteConfirmAction }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()

    cleanup()
    const onCancel2 = vi.fn()
    renderDialog(vi.fn(), onCancel2)
    await user.click(screen.getByRole('button', { name: t.chat.cancel }))
    expect(onCancel2).toHaveBeenCalledTimes(1)
  })
})
