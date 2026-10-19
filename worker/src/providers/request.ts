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
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  } catch (error) {
    // Network-level failure (DNS, TLS, timeout). Status detail is a log concern only.
    throw new UpstreamError(
      "upstream_error",
      `provider request failed: ${error instanceof Error ? error.message : String(error)}`,
      { status: 502 },
    )
  }
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
