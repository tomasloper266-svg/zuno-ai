import { describe, expect, it } from "vitest"
import { SELF } from "cloudflare:test"

const ALLOWED = "https://app.example.test"
const OTHER = "https://other.example.test"
const DISALLOWED = "https://evil.test"

describe("GET /health", () => {
  it("returns 200 { ok: true }", async () => {
    const res = await SELF.fetch("https://worker.test/health", { method: "GET" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it("echoes an allow-listed origin exactly", async () => {
    const res = await SELF.fetch("https://worker.test/health", {
      headers: { Origin: ALLOWED },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED)
    expect(res.headers.get("Vary")).toContain("Origin")
  })

  it("echoes the second allow-listed origin exactly (no wildcard)", async () => {
    const res = await SELF.fetch("https://worker.test/health", {
      headers: { Origin: OTHER },
    })
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(OTHER)
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*")
  })

  it("blocks disallowed origins with 403 and no CORS headers", async () => {
    const res = await SELF.fetch("https://worker.test/health", {
      headers: { Origin: DISALLOWED },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("allows requests without an Origin header (non-browser clients)", async () => {
    const res = await SELF.fetch("https://worker.test/health", { method: "GET" })
    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})

describe("CORS preflight", () => {
  it("returns 204 with exact origin and method headers for allowed origins", async () => {
    const res = await SELF.fetch("https://worker.test/chat", {
      method: "OPTIONS",
      headers: { Origin: ALLOWED, "Access-Control-Request-Method": "POST" },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED)
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST")
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type")
    expect(res.headers.get("Access-Control-Max-Age")).toBeTruthy()
  })

  it("rejects preflights from disallowed origins with 403", async () => {
    const res = await SELF.fetch("https://worker.test/chat", {
      method: "OPTIONS",
      headers: { Origin: DISALLOWED, "Access-Control-Request-Method": "POST" },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull()
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })
})

describe("routing", () => {
  it("returns the error envelope (not HTML) for unknown paths", async () => {
    const res = await SELF.fetch("https://worker.test/nope", { method: "GET" })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })

  it("rejects wrong methods on known paths", async () => {
    const res = await SELF.fetch("https://worker.test/chat", { method: "GET" })
    expect(res.status).toBe(405)
    expect(res.headers.get("Allow")).toContain("POST")
    expect(await res.json()).toEqual({ error: { code: "invalid_request" } })
  })
})
