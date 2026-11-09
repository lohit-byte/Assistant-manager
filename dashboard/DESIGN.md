# Legends Assistant: the war board

Planning artifact for the landing page and app shell redesign. Written before the build so later
passes stay consistent. The critic never sees this file.

## Brief

- **Subject.** Legends Assistant, a Discord bot and web dashboard for Monster Legends alliances.
  It tracks the 48-hour alliance war (24 h defence, 24 h attack), missing and excused attacks,
  race nodes (OFA, DYP, JE), maze island discount moments and player aliases.
- **Audience.** Alliance leaders and staff. They play on a phone, coordinate in Discord, and
  currently keep the war in a spreadsheet, a pinned message or their head.
- **The site's job.** Get a server admin to sign in with Discord and start the 7-day trial.
- **Constraints.** Existing Next.js 14 App Router project with Supabase auth, Discord OAuth,
  Cashfree and Paddle billing. Keep every route, permission check and payment flow working.
  Scope for this pass: the public landing page plus the app shell (sidebar, top bars, page
  header, UI primitives and design tokens). Inner dashboard screens inherit the tokens.
- **Assets.** No licensed photography or product screenshots. The hero is a live, functioning
  sample board built from the real phase logic, not a fake screenshot. Sample player names and
  counts are labelled as sample data.
- **Language.** English.

## Concept

**The site is the alliance war board.** One 48-hour clock is the spine: defence holds the first
24 hours, attack takes the last 24, and the board counts down to zero. Everything the staff has
to remember (missing attacks, excused players, race nodes, maze discounts) hangs off that clock
as pinned evidence, ruled rows and counters. The landing page shows a working board, not a
picture of one.

- **Metaphor:** the wall board in an alliance war room. Matte board, bone paper, stencil labels,
  signal-orange tape, typewriter data, hairline rules.
- **Signature:** the sample board in the hero runs on a real clock. The countdown ticks, the
  phase marker moves along the 48 h rail, and the counters read like a live shift handover. It
  is the one piece of theatre; everything else is quiet.
- **Emotion:** the first three seconds should feel like walking into a room where the war is
  already being tracked properly. Calm, legible, in control.
- **Motion verb:** tick and settle. The clock ticks in place; panels settle onto the board with
  short, weighted moves; labels snap into place.
- **Screenshot:** the hero board at 21:48 left in attack, with the phase rail half in signal
  orange and the mono counters underneath.

### Three concepts, scored 1-5

| | A. The war board (how they work) | B. The 48-hour clock (formal system) | C. The after-action report (process) |
|---|---|---|---|
| Idea | The site is the alliance's wall board, with a live 48 h clock as its spine and every tool pinned to it as evidence. | The whole page is one 48 h timeline; scrolling moves the war clock and each section is a phase marker. | The site is the debrief sheet after a war: what went missing, what the bot caught, what changed. |
| Anchor | Staff actually run a fixed 48 h war and track missing attacks on a board/spreadsheet. | The war clock is the game's own 48 h -> 0 h convention. | Staff review war results after the fact. |
| Signature | Live sample board with ticking clock and moving phase rail. | Scroll-scrubbed clock into phase sections. | Corrections and missing names revealed in red-pencil annotations. |
| Originality | 4 | 4 | 4 |
| Fit | 5 | 5 | 3 |
| Feasibility | 4 | 3 | 4 |
| Portability (lower is better) | 2 | 3 | 4 |
| Total | **15** | 15 | 15 |

Pick **A**. The live board is the only option that sells the product's actual job, and it keeps
the app's dark surface while giving the marketing page a distinct, physical language. Run the
clock as a live sample; do not fake a customer screenshot.

## Art direction

### Palette (roles)

| Role | Hex | Use |
|---|---|---|
| ground | `#0c0d0a` | page and app background, matte board |
| panel | `#12130e` | cards, sidebar, board face |
| raised | `#181a13` | row hover, input wells |
| line | `#2b2c23` | hairlines, rails, rules |
| ink | `#f1ece0` | headlines and primary text (bone, not white) |
| muted | `#a29c8e` | body and UI secondary text (7.1:1 on ground) |
| accent | `#ff6b2c` | signal: primary CTA, active phase, live dot, focus |
| steel | `#a9bccf` | defence phase and cool data |
| sage / amber / red | `#93b48a` / `#d9a94e` / `#e2604a` | semantic states only |

