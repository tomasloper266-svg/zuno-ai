import { UpstreamError, upstreamErrorFor, type AdapterSuccess } from "./types"

/**
 * Shared upstream plumbing for provider adapters: one POST helper, one
 * Retry-After parser, one reply extractor. Upstream bodies are never embedded
 * in errors — only the status and our coarse code survive.
 */

export async function postJsonToProvider(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    // The caller aborted (client disconnect): rethrow the original abort so the
    // pump can tell it apart from a provider failure — no synthetic error here.
    if (signal?.aborted) throw error
    // Network-level failure (DNS, TLS, timeout). Status detail is a log concern only.
    throw new UpstreamError(
      "upstream_error",
      `provider request failed: ${error instanceof Error ? error.message : String(error)}`,
      { status: 502 },
    )
  }
}

/**
 * Pre-flight gate for streaming: the provider must accept the request with a
 * readable body BEFORE the client stream starts, so pre-flight failures keep
 * honest HTTP statuses through the normal error envelope. Returns the verified
 * (non-null) body for the adapter to stream from.
 */
export function ensureStreamable(response: Response, provider: string): ReadableStream<Uint8Array> {
  if (!response.ok) {
    throw upstreamErrorFor(response.status, parseRetryAfter(response.headers))
  }
  if (response.body === null) {
    throw new UpstreamError("upstream_error", `${provider} returned no body to stream`, {
      status: 502,
      upstreamStatus: response.status,
    })
  }
  return response.body as ReadableStream<Uint8Array>
}

/** Positive integer Retry-After from the provider, if present. */
export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("Retry-After")
  if (raw === null) return undefined
  const seconds = Number(raw)
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined
}

/**
 * Turn a provider response into an AdapterSuccess or throw a typed UpstreamError.
 * `pick` extracts the provider-specific reply text; null means "no usable text".
 */
export async function extractReply(
  response: Response,
  provider: string,
  pick: (data: unknown) => string | null,
): Promise<AdapterSuccess> {
  if (!response.ok) {
    throw upstreamErrorFor(response.status, parseRetryAfter(response.headers))
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new UpstreamError("upstream_error", `${provider} returned a malformed success response`, {
      status: 502,
      upstreamStatus: response.status,
    })
  }

  const reply = pick(data)
  if (reply === null || reply.length === 0) {
    throw new UpstreamError("upstream_error", `${provider} returned no reply text`, {
      status: 502,
      upstreamStatus: response.status,
    })
  }
  return { reply, upstreamStatus: response.status }
}
