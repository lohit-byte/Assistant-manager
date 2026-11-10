# Dashboard: existing-user sign-in, staff clarity, success feedback, light mode

Date: 2026-11-10
Status: implemented and verified (2026-11-10). One QA-found fix: Tailwind `content` now includes `lib/` so the toast CSS is generated.

## Intent

The dashboard works, but three groups of people struggle with it:

1. **Returning users** land on a page whose only header action is “Start free trial”. They
   already have a dashboard and a trial; they need a visible “Sign in” next to it.
2. **Staff** meet controls (team setup, war settings, race sheets, maze schedule, aliases,
   billing) with uneven explanations. They need helper text at the point of action.
3. **Staff** cannot always tell whether a write worked. Green inline alerts exist on some
   pages and not others, and they sit far from the button that was pressed.

The dashboard is also a dark, high-contrast “war board”. Staff asked for a lighter, calmer
reading mode, switchable from settings.

## Goals

- A visible Discord **Sign in** entry point next to **Start free trial** on the landing page
  (header, hero, finale, mobile menu) plus helper text that explains the difference.
- Helper text next to every staff write action: what it changes, where it shows up, what to
  enter, and what happens next.
- An unmistakable **success notification** for every successful staff write, in addition to
  (not instead of) inline error messages.
- A **Light / Dark / System** appearance setting under a new dashboard **Settings** page,
  applied instantly, persisted per browser, and remembered before first paint.

## Non-goals

- No change to auth mechanics: both CTAs use the same Discord OAuth flow and scopes.
- No change to billing providers, bot behaviour, database schema or RLS.
- No redesign of page structure or navigation hierarchy beyond adding Settings.
- No per-server theme: appearance is a personal browser preference.

## Anti-goals

- Looking like a generic bootstrap dashboard. The light theme keeps the warm board palette
  (bone paper, matte panels, signal orange), not blue-grey SaaS styling.
- Success messages that the user can miss (tiny footer text), or that require dismissal for
  routine writes.
- A theme switch that flashes the wrong theme on load or breaks contrast in either mode.

## Approaches for light mode (considered)

1. **Per-component overrides** (`dark:` variants on every class). Rejected: hundreds of edits,
   high regression risk, and light mode would drift as pages change.
2. **Invert filter on the shell.** Rejected: wrecks images, avatars, brand colours, and
   produces muddy orange; not a designed theme.
3. **CSS-variable palette** (chosen). Map every Tailwind colour token (`ink`, `slate`,
   `accent`, `steel`, `sage`, `warn`, `danger`, `white`) to `rgb(var(--token) / alpha)` and
   override the variables under `[data-theme="light"]`. Pages keep their existing classes, so
   the whole dashboard (and landing page) themes from one place. Alpha utilities
   (`border-white/[0.1]`, `bg-white/[0.02]`) keep working because `white` is itself a token.

Theme preference: `light` / `dark` / `system`, stored in `localStorage` under
`legends-theme`. A tiny inline script applies the resolved theme (`data-theme` +
`color-scheme`) before paint, so there is no flash. Default is `system`.

## Approaches for success feedback (considered)

1. **Inline green alerts only** (status quo). Rejected: present on some pages only, and easy to
   miss at the top of a long page.
2. **Global toast provider** (chosen). A `ToastProvider` in the dashboard shell exposes
   `useToast().success(message)`. Toasts appear bottom-right on desktop and bottom on mobile,
   use `role="status"` + `aria-live="polite"`, auto-dismiss after ~5 s, and can be dismissed
   with a button. Successes toast; validation and load failures stay inline next to the form.
3. Third-party toast library. Rejected: one more dependency for a 60-line component.

## Approaches for sign-in entry point (considered)

1. **Repoint “Start free trial” to a chooser page.** Rejected: adds a step for the primary
   conversion path.
2. **Second button beside the primary CTA** (chosen). Same OAuth handler, secondary button
   styling, copy “Sign in” plus one line of helper text (“Already have a dashboard? Sign in
   with Discord — same trial, same server.”). Applied in the header, hero, finale, and mobile
   menu; the footer link stays.

## What changes, file by file

| Area | Files |
| --- | --- |
| Theme tokens + pre-paint script | `dashboard/tailwind.config.ts`, `dashboard/app/globals.css`, `dashboard/app/layout.tsx`, `dashboard/lib/theme.tsx` |
| Settings page + nav | `dashboard/app/dashboard/[guildId]/settings/page.tsx`, `dashboard/components/guild-shell.tsx` |
| Toasts | `dashboard/lib/toast.tsx`, `dashboard/components/guild-shell.tsx`, `dashboard/app/globals.css` |
| Landing sign-in | `dashboard/components/landing.tsx`, `dashboard/lib/marketing.ts` |
| Helper text + success toasts | `dashboard/components/team-setup.tsx`, `dashboard/app/dashboard/[guildId]/{page,war,race,maze,aliases,billing}/…`, `dashboard/components/server-picker.tsx` |
| Minor token fixes | `dashboard/components/ui.tsx` (`text-ink-950` → `text-accent-ink`, toggle knob `paper`) |

## Decisions left to the implementer

- Exact light-theme hex values, tuned for AA contrast on `#f5efe2` paper.
- Toast copy (“Saved”, “Updated”, …) per action; keep it specific (“Team “Alpha” saved.”).
- Helper-text wording; use second person, active voice, no jargon.
- Whether a write also keeps its existing inline green alert. Rule: move the success to a
  toast, keep only red/amber validation inline (avoids double confirmation).

## Verification

- `npm run build` passes (type check + lint).
- Landing: Playwright screenshots in dark and light at 1440 px and 390 px; no console errors;
  both CTAs call the Discord OAuth URL.
- Dashboard: Playwright with mocked Supabase session/REST to screenshot Overview, War, Settings
  in dark and light; verify toasts appear for a sample write and are announced (`aria-live`).
- Keyboard: skip link, nav, theme switch and toast dismiss reachable by Tab with visible focus.