Accent is used rarely and meaningfully: the live marker, the primary action, the active nav
item, the phase switch. No purple or cyan gradients anywhere.

### Type

- **Display:** Archivo variable, width axis pushed to 118-125% for section headings, weight 800,
  tracking -0.035em, leading 0.95. Uppercase only for short stamps and labels.
- **Text/UI:** Archivo 400/500, 16-18 px body with 1.5 leading, 13-14 px UI.
- **Data:** JetBrains Mono 400/500 for clocks, counters, labels, coordinates and commands.
  Tabular figures everywhere a number can change.
- Sources: Google Fonts via `next/font/google`, self-hosted at build time.

### Grid and rhythm

- 12 columns, fluid gutter `clamp(16px, 2vw, 28px)`, outer margin `clamp(20px, 4vw, 64px)`.
- Content hangs from three vertical lines: col 1 (text), col 7 (media/data), col 12 (labels).
- Section families are used once each: split hero, full-width clock rail, index list, asymmetric
  command sequence, two-column FAQ, footer finale. Vertical rhythm alternates tight (48 px),
  normal (96 px) and airy (144 px) sections.
- Corner stamps: mono coordinates at the section head ("02 / WAR CLOCK") and a live dot where
  something is real (the clock, the phase).

### Shape and texture

- One radius rule: 3 px on panels and inputs, 2 px on tags. Pills only for live status dots.
- Hairline rules carry the structure; shadows are removed. A very light SVG grain (4% opacity)
  sits over the board to kill the flat digital surface. No glass, no backdrop blur, no glow.
- Tape marks on the board are drawn with flat, semi-transparent bone rectangles, never a literal
  photo texture.

### Motion language

- One ease: `cubic-bezier(0.16, 1, 0.3, 1)`. Small controls 160-220 ms, panels 420-520 ms.
- Tick: the clock updates once a second. This is the idle motion and it means something.
- Hover: labels roll up inside a clipped line; fills flood from the bottom edge; arrows travel.
  Primary targets move. Utility links only change colour.
- No scroll-jacking, no loader, no page curtain. Reduced motion removes all transitions and
  entrance movement; the clock still updates its text because it is information, not decoration.

## Composition plan

```
LANDING
├── header        wordmark | The board / How it works / Questions | Discord CTA
├── hero          h1 + lede + CTAs + trial meta   |  live war board panel  (7/5 split)
├── 02 / clock    h2 + 48h rail with defence/attack segments + 4 real facts
├── 03 / board    index list of six tools, ruled rows, mono tags
├── 04 / start    asymmetric command sequence: invite bot -> war command -> board fills
├── 05 / questions two-column FAQ, native details/summary
├── finale        "Put it on the board." + CTA
└── footer        giant wordmark, legal, colophon, disclaimer

APP SHELL
├── sidebar        mark + wordmark, server switcher, grouped nav with orange active tick,
│                  trial card, account, switch server
├── top bar        mono breadcrumb left, plan tag and support right
├── mobile         compact bar with menu, server + page, plan tag
├── page header    mono coordinate eyebrow, display title, description, actions, hairline
└── primitives     flat cards, bone text, hairline rules, orange primary actions
```

## Genericness test

If a generic model were asked for "a dashboard landing page for a Monster Legends bot", it would
produce: near-black background, purple-blue glow, a centered gradient hero, a fake browser
mockup made of divs, four equal feature cards, em dashes, "elevate your alliance". This design
does none of that. It commits to a matte board, one warm signal colour, a working sample board
with a real clock, ruled index rows, real Discord commands and a mono/stencil type system. The
genericness check is the reason the hero is a live component instead of a mockup.

## Assumptions and placeholders

- Trial is 7 days and no card is required (from `lib/constants.ts` and current copy). No pricing
  claims beyond that, because the billing catalogue is only visible inside the dashboard.
- Sample board data (server, players, counts) is fictional and labelled "sample" in the UI.
  It is not presented as a real customer or real war results.
- Permission facts: the dashboard requests Discord `identify` and `guilds`; it can only be used
  by members with Manage Server or Administrator. Both are in the existing code.
- No customer logos, testimonials, awards or usage numbers are invented.
- The hero sample clock starts at 21 h 48 m left in attack and counts down from the visitor's
  load. It is a demo of the phase logic, not a claim about any live war.
