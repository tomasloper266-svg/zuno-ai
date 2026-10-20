# ZUNO AI Chat Proxy (Cloudflare Worker)

Backend for the ZUNO AI frontend. The frontend (GitHub Pages) calls this Worker,
which owns the AI provider key and calls Gemini server-side — no secret ever
reaches the client. Built for Milestone 1: validation, rate limiting, provider
adapters, safe errors. **Free tiers only** (Workers free plan, D1 free tier,
Gemini free tier via Google AI Studio).

## Wire contract

Matches `src/lib/engine.ts` in the frontend exactly:

```
POST /chat
Content-Type: application/json
{ "messages": [ { "role": "user" | "assistant", "content": "..." }, ... ], "stream": true }

→ 200 { "reply": "..." }                     (stream absent or false)
→ 200 text/event-stream                      (stream: true — see below)
```

```
POST /title
Content-Type: application/json
{ "user": "<first user message>", "assistant": "<first assistant reply, optional>" }

→ 200 { "title": "..." }   — a 3–6 word title in the user's language
```

```
GET /health → 200 { "ok": true }
```

Validation caps: 1–20 messages, 1–4000 chars per message, ≤8000 chars total,
roles limited to `user`/`assistant`, `stream` must be a boolean when present,
unknown fields dropped, body capped at 32 KiB before parsing. Requests without
an `Origin` header (non-browser clients) are allowed; browser requests must
come from an allow-listed origin.

## Streaming (SSE)

With `"stream": true` the reply arrives as an unbuffered `text/event-stream`
(CORS headers behave exactly as on the JSON shape):

```
event: delta
data: {"text":"..."}

event: done
data: {"reason":"stop"}
```

- Concatenate `delta` texts in arrival order — they form the full reply.
- Everything before the stream starts — validation, rate limiting, and the
  provider's pre-flight (its response headers) — happens first. A failure up to
  that point is a normal JSON error with an honest status, never a stream.
- Once streaming has begun (200 committed), a failure is one final
  `event: error` with `data: {"error":{"code":"..."}}` (codes from the table
  below), then the stream closes — never a half-open stream.
- A client disconnect aborts `request.signal`; the Worker cancels the provider
  request upstream and stops pulling deltas — no orphaned generation.
- The whole provider interaction — pre-flight plus every delta — rides a 60 s
  deadline (`src/providers/timeout.ts`): when it fires, streaming ends with one
  `event: error` carrying code `provider_timeout`, the same shape as any other
  mid-stream failure.
- Gemini is streamed via `:streamGenerateContent?alt=sse` (text parts pass
  through as deltas); OpenAI via `"stream": true` chat completions, with
  `data: [DONE]` ending the stream.
- A client that sent `stream: true` to a backend predating this flag still gets
  a JSON `200 { reply }` and falls back to a single delta (`src/lib/engine.ts`).

## Conversation titles (POST /title)

ChatGPT-style titles: the frontend calls `/title` **once per conversation** after the
first exchange commits. The body carries the first user message (`user`, required,
≤2000 chars) and the first assistant reply (`assistant`, optional, ≤1000 chars);
the body is capped at 4 KiB before parsing. CORS, the error envelope, and the
provider adapter stack are exactly the ones `/chat` uses.

- The system prompt is strict: a 3–6 word title in the user's language, no quotes,
  no surrounding punctuation, no prefixes like "Conversation about" / "محادثة عن".
  `maxOutputTokens: 24`, temperature `0.2`.
- The reply is sanitized server-side (wrapping quotes and trailing periods
  stripped, hard-capped at 80 code points on a word boundary). A whitespace-only
  model reply is a provider failure (`502 upstream_error`), not an empty success —
  the client keeps its local heuristic title on any failure, silently.
- Rate limiting uses an **independent bucket**: same windows and limits as
  `/chat` (10/min, 60/day) but keyed separately (`titleLimiterKey`), so title
  traffic never consumes chat quota and vice versa. The D1 schema pins the
  `window` values with a CHECK constraint and deploys apply no migrations, so
  the bucket is separated by namespacing the key (a re-hash of the IP hash) —
  every stored key is still a pure SHA-256 digest.

## Error envelope

Clients only ever see `{ "error": { "code" } }`. Details (request id, upstream
status) are logged server-side via `wrangler tail` / Workers Logs — upstream
response bodies are never proxied.

| Code              | Status | Meaning                                                            |
| ----------------- | ------ | ------------------------------------------------------------------ |
| `invalid_request` | 400    | Validation failed (also 403 wrong origin, 404, 405)                |
| `rate_limited`    | 429    | Per-IP limit hit (or provider rate-limited us); `Retry-After` set  |
| `upstream_error`  | 502    | Provider failed or returned garbage                                |
| `over_capacity`   | 503    | Provider overloaded, or an unexpected internal failure             |
| `config_error`    | 500    | Missing/bad `AI_API_KEY`, unknown `AI_PROVIDER`, bad model          |
| `provider_timeout`| 504    | Provider exceeded its 60 s deadline (see "Timeouts & watchdog")     |

## Timeouts & watchdog

- **Worker → provider:** every provider call — `/chat` (both shapes) and
  `/title` — runs under a **60 s** deadline (`PROVIDER_TIMEOUT_MS`,
  `src/providers/timeout.ts`). The timer aborts the upstream `fetch`; a
  `timedOut` flag distinguishes it from a client disconnect, so a gone caller
  logs `client_disconnected` while a frozen provider logs `provider_timeout`
  and answers `504 { error: { code: "provider_timeout" } }` — or, once
  streaming has begun, one SSE `error` event with the same code, then close.
  Timers are always disposed when the call settles; a fast provider never
  leaves one behind.
