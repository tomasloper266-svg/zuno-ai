# ZUNO AI — Design System (R1)

The single source of truth for visual decisions. R2 (home + chat experience) and
R3 (settings + responsiveness/accessibility) build on this document — read it
before adding any UI. The token file is `src/styles/tokens.css`; everything here
maps 1:1 to a token there. **Do not hardcode values that have a token.**

---

## 1. Identity

- **Dark first, charcoal luxury.** Deep blue-tinted charcoal surfaces in stepped
  elevation layers; the light theme is a warm-paper mirror with the same structure.
- **Electric violet → blue.** Primary `#7c5cff`, secondary `#4f8cff`. The gradient
  `--brand-gradient` is the only gradient in the product.
- **Typography.** Inter (Latin), IBM Plex Sans Arabic (Arabic), JetBrains Mono
  (code) — loaded in `index.html`; never introduce another family.

## 2. Color tokens (semantic)

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--bg` | `#0a0c10` | `#f7f5f2` | Page canvas (dark value pinned to the PWA manifest colors) |
| `--bg-soft` | `#0d1016` | `#f0ede8` | Sidebar / recessed panels |
| `--surface-1` | `#11141c` | `#ffffff` | Cards, composer, menus |
| `--surface-2` | `#171b26` | `#f4f1ec` | Hover fill, subtle recess |
| `--surface-3` | `#1f2532` | `#eae6df` | Deep inset (inputs, wells) |
| `--border` | cool ink @ 14% | warm ink @ 12% | Hairlines — 1px, semi-transparent |
| `--border-strong` | cool ink @ 28% | warm ink @ 24% | Emphasized hairlines |
| `--text` | `#edeef4` | `#1c1917` | Primary text |
| `--text-dim` | `#9aa3b6` | `#57534e` | Secondary text |
| `--text-faint` | `#646e85` | `#857d75` | Tertiary/meta text |
| `--accent` | `#7c5cff` | `#6544ea` | Primary identity + links + focus-adjacent |
| `--accent-2` | `#4f8cff` | `#3671e6` | Secondary accent, info/confirm tints |
| `--accent-3` | `#a78bfa` | `#7443e6` | Tertiary violet (code keywords, third tints) |
| `--danger` / `--ok` / `--warning` | status only | status only | Never decorative |

`-soft` variants (e.g. `--accent-soft`) are the 10–15% alpha tints for
backgrounds of active/selected states. `--on-accent` is always `#ffffff` — text
that sits ON an accent fill. `--focus` is one step lighter than `--accent` so
the ring stays visible against accent fills.

Compatibility: `--surface` exists as an alias of `--surface-1`. Use the numbered
form in new code.

## 3. The gradient rule (§rationed)

`--brand-gradient` (violet→blue, 135°) appears ONLY in:

1. The ZunoLogo mark and wordmark accent (`--accent` on "AI").
2. Primary actions: **New chat**, composer **Send**, home hero **Send**.
3. Active/selected state fills where the item IS the brand moment (tool items
   use their own solid accent tint instead — see §7 Modes).

Everything else is flat color. No gradient borders, gradient text outside the
hero headline accent, or gradient buttons-for-everything.

## 4. Structure

- **Radius ladder:** `--radius-sm: 10px` (buttons, inputs, menu items) ·
  `--radius: 14px` (cards, bubbles) · `--radius-lg: 20px` (composer, dialogs) ·
  `--radius-full: 999px` (pills). Nothing else.
- **Borders:** 1px `--border` by default, `--border-strong` where a surface must
  separate from a matching background (composer, jump pill, code blocks).
- **Shadows:** two-layer (contact + ambient): `--shadow-1` (cards, menus,
  drawer) · `--shadow-2` (modal dialogs) · `--bubble-shadow` / `--bubble-shadow-hover`
  (message bubbles). Never stack ad-hoc shadows.
- **Spacing:** 4px grid — `--space-1…8` (4/8/12/16/24/32/48/64). Component
  padding comes from the scale; one-off pixel values are a smell.
- **Type scale:** `--fs-xs 11.5` (meta) · `--fs-sm 13` (labels, menu items) ·
  `--fs-md 14.5` (body, composer) · `--fs-lg 16` (dialog titles) · `--fs-xl 21`
  (section headings) · `--fs-display` (hero only). Line heights `--lh-tight 1.3`
  (display), `--lh-normal 1.6` (Latin body), `--lh-loose 1.85` (Arabic body —
  connected script needs taller leading; letter-spacing must stay 0 for Arabic).
- **Z-index ladder:** `--z-sticky 10` (headers) → `--z-float 20` (jump pill) →
  `--z-overlay 30` (drawer backdrop) → `--z-drawer 40` (mobile drawer) →
  `--z-toast 60` (storage notice) → `--z-dialog 80` (modals). No raw numbers.

## 5. Motion

- One easing everywhere: `--ease-out-soft` (`cubic-bezier(0.22, 1, 0.36, 1)`).
- Durations: `--speed: 150ms` (hover/press/color) · `--speed-slow: 250ms`
  (view transitions, drawer) · `--msg-enter: 240ms` (bubble rise).
- Entrance translations are small (≤10px) and direction-agnostic (translateY or
  scale — never translateX, which breaks RTL).
- `prefers-reduced-motion: reduce` kills all animation globally (base.css) and
  `useReducedMotion()` collapses smooth scrolling — keep both intact in R2/R3.
- Performance: no `backdrop-filter` on mobile-critical surfaces, no blur >16px,
  transforms/opacity only for animation.

## 6. Focus & interaction

- Ring: `:focus-visible` → `var(--focus-ring-width) solid var(--focus)` with
  `var(--focus-ring-offset)` — global in base.css. Do not restyle per-component.
- Touch targets ≥44px on mobile (drawer rows, composer send). Hover states are
  desktop-only affordances; every hover must have a focus/active equivalent.
- Destructive actions confirm first; every dialog returns focus to its opener.

## 7. Breakpoints & modes

- Mobile breakpoint: **`max-width: 767px`** (hook `useMediaQuery('(max-width: 767px)')`).
  Below it the sidebar is a drawer with a compact top bar above the content.
- Desktop: the sidebar is docked and collapsible to an icon rail
  (`--sidebar-w: 284px` expanded, `--sidebar-rail-w: 68px` collapsed); the
  choice persists in `localStorage` key `zuno.sidebar.collapsed`.
- Launch modes (Coding / Study / Writing) each carry a light solid accent tint —
  `color-mix(in srgb, var(--accent) …)` family, NOT new hues. Mode identity is
  tint + icon, never a second gradient.

## 8. Language & direction

- Every user-facing string lives in `src/i18n/strings.ts`, bilingual (en/ar).
  Hardcoded copy in components is a defect.
- Layout uses logical properties (`padding-inline`, `inset-inline-start`,
  `border-inline-start`) exclusively — RTL must come free.
- `dir="auto"` on user-content surfaces (bubbles, titles, composer).

## 9. Adding UI in R2/R3 — checklist

1. All values from tokens.css; any new token proposed in the PR body first.
2. Bilingual strings added for every visible word.
3. Works at 360px width and with the sidebar rail collapsed.
4. Reduced-motion path verified (animations collapse to instant).
5. Both themes checked — no literal hex outside tokens.css/NodeField canvas.
6. Focus order sane, Escape closes, opener regains focus.
