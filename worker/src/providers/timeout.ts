/**
 * Provider-call deadline: a single cap on how long one provider interaction
 * may take — pre-flight (response head) plus, for streams, every delta.
 * A frozen provider must never hold a request open forever: the deadline
 * aborts the upstream fetch, and the caller surfaces a documented failure
 * (504 `provider_timeout` JSON, or one `error` SSE event on an open stream).
 *
 * External aborts (the client-disconnect chain) are forwarded onto the same
 * signal, so the deadline never fights or delays existing cancellation.
 */

/** Total time one provider interaction may take before it is aborted. */
export const PROVIDER_TIMEOUT_MS = 60_000

export interface ProviderDeadline {
  /** The signal to pass to the adapter: aborts on the deadline or any external signal. */
  readonly signal: AbortSignal
  /** True only when the deadline timer (not an external abort) fired. */
  readonly timedOut: boolean
  /** Clear the timer once the interaction is over — no dangling timers. */
  dispose(): void
}

/**
 * Combine a duration cap with any number of external abort signals into one
 * deadline. `timeoutMs` is a parameter so tests can use a short value;
 * production callers pass PROVIDER_TIMEOUT_MS.
 */
export function providerDeadline(timeoutMs: number, ...external: AbortSignal[]): ProviderDeadline {
  const controller = new AbortController()
  let timedOut = false

  for (const signal of external) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true })
  }

  const timer = setTimeout(() => {
    // Flag BEFORE aborting: the rejection path reads this to tell a deadline
    // hit apart from any other abort, and the timer callback runs to completion
    // before the abort rejection is observable.
    timedOut = true
    controller.abort(new DOMException("provider deadline exceeded", "TimeoutError"))
  }, timeoutMs)

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut
    },
    dispose() {
      clearTimeout(timer)
    },
  }
}
