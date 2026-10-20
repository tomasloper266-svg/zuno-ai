import type { Env } from "./env"
import { UpstreamError, type ProviderAdapter } from "./providers/types"

export type ErrorCode =
  | "invalid_request"
  | "rate_limited"
  | "upstream_error"
  | "over_capacity"
  | "config_error"

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  rate_limited: 429,
  upstream_error: 502,
  over_capacity: 503,
  config_error: 500,
}

/** Origins still allowed when ALLOWED_ORIGINS is unset — the two production frontends. */
export const DEFAULT_ALLOWED_ORIGINS = [
  "https://tomasloper266-svg.github.io",
  "https://0clqu2zep3-4173.hosted.obvious.ai",
]

/**
 * Resolve the exact origin to echo back in Access-Control-Allow-Origin.
 * Returns null when the request has no Origin header (non-browser client —
 * CORS headers are meaningless there) or when the Origin is not allow-listed.
 * The header is only ever reflected exactly — never "*".
 */
export function resolveAllowedOrigin(origin: string | null, env: Env): string | null {
  if (origin === null) return null
  const configured = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  const allowed = configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS
  return allowed.includes(origin) ? origin : null
}

function baseCorsHeaders(allowedOrigin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    // The origin is reflected from an allow-list, so responses vary per Origin.
    Vary: "Origin",
  }
}

/** Response CORS headers: present only when the request origin is allow-listed. */
export function corsHeadersFor(allowedOrigin: string | null): Record<string, string> {
  return allowedOrigin === null ? {} : baseCorsHeaders(allowedOrigin)
}

/** 204 preflight response, or 403 for origins that are not allow-listed. */
export function preflightResponse(origin: string | null, env: Env): Response {
  const allowedOrigin = resolveAllowedOrigin(origin, env)
  if (allowedOrigin === null) {
    return errorResponse("invalid_request", { status: 403 })
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...baseCorsHeaders(allowedOrigin),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  })
}

export interface ErrorOptions {
  /** Override the default status for this code (e.g. 403 for disallowed origins). */
  status?: number
  /** Seconds the client should wait before retrying (429 responses). */
  retryAfterSeconds?: number
  /** Allow-listed origin to reflect in CORS headers, if any. */
  allowedOrigin?: string | null
  /** Extra headers (e.g. Allow on 405). */
  headers?: Record<string, string>
}

/** The only error shape clients ever see: { error: { code } }. Details stay in logs. */
export function errorResponse(code: ErrorCode, options: ErrorOptions = {}): Response {
  const status = options.status ?? STATUS_BY_CODE[code]
  const headers: Record<string, string> = {
    ...corsHeadersFor(options.allowedOrigin ?? null),
    ...(options.headers ?? {}),
  }
  if (options.retryAfterSeconds !== undefined) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil(options.retryAfterSeconds)))
  }
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  })
}

export function jsonResponse(body: unknown, status: number, allowedOrigin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(allowedOrigin), "Content-Type": "application/json" },
  })
}

/** Map an adapter failure to the standard JSON error envelope — the shared
 * tail of every endpoint that calls a provider (pre-stream failures only). */
export function upstreamErrorResponse(
  error: unknown,
  adapter: ProviderAdapter,
  requestId: string,
  allowedOrigin: string | null,
): Response {
  if (error instanceof UpstreamError) {
    logEvent("error", "upstream_failure", {
      requestId,
      code: error.code,
      upstreamStatus: error.upstreamStatus,
      adapter: adapter.name,
    })
    return errorResponse(error.code, {
      allowedOrigin,
      retryAfterSeconds: error.retryAfterSeconds,
    })
  }
  logEvent("error", "adapter_crashed", {
    requestId,
    message: error instanceof Error ? error.message : String(error),
  })
  return errorResponse("upstream_error", { allowedOrigin })
}

/** Structured server-side log line: event name and ids — never secrets, never upstream bodies. */
export function logEvent(level: "info" | "error", event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ event, ...fields, ts: new Date().toISOString() })
  if (level === "error") console.error(line)
  else console.info(line)
}
