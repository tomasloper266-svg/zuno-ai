import { useEffect, useRef } from 'react'

export interface MenuFocusApi {
  /** Container of both the trigger button and the popover menu — the bounds
   * of the "outside click" check. */
  rootRef: React.RefObject<HTMLDivElement | null>
  buttonRef: React.RefObject<HTMLButtonElement | null>
  menuRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Keyboard focus management for a small popover menu (role="menu" + buttons
 * with role="menuitem"), following the WAI-ARIA menu-button pattern:
 *
 * - Opening moves focus to the first item; the items carry tabIndex={-1}, so
 *   the page's Tab order never wanders inside the menu.
 * - ArrowDown/ArrowUp cycle the items with wrap-around, Home/End jump to the
 *   ends. Vertical arrows are direction-neutral, so RTL and LTR behave
 *   identically (the popover itself is placed with logical CSS properties).
 * - Escape closes and returns focus to the trigger button.
 * - Tab (or Shift+Tab) closes and re-anchors focus on the trigger button —
 *   the menu is about to unmount, so the default Tab move would otherwise
 *   drop focus onto <body> at a random-seeming spot. Re-anchoring is logical
 *   containment, not a trap: the next Tab proceeds from a stable place.
 * - An outside pointerdown closes without moving focus; the click target
 *   takes focus naturally.
 *
 * `onClose` receives whether the close should return focus to the trigger.
 * Listeners are only attached while the menu is open.
 */
export function useMenuFocus(open: boolean, onClose: (refocusButton: boolean) => void): MenuFocusApi {
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Opening hands focus to the first item. A separate effect (from the listener
  // one below) so listener resubscription never re-fires the focus handoff.
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    function menuItems(): HTMLButtonElement[] {
      return Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' || e.key === 'Tab') {
        // Escape = cancel; Tab = leave the menu deterministically. Both close
        // and re-anchor on the trigger button. preventDefault stops the
        // browser's default Tab traversal from racing the close (the menu
        // unmounts, its focused item vanishes) — the next Tab proceeds from
        // the stable button anchor. Containment without a trap.
        e.preventDefault()
        onClose(true)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
      const items = menuItems()
      if (items.length === 0) return
      const current = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1
      let next: number
      if (e.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
      else if (e.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
      else if (e.key === 'Home') next = 0
      else next = items.length - 1
      e.preventDefault()
      items[next]?.focus()
    }
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) onClose(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, onClose])

  return { rootRef, buttonRef, menuRef }
}
