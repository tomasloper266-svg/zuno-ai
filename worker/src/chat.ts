import type { Env } from "./env"
import {
  corsHeadersFor,
  errorResponse,
  jsonResponse,
  logEvent,
  upstreamErrorResponse,
} from "./http"
import { bodyByteLength, LIMITS, validateChatBody } from "./validate"
import { resolveAdapter } from "./providers/factory"
import { SYSTEM_PROMPT } from "./prompt"
import {
  MAX_OUTPUT_TOKENS,
  UpstreamError,
  type AdapterInput,
  type AdapterStream,
  type ProviderAdapter,
} from "./providers/types"
import { checkRateLimit, hashIp } from "./ratelimit"
import { PROVIDER_TIMEOUT_MS, providerDeadline, type ProviderDeadline } from "./providers/timeout"

/**
 * POST /chat — validate, pick the provider, return { reply } — or, when the
 * client sends "stream": true, a text/event-stream of deltas. Order matters:
 * cheap local checks first, provider call last; everything up to and including
 * the provider's pre-flight happens BEFORE any stream starts, so every failure
 * to that point keeps an honest HTTP status. Errors are logged with a request
 * id and reduced to { error: { code } } for the client.
 */
export async function handleChat(
  request: Request,
  env: Env,
  requestId: string,
  allowedOrigin: string | null,
): Promise<Response> {
  const contentType = request.headers.get("Content-Type") ?? ""
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return invalid(requestId, "content-type must be application/json", allowedOrigin)
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > LIMITS.maxBodyBytes) {
    return invalid(requestId, "body exceeds size cap", allowedOrigin)
  }

  const raw = await request.text()
  if (bodyByteLength(raw) > LIMITS.maxBodyBytes) {
    return invalid(requestId, "body exceeds size cap", allowedOrigin)
  }

  const result = validateChatBody(raw)
  if (!result.ok) {
    return invalid(requestId, result.reason, allowedOrigin)
  }

  // Per-IP rate limit AFTER validation, BEFORE the provider call. Blocked
  // requests still count, so retry floods stay locked out until reset.
  const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") ?? "")
  const decision = await checkRateLimit(env.DB, ipHash, Date.now())
  if (!decision.allowed) {
    return errorResponse("rate_limited", {
      allowedOrigin,
      retryAfterSeconds: decision.retryAfterSeconds ?? 60,
    })
  }

  const adapter = resolveAdapter(env)
  if (adapter === null) {
    logEvent("error", "provider_unwired", {
      requestId,
      provider: env.AI_PROVIDER ?? "gemini",
    })
    return errorResponse("config_error", { allowedOrigin })
  }

  const input: AdapterInput = {
    system: SYSTEM_PROMPT,
    turns: result.turns,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  }

  if (result.stream) {
    return handleStreamingChat(request, adapter, input, env, requestId, allowedOrigin)
  }

  // One deadline over the whole provider interaction: the client's disconnect
  // is forwarded as an external abort (a gone caller stops burning provider
  // quota), and the timer caps a frozen provider.
  const deadline = providerDeadline(PROVIDER_TIMEOUT_MS, request.signal)
  let success: Awaited<ReturnType<ProviderAdapter["generate"]>>
  try {
    success = await adapter.generate(input, env, deadline.signal)
  } catch (error) {
    deadline.dispose()
    if (request.signal.aborted && !deadline.timedOut) {
      // The caller vanished before the answer — nothing useful to send; log it
      // honestly instead of reporting an adapter crash.
      logEvent("info", "client_disconnected", { requestId, adapter: adapter.name })
      return errorResponse("upstream_error", { allowedOrigin })
    }
    if (deadline.timedOut) return providerTimeoutResponse(adapter, requestId, allowedOrigin)
    return upstreamErrorResponse(error, adapter, requestId, allowedOrigin)
  }
  deadline.dispose()
  return jsonResponse({ reply: success.reply }, 200, allowedOrigin)
}

/** One logged, documented 504 — the shared tail of both endpoints. */
function providerTimeoutResponse(
  adapter: ProviderAdapter,
  requestId: string,
  allowedOrigin: string | null,
): Response {
  logEvent("error", "provider_timeout", {
    requestId,
    adapter: adapter.name,
    timeoutMs: PROVIDER_TIMEOUT_MS,
  })
  return errorResponse("provider_timeout", { allowedOrigin })
}

