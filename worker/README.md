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
{ "messages": [ { "role": "user" | "assistant", "content": "..." }, ... ] }

→ 200 { "reply": "..." }
```

```
GET /health → 200 { "ok": true }
```

Validation caps: 1–20 messages, 1–4000 chars per message, ≤8000 chars total,
roles limited to `user`/`assistant`, unknown fields dropped, body capped at
32 KiB before parsing. Requests without an `Origin` header (non-browser
clients) are allowed; browser requests must come from an allow-listed origin.

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

## Rate limiting

Per client IP (`CF-Connecting-IP`, stored only as a SHA-256 hash), backed by
the D1 binding `DB`: **10 requests/minute** and **60 requests/day** (UTC
windows, both incremented per request; blocked requests count too, so retry
floods stay locked out). Over limit → `429` with `Retry-After` (seconds until
the binding window resets). Schema lives in `migrations/0001_rate_limits.sql`;
the test suite applies the same DDL from `test/schema.ts` — keep the two in
sync if you ever change the table.

## Provider adapters

`src/providers/` defines a `ProviderAdapter` interface and two implementations:

- **gemini** (default) — `generativelanguage.googleapis.com` `generateContent`,
  server-side system instruction, `maxOutputTokens: 1024`. No tool/function calling.
- **openai** — OpenAI-compatible `/chat/completions` stub (`AI_BASE_URL` can
  point at any compatible endpoint). Implemented against the same interface but
  not yet exercised against a live endpoint.

Switching provider is an env change, never a frontend rewrite:

```toml
# wrangler.toml [vars]  (non-secret)
AI_PROVIDER = "gemini"        # or "openai"
AI_MODEL    = "gemini-2.0-flash"
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
    validate.ts          # strict body validation
    prompt.ts            # fixed system prompt
    ratelimit.ts         # D1 counters, SHA-256 IP hashing
    http.ts              # envelope + CORS helpers
    env.ts               # Env bindings
    providers/           # adapter interface, factory, gemini, openai stub
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
- No conversation persistence, no auth/accounts, no streaming — M1 scope.
