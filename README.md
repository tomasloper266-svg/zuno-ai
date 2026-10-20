# ZUNO AI

**Every question is the start of something new.** — كل سؤال بداية لشيء جديد

ZUNO AI is an original AI-assistant web experience for coding, learning, writing, translating and
exploring — with its own visual identity: luxury charcoal surfaces in stepped elevation layers
(dark-first, warm-paper light theme), restrained electric violet / blue accents, and a Z-mark logo
whose joints end in connection nodes (connected intelligence). It is not a copy of any existing
assistant platform. The design system is documented in `docs/DESIGN.md`.

This repository contains both halves of the product: the React **frontend** (deployed to GitHub
Pages) and the Cloudflare **Worker chat proxy** (`worker/`) that owns the Gemini key. Production
builds run in **live mode** against the Worker; with no backend URL configured, the frontend falls
back to a clearly-labeled **demo mode** with scripted replies.

---

## Stack

| Layer     | Choice                                | Why                                          |
| --------- | ------------------------------------- | -------------------------------------------- |
| Framework | React 19 + TypeScript (strict)        | Maintained, typed component model            |
| Build     | Vite 6                                | Fast dev server and production builds        |
| Styling   | Plain CSS with design tokens          | Zero CSS deps; centralized `tokens.css`      |
| Highlight | highlight.js (core + 8 languages)     | Small, maintained syntax highlighting        |
| Lint      | ESLint 9 (flat config)                | typescript-eslint + react-hooks rules        |
| Backend   | Cloudflare Workers + D1 (see `worker/`) | Free-tier edge runtime; per-IP rate limiting |
| AI        | Google Gemini (`gemini-3.5-flash-lite`) | Key held server-side only                    |

Runtime dependencies: `react`, `react-dom`, `highlight.js`. That's all.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Script              | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Dev server with HMR                 |
| `npm run build`     | Type-check (`tsc`) + production build to `dist/` |
| `npm run preview`   | Serve the production build locally  |
| `npm run typecheck` | `tsc --noEmit`                      |
| `npm run lint`      | ESLint over `ts`/`tsx`              |

Node 20+ is recommended.

## Architecture

```
 Browser (GitHub Pages / Obvious iframe)
   │  POST {VITE_API_URL}/chat  { messages: [{ role, content }] }
   ▼
 Cloudflare Worker  zuno-ai-chat-proxy
   ├─ exact-origin CORS allow-list (wrangler.toml [vars])
   ├─ validation caps + per-IP rate limiting (D1, hashed IPs)
   ├─ Gemini adapter  ──►  generativelanguage.googleapis.com  (AI_API_KEY secret)
   └─ OpenAI-compatible adapter (optional alternative)
   │  200 { reply }
   ▼
 React chat UI — markdown rendering, RTL/LTR, light/dark themes
```

Deep dive: [`worker/README.md`](worker/README.md) — wire contract, error envelope, rate limits,
provider adapters, and free-tier notes.

## Live mode vs. demo mode

**Live mode (production).** Builds made with `VITE_API_URL` set talk to the real backend:

```
VITE_API_URL=https://zuno-ai-chat-proxy.tomasloper266-svg.workers.dev
```

The frontend calls `POST {VITE_API_URL}/chat` with `{ messages: [{ role, content }, ...] }` and
expects `{ reply: string }`. Live sessions show a green **Live AI** badge in the chat header, and a
privacy note under the composer.

**Privacy disclosure (shown in live mode, EN + AR):** ZUNO runs on Google Gemini's free tier —
Google may use prompts and responses to improve its products, and processing may involve human
review. Users should not send sensitive personal data.

**Demo mode (fallback).** When `VITE_API_URL` is unset (the default for `npm run dev` and any build
without the variable), replies are *scripted* and every demo message carries a visible `DEMO` tag,
an amber demo badge in the chat header, and a demo footer note. Demo replies are never presented as
output of a real AI model.

**Failure path.** Live-mode failures (network, 429 rate limit, upstream errors) surface a visible
error state with a retry button — no fake replies are substituted.

## Local development

