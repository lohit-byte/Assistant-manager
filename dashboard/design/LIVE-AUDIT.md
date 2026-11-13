# Live re-audit — after the war board redesign

**Correction.** The earlier `AUDIT.md` targeted the **pre-redesign build** (local HEAD `9307045`). The live
site is `origin/main` @ `a989b34` — *"Add conversion psychology and widen the landing promise"* (9 Nov 2026,
21:52 IST), which includes `8d5d13c` *"Redesign dashboard on the war board system"*. Every Phase 2 item in the
first audit (system font stack, indigo/cyan gradient text, glow shadows, glass) is already fixed upstream.
This file supersedes `AUDIT.md`.

Live: <https://drlohithealth.com> · source: `dashboard/DESIGN.md` (the war board system) + `dashboard/app/fonts.ts`,
`components/{brand,war-board,landing}.tsx`, `lib/marketing.ts`.

## What I measured on the live site (1440×1000, Playwright, Chromium 1248)

| Check | Result |
|---|---|
| Horizontal overflow @ 390 / 768 / 1280 / 1440 | **0 px** at every width |
| Heading order | H1 › H2 › H2 › H3 ×6 › H2 … no skips |
| LCP / CLS | **1.48 s / 0.0006** (one shift) |
| Transfer / requests | 285 KB / 14 |
| `prefers-reduced-motion` | honoured — motion wrapped in `no-preference`, plus a `reduce` block |
| Skip link + `:focus-visible` | present (`globals.css:401`, `:421`) |
| Raster images | 0 — the hero board is real HTML/CSS, not a screenshot |
| `mono-label` contrast | #a29c8e on #0c0d0a = **7.4:1** |
| Display type | Archivo 800, `font-stretch:118%` computing correctly |
| Console errors | none |

The landing is in good shape. The remaining work is not "the design is bad" — it's three specific gaps.

## Gap 1 — the inner screens are tokens-only, not board compositions

`DESIGN.md` states its own scope: *"the public landing page plus the app shell … Inner dashboard screens
inherit the tokens."* Verified in the code: `app/dashboard/[guildId]/page.tsx` is still four-up `Stat` cards +
`Metric` boxes + stacked `ProgressBar`s, and `components/ui.tsx` keeps the old tone API (`purple`, `blue`)
remapped onto `accent` / `steel`. A bridge, not a redesign.

Nothing there is broken. It just doesn't use the vocabulary the marketing page now owns: the 48-hour rail,
attack pips, ruled log rows, mono data rows, corner stamps. That's what the preview below does.

**Preview:** `overview-board.html` → `shots/overview-board.png` (1440) and `shots/overview-board-mobile.png` (390).

- The 48h war clock becomes the **page spine**: countdown, defence/attack rail with the live marker, phase
  switch, and the three counters on the same ruled surface as the hero board (tape corners included).
- The **attack log** reuses the hero's `attack-pip` rows instead of a card of numbers.
- **Maze windows** become ruled mono rows — past ones struck through, the next one in signal orange.
- Accent appears only where it means something: live dot, next window, primary action, trial.
- Roster / Clock / Plan stack as ruled panels; the page ends on a stamp row (`FIG. 02 / OVERVIEW`), no dead band.
- Mobile: single column, spine first, everything still mono-aligned; no horizontal overflow (390 → 0 px).

## Gap 2 — touch targets on the live landing

Measured at 390 px: nav items **36 px** tall, footer links **32 px**, the DEFENCE/ATTACK toggle **28 px**, the
`Start` nav item **28×36**. WCAG 2.2 AA (min 24×24) passes; the practical bar for "phone in one hand, war running"
is 44. Raise `.board-switch button` and footer link padding by ~6 px.

## Gap 3 — no current dashboard capture

`/dashboard/*` is auth-gated (verified: 302 → `/`), so I can't screenshot the live overview. Send one shot of the
live overview and I'll produce a true before/after and score it the same way as the landing.

## Next

Two options:
1. **Implement the overview composition** (touches `app/dashboard/[guildId]/page.tsx`, plus a small `WarSpine`
   component reusing the war-board rail styles).
2. **Extend the spine to war / maze** first, then the overview inherits it.

Either way it's an additive pass on the live system — no new palette, no new fonts, no route or data changes.
