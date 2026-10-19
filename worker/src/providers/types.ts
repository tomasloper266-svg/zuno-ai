import type { ChatTurn } from "../validate"

export const MAX_OUTPUT_TOKENS = 1024

export interface AdapterInput {
  system: string
  turns: ChatTurn[]
  maxOutputTokens: number
}

export interface AdapterSuccess {
  reply: string
  /** HTTP status the provider returned (for server-side logs only). */
  upstreamStatus: number
}

/** A chat-completion provider behind the /chat endpoint. No tool/function calling. */
export interface ProviderAdapter {
  readonly name: string
  generate(input: AdapterInput, env: import("../env").Env): Promise<AdapterSuccess>
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