/**
 * Streaming variant: the provider must accept the request (pre-flight) before
 * the SSE response commits; from then on the response is 200 and every failure
 * travels as an SSE `error` event. A client disconnect (request.signal aborts)
 * cancels the provider request upstream.
 */
async function handleStreamingChat(
  request: Request,
  adapter: ProviderAdapter,
  input: AdapterInput,
  env: Env,
  requestId: string,
  allowedOrigin: string | null,
): Promise<Response> {
  // One shared signal: client disconnect stops the upstream fetch AND the pump.
  const clientGone = new AbortController()
  if (request.signal.aborted) clientGone.abort()
  else request.signal.addEventListener("abort", () => clientGone.abort(), { once: true })

  // The deadline shares the disconnect chain (whoever fires first wins) and
  // caps the whole provider interaction — pre-flight plus every delta.
  const deadline = providerDeadline(PROVIDER_TIMEOUT_MS, clientGone.signal)

  let upstream: AdapterStream
  try {
    upstream = await adapter.stream(input, env, deadline.signal)
  } catch (error) {
    deadline.dispose()
    if (request.signal.aborted && !deadline.timedOut) {
      // The caller left during pre-flight; nothing useful to send.
      logEvent("info", "stream_client_disconnected", { requestId, adapter: adapter.name })
      return errorResponse("upstream_error", { allowedOrigin })
    }
    if (deadline.timedOut) return providerTimeoutResponse(adapter, requestId, allowedOrigin)
    // Pre-flight failure — no SSE bytes sent yet, so the client still gets the
    // standard JSON envelope with the honest status (429, 502, 503, 500…).
    return upstreamErrorResponse(error, adapter, requestId, allowedOrigin)
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const send = async (event: string, data: unknown): Promise<void> => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  }

  // Detached pump: the Response (status + headers) is committed the moment it is
  // returned — from here on, failures ride the stream as error events.
  void pumpStream(upstream.deltas, send, writer, clientGone, adapter, requestId, deadline)

  return new Response(readable, {
    status: 200,
    headers: sseHeaders(allowedOrigin),
  })
}

/** Exported for tests (deadline + disconnect branches need a real pump). */
export async function pumpStream(
  deltas: AsyncGenerator<string, void, void>,
  send: (event: string, data: unknown) => Promise<void>,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  clientGone: AbortController,
  adapter: ProviderAdapter,
  requestId: string,
  deadline: ProviderDeadline,
): Promise<void> {
  try {
    for await (const text of deltas) {
      if (clientGone.signal.aborted) break // stop pulling from the provider
      await send("delta", { text })
    }
    if (!clientGone.signal.aborted) {
      await send("done", { reason: "stop" })
    }
    await writer.close()
  } catch (error) {
    if (clientGone.signal.aborted) {
      // The client left; the abort that killed the provider request is the cause.
      logEvent("info", "stream_client_disconnected", { requestId, adapter: adapter.name })
      return
    }
    if (deadline.timedOut) {
      // The deadline killed the provider request mid-stream: one documented
      // error event, then close — the same wire shape as any other failure.
      logEvent("error", "provider_timeout", {
        requestId,
        adapter: adapter.name,
        timeoutMs: PROVIDER_TIMEOUT_MS,
      })
      try {
        await send("error", { error: { code: "provider_timeout" } })
        await writer.close()
      } catch {
        // The pipe died mid-report: the disconnect is the cause, not a new fault.
      }
      return
    }
    const code = error instanceof UpstreamError ? error.code : "upstream_error"
    logEvent("error", "stream_failed", {
      requestId,
      code,
      adapter: adapter.name,
      message: error instanceof Error ? error.message : String(error),
    })
    try {
      // One clear error event, then close — never a half-open stream.
      await send("error", { error: { code } })
      await writer.close()
    } catch {
      // The pipe died mid-report: the disconnect is the cause, not a new fault.
    }
  } finally {
    deadline.dispose()
  }
}

/** SSE response headers: unbuffered event stream with normal CORS semantics. */
function sseHeaders(allowedOrigin: string | null): Record<string, string> {
  return {
    ...corsHeadersFor(allowedOrigin),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
  }
}

/** Invalid requests share one client-visible code; the reason is logged only. */
function invalid(requestId: string, reason: string, allowedOrigin: string | null): Response {
  logEvent("info", "invalid_request", { requestId, reason })
  return errorResponse("invalid_request", { allowedOrigin })
}
