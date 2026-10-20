import type { ChatTurn } from "../validate"

export const MAX_OUTPUT_TOKENS = 1024

export interface AdapterInput {
  system: string
  turns: ChatTurn[]
  maxOutputTokens: number
  /**
   * Sampling temperature — omitted for /chat (provider default) and set low
   * for /title, where a deterministic, tightly-scoped reply is the point.
   */
  temperature?: number
}

export interface AdapterSuccess {
  reply: string
  /** HTTP status the provider returned (for server-side logs only). */
  upstreamStatus: number
}

/**
 * A committed provider stream: the upstream accepted the request (pre-flight
 * passed — status is honest) and text deltas are ready to be pulled.
 */
export interface AdapterStream {
  /** HTTP status the provider returned (for server-side logs only). */
  readonly upstreamStatus: number
  /**
   * Text deltas in arrival order. Throws UpstreamError on a mid-stream failure —
   * the caller decides how to surface it (SSE `error` event for /chat).
   */
  readonly deltas: AsyncGenerator<string, void, void>
}

/** A chat-completion provider behind the /chat endpoint. No tool/function calling. */
export interface ProviderAdapter {
  readonly name: string
  /**
   * `signal` (optional) is the caller's deadline/client-disconnect signal —
   * it must ride on the provider fetch so a timed-out or abandoned call is
   * cancelled upstream, not left to burn quota in the background.
   */
  generate(input: AdapterInput, env: import("../env").Env, signal?: AbortSignal): Promise<AdapterSuccess>
  /**
   * Open a streaming completion. Throws UpstreamError while the provider is
   * still pre-flight (request rejected, body missing) — after that point the
   * caller has only committed to a stream, so later failures surface through
   * `deltas` throwing, not through an HTTP status.
   */
  stream(
    input: AdapterInput,
    env: import("../env").Env,
    signal?: AbortSignal,
  ): Promise<AdapterStream>
}

type ProviderFailureCode = "rate_limited" | "upstream_error" | "over_capacity" | "config_error"

/**
 * Typed failure raised by adapters. `message` is safe for server-side logs and
 * is never sent to clients — they only ever see `code`.
 */
export class UpstreamError extends Error {
  readonly code: ProviderFailureCode
  /** HTTP status to return to the client. */
  readonly status: number
  /** Status the provider actually returned (logs only). */
  readonly upstreamStatus?: number
  readonly retryAfterSeconds?: number

  constructor(
    code: ProviderFailureCode,
    message: string,
    options: { status: number; upstreamStatus?: number; retryAfterSeconds?: number },
  ) {
    super(message)
    this.name = "UpstreamError"
    this.code = code
    this.status = options.status
    this.upstreamStatus = options.upstreamStatus
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}

/** Map a provider failure status to our coarse, client-safe error codes. */
export function upstreamErrorFor(status: number, retryAfterSeconds?: number): UpstreamError {
  if (status === 429) {
    return new UpstreamError("rate_limited", "provider rate-limited the request", {
      status: 429,
      upstreamStatus: status,
      retryAfterSeconds: retryAfterSeconds ?? 60,
    })
  }
  if (status === 503) {
    return new UpstreamError("over_capacity", "provider is overloaded", {
      status: 503,
      upstreamStatus: status,
    })
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    // Bad key, unknown model id, rejected request shape: a server config problem.
    return new UpstreamError("config_error", "provider rejected the server configuration", {
      status: 500,
      upstreamStatus: status,
    })
  }
  return new UpstreamError("upstream_error", "provider request failed", {
    status: 502,
    upstreamStatus: status,
  })
}