- **Client watchdog:** the frontend (`STREAM_WATCHDOG_MS` in
  `src/lib/engine.ts`) auto-cancels a live stream that produces no data — no
  delta, no done, no error — for **30 s**; any received event rearms the
  clock. The partial text already shown is kept and committed; a watchdog
  cancel with zero text shows the usual recovery banner. 30 s sits inside the
  Worker's 60 s, so the Worker normally reports first and the watchdog only
  covers connections that never deliver its error event.

## Rate limiting

Per client IP (`CF-Connecting-IP`, stored only as a SHA-256 hash), backed by
the D1 binding `DB`: **10 requests/minute** and **60 requests/day** (UTC
windows, both incremented per request; blocked requests count too, so retry
floods stay locked out). Over limit → `429` with `Retry-After` (seconds until
the binding window resets). `/title` runs on an independent bucket keyed
separately from `/chat` (see "Conversation titles" above). Schema lives in
`migrations/0001_rate_limits.sql`;
the test suite applies the same DDL from `test/schema.ts` — keep the two in
sync if you ever change the table.

## Provider adapters

`src/providers/` defines a `ProviderAdapter` interface and two implementations:

- **gemini** (default) — `generativelanguage.googleapis.com` `generateContent`
  (streamed via `streamGenerateContent?alt=sse`), server-side system
  instruction, `maxOutputTokens: 1024`. No tool/function calling.
- **openai** — OpenAI-compatible `/chat/completions` (`AI_BASE_URL` can point
  at any compatible endpoint; streamed with `stream: true`). Implemented
  against the same interface but not yet exercised against a live endpoint.

Switching provider is an env change, never a frontend rewrite:

```toml
# wrangler.toml [vars]  (non-secret)
AI_PROVIDER = "gemini"        # or "openai"
AI_MODEL    = "gemini-3.5-flash-lite"
```

The system prompt is fixed server-side (`src/prompt.ts`): bilingual
Arabic/English persona, replies in the user's language, user content treated
strictly as data. It is not client-configurable.

## Directory layout

```
worker/
  wrangler.toml          # non-secret config only (D1 binding w/ placeholder id, vars)
  .dev.vars.example      # template for local secrets → copy to .dev.vars (git-ignored)
  migrations/0001_rate_limits.sql
  src/
    index.ts             # routing, CORS, error envelope
    chat.ts              # POST /chat pipeline: validate → resolve provider → rate limit → generate
    title.ts             # POST /title pipeline: validate → own rate-limit bucket → generate → sanitize
    validate.ts          # strict body validation
    prompt.ts            # fixed system prompt
    ratelimit.ts         # D1 counters, SHA-256 IP hashing
    http.ts              # envelope + CORS helpers
    env.ts               # Env bindings
    providers/           # adapter interface, factory, gemini, openai, SSE reader
  test/                  # vitest (@cloudflare/vitest-pool-workers), local D1
```

## Secrets flow

- `AI_API_KEY` is the only secret. It is **never** in `wrangler.toml`, never in
  any committed file. Production: `wrangler secret put AI_API_KEY`. Local dev:
  copy `.dev.vars.example` → `.dev.vars` (git-ignored) and fill it in.
- `wrangler.toml` holds only non-secret config. The D1 `database_id` and
  `account_id` are identifiers, not secrets; the D1 database `zuno-ratelimit`
  was created at deploy time.

## Local development

```bash
cd worker
npm ci                           # or npm install
cp .dev.vars.example .dev.vars   # then put a real Gemini key in it

npm run dev                      # wrangler dev --env dev (localhost:5173 origin allowed)
curl http://localhost:8787/health   # → {"ok":true}
```

## Tests & quality gates

All three must pass before every commit (they run against local D1 via
miniflare — no Cloudflare account needed):

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest run (validator, rate limiter, adapters, CORS, contract)
```

## Deployment (needs the owner's Cloudflare credentials)

```bash
cd worker
npx wrangler login                          # one-time
npx wrangler d1 create zuno-ratelimit       # prints a database_id — paste it into wrangler.toml
npx wrangler d1 execute DB --remote --file=migrations/0001_rate_limits.sql
npx wrangler secret put AI_API_KEY          # paste the Gemini API key when prompted
npm run deploy                              # wrangler deploy
curl https://zuno-ai-chat-proxy.<account>.workers.dev/health
```

Then point the frontend at it: set `VITE_API_URL=https://zuno-ai-chat-proxy.<account>.workers.dev`
at frontend build time (this `worker/` change does not touch the frontend).

`ALLOWED_ORIGINS` in `wrangler.toml` currently lists
`https://tomasloper266-svg.github.io` and the Obvious hosted preview origin;
`localhost:5173` is allowed in the `dev` env for local development.

## Free-tier notes & limitations

- Uses only free-plan capabilities: Workers free tier, D1 free tier, Gemini
  free tier. No paid feature or billing is enabled anywhere in this setup.
- Rate-limit counters include rejected requests (protects the provider quota);
  counters reset on fixed 60s/UTC-day windows.
- CORS is browser-enforcement only; requests without an `Origin` header are not
  blocked (rate limiting is the abuse guard for non-browser traffic).
- The `openai` adapter is untested against a live endpoint.
- No conversation persistence and no auth/accounts.
