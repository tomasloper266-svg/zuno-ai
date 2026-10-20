/**
 * PWA launcher deep links: the manifest shortcuts open the app with an
 * `action` query parameter (./?action=new-chat, ./?action=search) and the app
 * executes the real behavior at load — opens a new conversation / focuses the
 * sidebar search. Parsing is pure; App.tsx applies the effect once at mount
 * and then cleans the URL so a reload or share never re-triggers the action.
 */

/** One launcher action the app actually performs. */
export type LaunchAction = { kind: 'new-chat' } | { kind: 'search' }

/** Read a launch action from a query string (e.g. location.search).
 * Unknown or missing values mean "no action" — never a guess. */
export function parseLaunchAction(search: string): LaunchAction | null {
  const action = new URLSearchParams(search).get('action')
  if (action === 'new-chat') return { kind: 'new-chat' }
  if (action === 'search') return { kind: 'search' }
  return null
}

/** The current URL minus the launch parameter — everything else (other query
 * params, the Pages subpath) is preserved — for history.replaceState after the
 * action is consumed. */
export function stripLaunchAction(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('action')
  return url.toString()
}
