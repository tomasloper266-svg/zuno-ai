# ZUNO AI

**Every question is the start of something new.** — كل سؤال بداية لشيء جديد

ZUNO AI is an original AI-assistant web experience for coding, learning, writing, translating and
exploring — with its own visual identity: deep graphite surfaces, restrained electric
cyan / turquoise / violet accents, and a Z-mark logo whose joints end in connection nodes
(connected intelligence). It is not a copy of any existing assistant platform.

This repository contains the **frontend milestone** (v0.1.0): a real, working interface — not a
mockup — running in a clearly-labeled demo mode until a backend is connected.

---

## Stack

| Layer     | Choice                                | Why                                          |
| --------- | ------------------------------------- | -------------------------------------------- |
| Framework | React 19 + TypeScript (strict)        | Maintained, typed component model            |
| Build     | Vite 6                                | Fast dev server and production builds        |
| Styling   | Plain CSS with design tokens          | Zero CSS deps; centralized `tokens.css`      |
| Highlight | highlight.js (core + 8 languages)     | Small, maintained syntax highlighting        |
| Lint      | ESLint 9 (flat config)                | typescript-eslint + react-hooks rules        |

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

## Demo mode vs. live mode

Out of the box ZUNO runs in **demo mode**: assistant replies are *scripted* and every demo message
carries a visible `DEMO` tag, a demo badge in the chat header, and a footer disclosure. Demo replies
are never presented as output of a real AI model.

To connect a real backend, copy `.env.example` → `.env.local` and set:

```
VITE_API_URL=https://your-backend.example.com
```

ZUNO will then call `POST {VITE_API_URL}/chat` with `{ messages: [{ role, content }, ...] }` and
expects `{ reply: string }` back. Failures surface a visible error state with a retry button.

**Security note:** never place private API keys or provider secrets in frontend code or `VITE_*`
variables — everything bundled into a frontend is public.

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
- **No live AI model.** Demo mode is labeled as such everywhere.
- **No public deployment yet.**

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
```

## Recommended next milestone

1. Wire a real chat backend (streaming/SSE preferred) behind the existing `engine.ts` contract.
2. Add GitHub Actions CI running `typecheck + lint + build` on every push.
3. Add unit tests (Vitest + Testing Library) for `engine`, `markdown`, and `Composer` keyboard
   behavior; then Playwright smoke tests.
4. Optional: PWA shell (install + offline static shell) once the backend lands.
