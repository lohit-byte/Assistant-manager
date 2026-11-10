# Design notes

Two different things live here. Read this before touching either.

- `DESIGN.md` (one level up) is the **source of truth** for the shipped war board system:
  palette roles, type scale, grid, shape, motion. It describes what is live.
- This folder holds **proposal and audit artifacts**, not shipped code.

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

Open gaps: inner dashboard screens inherit tokens but not the board composition; a few landing
touch targets are 28–36 px tall; no current capture of the auth-gated overview exists.

## Overview proposal — `overview-proposal.html`

A static mockup of the inner overview screen composed on the same system the landing page uses:
the 48-hour war clock as the page spine, attack pips from the hero board, ruled mono rows for maze
windows, accent reserved for live / next / primary action. Desktop and mobile renders in `assets/`.

```sh
open overview-proposal.html      # macOS
xdg-open overview-proposal.html  # Linux
```

It is a mockup, not the app: fonts load from Google Fonts, and all data is sample data. It is not
wired into any route and is not deployed.
