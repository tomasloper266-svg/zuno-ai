import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/**
 * Persist a piece of state in localStorage. All client-side persistence in
 * ZUNO is local-to-this-browser only — there is no cloud storage and no auth.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw !== null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable (private mode / quota) — app still works in-memory */
    }
  }, [key, value])

  return [value, setValue]
}
