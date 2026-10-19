import type { Env } from "./env"
import { errorResponse, jsonResponse, logEvent } from "./http"
import { LIMITS, validateChatBody } from "./validate"
import { resolveAdapter } from "./providers/factory"
import { SYSTEM_PROMPT } from "./prompt"
import { MAX_OUTPUT_TOKENS, UpstreamError } from "./providers/types"
import { checkRateLimit, hashIp } from "./ratelimit"

/**
 * POST /chat — validate, pick the provider, return { reply }.
 * Order matters: cheap local checks first, provider call last. Errors are
 * logged with a request id and reduced to { error: { code } } for the client.
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
  if (raw.length > LIMITS.maxBodyBytes) {
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

  try {
    const success = await adapter.generate(
      { system: SYSTEM_PROMPT, turns: result.turns, maxOutputTokens: MAX_OUTPUT_TOKENS },
      env,
    )
    return jsonResponse({ reply: success.reply }, 200, allowedOrigin)
  } catch (error) {
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
}

/** Invalid requests share one client-visible code; the reason is logged only. */
function invalid(requestId: string, reason: string, allowedOrigin: string | null): Response {
  logEvent("info", "invalid_request", { requestId, reason })
  return errorResponse("invalid_request", { allowedOrigin })
}
