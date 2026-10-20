import type { Env } from "./env"
import { handleChat } from "./chat"
import { handleTitle } from "./title"
import {
  errorResponse,
  jsonResponse,
  logEvent,
  preflightResponse,
  resolveAllowedOrigin,
} from "./http"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID()
    try {
      return await route(request, env, requestId)
    } catch (error) {
      // Anything unexpected here (e.g. D1 unavailable) is a capacity problem,
      // not a client problem — keep the envelope generic, log the details.
      logEvent("error", "unhandled_error", {
        requestId,
        message: error instanceof Error ? error.message : String(error),
      })
      return errorResponse("over_capacity")
    }
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url)

  // Preflight is handled before anything else; browsers send OPTIONS with Origin.
  if (request.method === "OPTIONS") {
    return preflightResponse(request.headers.get("Origin"), env)
  }

  const origin = request.headers.get("Origin")
  const allowedOrigin = resolveAllowedOrigin(origin, env)
  if (origin !== null && allowedOrigin === null) {
    logEvent("info", "origin_blocked", { requestId, origin, path: url.pathname })
    return errorResponse("invalid_request", { status: 403 })
  }

  if (url.pathname === "/health") {
    if (request.method !== "GET") return methodNotAllowed(requestId, "GET")
    return jsonResponse({ ok: true }, 200, allowedOrigin)
  }

  if (url.pathname === "/chat") {
    if (request.method !== "POST") return methodNotAllowed(requestId, "POST")
    return handleChat(request, env, requestId, allowedOrigin)
  }

  if (url.pathname === "/title") {
    if (request.method !== "POST") return methodNotAllowed(requestId, "POST")
    return handleTitle(request, env, requestId, allowedOrigin)
  }

  logEvent("info", "not_found", { requestId, method: request.method, path: url.pathname })
  return errorResponse("invalid_request", { status: 404 })
}

function methodNotAllowed(requestId: string, allow: string): Response {
  logEvent("info", "method_not_allowed", { requestId, allow })
  return errorResponse("invalid_request", { status: 405, headers: { Allow: allow } })
}