Frontend only (demo mode):

```bash
npm install
npm run dev        # http://localhost:5173 — scripted replies, DEMO labels
```

Full stack (live against a local Worker):

```bash
# terminal 1 — Worker dev server (secrets from git-ignored worker/.dev.vars)
cd worker && npm install && npx wrangler dev

# terminal 2 — frontend pointed at the local Worker
cp .env.example .env.local   # set VITE_API_URL=http://localhost:8787
npm run dev
```

The Worker dev env allow-lists `http://localhost:5173` only. See `worker/README.md` for the
`.dev.vars` format and provider options.

## Deployment

- **Worker** (owner's Cloudflare credentials): `cd worker && npx wrangler deploy` with
  `CLOUDFLARE_ACCOUNT_ID` set and `AI_API_KEY` pushed via `wrangler secret put`. Steps and
  gotchas: `worker/README.md`.
- **Frontend (GitHub Pages)**: `npm run build` with `VITE_API_URL` set (relative asset base is
  already configured), then force-push the `dist/` contents to the orphan `gh-pages` branch using
  a temporary worktree. Pages serves `https://tomasloper266-svg.github.io/zuno-ai/` from that
  branch.

**Security notes:** provider secrets live only in Obvious Secrets and are injected to
`wrangler secret put` / `wrangler deploy` — they are never committed, never placed in frontend
code, and never set as `VITE_*` variables. Everything bundled into a frontend is public; the
bundle contains only the Worker's public URL. CORS is an exact-origin allow-list (`wrangler.toml`),
never `*`.

## What works (frontend scope)

- **Homepage** — hero with animated "connected nodes" canvas, functional chat input, four entry
  points (Coding / Learning / Writing / Explore), theme + language controls.
- **Chat** — collapsible sidebar, new-chat button, conversation history, user/assistant bubbles,
  responsive composer (**Enter** to send, **Shift+Enter** for a new line), typing indicator,
  error + retry states, copy-answer, regenerate.
- **Code rendering** — fenced code blocks with syntax highlighting, per-block copy button,
  horizontal scrolling inside the block (no page overflow).
- **Bilingual** — Arabic (RTL) and English (LTR), switchable at runtime; logical CSS properties and
  `dir`-aware layout mirror automatically.
- **Theming** — dark (default) and light, from centralized design tokens.
- **Accessibility** — focus-visible outlines, aria labels, `inert` sidebar, IME-safe Enter handling.
- **Reduced motion** — the node animation renders a static frame and transitions are disabled.

## What this build intentionally does NOT do

- **No authentication, no cloud storage.** Conversation history lives in `localStorage` of this
  browser only.
- **No streaming yet.** Live replies arrive as a single `{ reply }` payload (SSE is the natural
  next step).
- **No per-user accounts.** Rate limiting is per IP at the Worker, not per user.

## Project structure

```
src/
├── App.tsx              # view switching (home/chat), theme, language, dir handling
├── main.tsx
├── types.ts             # Message, Conversation
├── i18n/strings.ts      # EN + AR dictionaries
├── lib/
│   ├── engine.ts        # demo engine + optional live API hook (IS_DEMO)
│   ├── markdown.tsx     # minimal markdown renderer (fences, bold, inline code, quotes)
│   └── util.ts          # ids, clipboard
├── hooks/               # useLocalStorage, useReducedMotion
├── components/          # ZunoLogo (Z mark), NodeField (canvas), Controls
├── chat/                # Sidebar, MessageBubble, Composer, CodeBlock
├── views/               # Home, Chat
└── styles/              # tokens.css (design tokens), base/home/chat.css
worker/                  # Cloudflare chat proxy (see worker/README.md)
```

## Recommended next milestone

1. Streaming replies (SSE) through the Worker for a faster first token.
2. GitHub Actions CI running `typecheck + lint + build` on every push.
3. Frontend unit/integration tests (Vitest + Testing Library) for `engine`, `markdown`, and
   Composer keyboard behavior; then Playwright smoke tests against the Pages build.
4. Optional: PWA shell (install + offline static shell).
