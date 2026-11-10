# Plan: dashboard light mode, sign-in entry point, helper text, success toasts

Spec: `docs/superpowers/specs/2026-11-10-dashboard-light-login-success-design.md`

## Phase 0 — baseline

- [x] Confirm `npm run build` passes on `deploy-fix` (it does).
- [x] Read every dashboard page and inventory the staff write actions and current feedback.

## Phase 1 — foundation (Lead, serial; everything else depends on it)

1. `dashboard/lib/theme.tsx` — preference type/read/apply hook; `localStorage` key
   `legends-theme`; resolves `system`.
2. `dashboard/tailwind.config.ts` — map `ink`, `slate`, `accent`, `steel`, `sage`, `warn`,
   `danger`, `white` to `rgb(var(--c-*) / <alpha-value>)`; add `accent-ink` and `paper`.
3. `dashboard/app/globals.css` — dark values for every token (must reproduce today's palette),
   `[data-theme="light"]` overrides, replace hardcoded bone/ground rgba with tokens, toast
   keyframes.
4. `dashboard/app/layout.tsx` — pre-paint theme script, `suppressHydrationWarning`,
   `color-scheme`/`theme-color` viewport, `<meta name="theme-color">` per theme.
5. `dashboard/lib/toast.tsx` — `ToastProvider`, `useToast().success`, viewport with
   `role="status"`, `aria-live="polite"`, 5 s auto-dismiss, dismiss button.
6. `dashboard/components/ui.tsx` — `text-ink-950` → `text-accent-ink`; toggle knob uses
   `paper`; check focus rings on both themes.
7. `dashboard/components/guild-shell.tsx` — Settings nav item (Account group, visible to staff,
   captains and read-only members), wrap shell in `ToastProvider`, nav item titles.
8. `dashboard/app/dashboard/[guildId]/settings/page.tsx` — Appearance (Light/Dark/System with
   live preview + helper text + success toast), Account, Server (staff), Support cards.
9. `dashboard/components/landing.tsx` + `lib/marketing.ts` — Sign in secondary CTA in header,
   hero, finale and mobile menu, helper copy; fix any `text-ink-950` tokens.

Gate: met — `npx tsc --noEmit` and `npm run build` pass; landing screenshots in both themes
(dev + production).

## Phase 2 — page wiring (independent, parallel, disjoint files)

Each worker: add helper text to every staff control (field hints, card descriptions, inline
notes), and call `toast.success(...)` on every successful write, removing the duplicate green
inline alert but keeping validation/load errors inline.

- W1 `war` + `race` pages.
- W2 `maze` + `aliases` + `billing` pages.
- W3 `team-setup` + `Overview` + `server-picker` + `staff-only`.

Gate per worker: met — `npx tsc --noEmit` passes; only assigned files changed.

## Phase 3 — verification (Lead + verifier) — done

- Build, then screenshot:
  - landing dark/light @1440 and @390;
  - dashboard Overview / War / Settings dark/light @1440 (mock Supabase).
- Check: no theme flash (script in head/before paint), AA contrast of body/helper text,
  toast announced and dismissible, focus visible on theme switch and toasts, no layout shift.
- Run the web-interface-guidelines checklist over touched files; fix high-signal findings.

## Phase 4 — ship — done

- Review full diff, update README dashboard section if behaviour changed, commit on
  `deploy-fix`.


## Outcome (2026-11-10)

- Landing: Sign in beside Start free trial in header, hero, finale and mobile menu, with helper
  copy; tablet breakpoint moved to `lg` so 640–1024 px keeps the menu.
- Settings page with Light / Dark / Match device (native radios), account, server and support
  cards; server picker also got a quick light/dark toggle.
- Theme via CSS-variable palette; pre-paint script, `color-scheme`, persisted per browser.
- 25 success toasts across setup, war, race, maze, aliases, billing and the theme switch.
- QA found and fixed one blocker: `lib/` was missing from Tailwind `content`, so the toast
  viewport rendered off-screen. Re-verified: toast on screen, dismissable, `role="status"` +
  `aria-live="polite"`, 0 console errors, text contrast ≥ 5.1:1 in both themes.
