# Design notes

Two different things live here. Read this before touching either.

- `DESIGN.md` (one level up) is the **source of truth** for the shipped war board system:
  palette roles, type scale, grid, shape, motion. It describes what is live.
- This folder holds **audit and proposal artifacts**, not shipped code. The overview proposal
  below has since been implemented — see "Status".

## Live audit — `LIVE-AUDIT.md`

Measured against the deployed site (<https://drlohithealth.com>) on 10 Nov 2026:

| Check | Result |
|---|---|
| Horizontal overflow @ 390 / 768 / 1280 / 1440 | 0 px |
| LCP / CLS | 1.48 s / 0.0006 |
| Transfer / requests | 285 KB / 14 |
| Skip link, `:focus-visible`, `prefers-reduced-motion` | present |
| Raster images | 0 (hero board is live HTML/CSS) |
| `mono-label` contrast | 7.4:1 |

## Overview proposal — `overview-proposal.html`

A static mockup of the inner overview screen composed on the same system the landing page uses:
the 48-hour war clock as the page spine, attack pips from the hero board, ruled mono rows for maze
windows, accent reserved for live / next / primary action. Desktop and mobile renders in `assets/`.

```sh
open overview-proposal.html      # macOS
xdg-open overview-proposal.html  # Linux
```

It is a mockup: fonts load from Google Fonts, and all data is sample data.

## Status — implemented (10 Nov 2026)

The spine half of the proposal is now shipped:

- `components/war-spine.tsx` — the live war board: real phase, countdown, 48h rail, and the
  missing / excused / logged counters, built from the same `.war-board` / `.rail` / `.board-count`
  styles as the landing hero.
- `app/dashboard/[guildId]/page.tsx` — the spine sits under the page header; the duplicate war
  stat card and war detail card are gone; plan / race / maze stats remain and the detail cards are
  a three-up grid.
- `app/globals.css` — `.board-clock--page` scales the clock for in-app use, plus coarse-pointer
  min-heights on the phase switch.
- `components/landing.tsx` — footer links and the desktop nav now clear 40 px hit areas.

Still open: the attack-log pips per player (needs a per-player attacks-required value from the bot),
and the maze rows keep their current card until that section is reworked.
