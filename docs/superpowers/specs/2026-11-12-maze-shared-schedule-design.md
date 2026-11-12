# Maze Island — one shared event, calendar-first alerts — design

**Date:** 2026-11-12
**Status:** implemented on `feat/maze-global-schedule` (not pushed)
**Size:** project (short design, not a full plan doc)

## Intent

Maze discounts are the one maze thing players actually schedule their day around, and the bot's
ladder was wrong: it came from old guide data (20/10/30/10/10/10/10/20 offsets) and fires at
moments when nothing changes. On top of that every Discord server has to run `!maze start` itself,
so "the maze started" is known to one server and to nobody else, and there is nowhere to say
"the maze is next Thursday" ahead of time.

Goal: **the maze schedule is one platform-wide fact, seeded from the in-game monthly calendar,
corrected by the first staff member who sees the in-game countdown, and fanned out to every
subscribed server.**

## Evidence (the discount ladder)

Seven screenshots of the 5–12 Nov 2026 maze. The maze ran 5 Nov 16:30 IST → 12 Nov 16:30 IST
(168 h = 7 days). Every banner countdown lands on a whole hour from the start, to within ~30 s:

| hours after start | discount | in the November maze |
|---|---|---|
| 0 – 5 | 50% | Thu 16:30 → Thu 21:30 |
| 5 – 13 | 20% | Thu 21:30 → Fri 05:30 |
| 24 – 36 | 10% | Sat 04:30 → Sat 16:30 … first limited-time path opens at +24 h |
| 72 – 84 | 10% | second path |
| 120 – 132 | 10% | third path |
| 164 – 168 | 20% | final hours |

Discounts are **windows with real gaps** — no discount at all 13–24 h, 36–72 h, 84–120 h and
132–164 h. 30% never occurs. The old `SCHEDULE_7D` (2 h, 29 h, 48 h, 55 h, 71 h, 90 h, 135 h,
167 h) matched neither the percentages nor the change points, so every server was pinged at the
wrong times and never at the two that matter (+5 h, +132 h/164 h).

## Goals

- One `maze_events` row per real maze, shared by every server; discount times derived from its
  `event_start` (a player who joins late sees the same absolute discount times).
- The in-game monthly calendar is the primary source: the owner adds future maze weeks, and their
  alerts are armed immediately, with or without anybody starting a countdown.
- Any server's staff can paste the in-game countdown (`!maze start 7d 6d21h47m` or the dashboard)
  to confirm/correct the shared event; every subscribed server is re-armed within one sync tick
  (≤5 min) and in-flight pings for the stale schedule are dropped.
- `maze_schedules` becomes a per-server *subscription* (channel, mention mode, on/off, dedupe).
- Dashboard: interactive controls — dropdowns for mention mode and the wheels for the countdown /
  calendar date — plus a live discount timeline and an owner-only platform calendar.
- Bot and dashboard read the same ladder, with an offline check that fails on drift.

## Non-goals

- No automatic in-game detection (no game API, no OCR on a device). Every "the maze is live" fact
  enters through a human — the owner, or the first staff member who notices. A future OCR feed
  would plug into the same `maze_events` row.
- No per-server event times any more: a server either follows the shared maze or turns alerts off.
- No 3-day maze variant (the event is 7 days; the old `3d` type was removed from the UI).
- No change to player DM/@here preferences, premium gating, or the war/race cogs.

## Approaches considered

**A. Keep per-server schedules, add a shared calendar that copies into each row.** Cheapest (~150
lines), but two sources of truth that drift, and a correction still has to reach N rows.

**B. One shared event + per-server subscription (chosen).** `maze_events` is the truth; the
existing 300 s sync loop fans pings out from it. A correction is one UPDATE and the loop re-arms
everyone; `sent_pings` keys are anchored to the window start, so a moved schedule re-pings the
windows that still matter and skips the ones already announced.

**C. OCR one phone that runs the game.** Removes the human, but is a fragile Android-side project
and not needed to ship: the calendar plus one staff report per event is accurate to minutes.

**Trust model for corrections.** First report wins, last report wins after that, with a 24 h
matching window (a report within 24 h of an existing event corrects that row instead of creating a
second one). Rationale: the same trust level as the old per-server `!maze start` (any staff), the
audit columns (`confirmed_by_guild`, `confirmed_by_user`) are visible in the dashboard, and a wrong report is fixed by the next server reporting the countdown they actually see. The owner can
always override from the dashboard calendar.

## What changed

Bot:
- `bot/maze_timing.py` — new pure module: the window table, `windows()`, `current_window()`,
  `upcoming_windows()`, `windows_to_fire()`, `derive_event_start()`, `parse_remaining()`,
  `parse_start_date()`. Mirrors the ladder in the dashboard.
- `bot/tests/test_maze_timing.py` — standard-library unittest: the six windows, the gaps, the
  banner timestamp of every screenshot, countdown→start derivation, parser edge cases.
- `bot/cogs/maze.py` — reworked: loads the shared event + subscriptions, arms one task per window
  start per server, re-checks the event and premium status before sending, keeps DM alerts and
  mention modes, adds `!maze cal list|add|rm` (owner), and turns `!maze stop` into "alerts off for
  this server".
- `bot/cogs/help.py` — maze topic text.

Dashboard:
- `lib/constants.ts` — `MAZE_WINDOWS` (the ladder) and `PLATFORM_ADMIN_IDS` replace
  `MAZE_SCHEDULES`/`MAZE_TYPE_META`; `lib/format.ts` — `mazeMoments`, `currentMazeMoment`,
  `nextMazeMoment` replace `discountMoments`/`nextDiscount`.
- `lib/data.ts`, `lib/types.ts` — `MazeEvent` and the event/subscription helpers.
- `components/wheel-picker.tsx` — the scrollable number column (days/hours/minutes).
- `app/dashboard/[guildId]/maze/page.tsx` — rebuilt: shared maze + timeline, "tell the bot the maze
  started" (wheels) for staff, per-server alert settings (dropdown + channel), owner calendar.
- `app/dashboard/[guildId]/page.tsx` — overview reads the shared event.
- `scripts/check-maze.cjs` + `npm run check:maze` — compiles the TS ladder and compares it to
  `bot/maze_timing.py`; also asserts the ladder shape and the observed start offsets.

Database (`shared/schema.sql`, idempotent migration block):
- `maze_events` (start, end, type, status scheduled/confirmed/cancelled, source calendar/report,
  confirmed_by_*, note, timestamps, unique on `event_start`) + authenticated RLS policy matching
  the existing dashboard trust model.
- `maze_schedules` keeps its columns but is now documented as the per-server subscription.

## Deploy order

1. Run the updated `shared/schema.sql` in Supabase (creates `maze_events`). The bot tolerates the
   missing table (logs and stays quiet); the dashboard maze page shows an error until it exists.
2. Deploy the bot.
3. Deploy the dashboard.
4. Owner: add the next maze week on the Maze page (or `!maze cal add DD/MM`). When the maze opens,
   paste the countdown once; if the calendar was right it only flips the status to confirmed.

## Risks and limits

- The ladder is anchored to the **event start**, and the window start at +0 h is assumed to be the
  event start (a screenshot at +2 h 13 min already shows the 50% running). If the next maze shows
  the 50% starting later, only `WINDOWS_7D` / `MAZE_WINDOWS` change — one table, both languages,
  guarded by `check:maze`.
- The +24 h / +72 h / +120 h window starts assume each limited path opens on the 48 h grid the
  November event showed. If a path opens off-grid, the 10% pings are the ones that move; the
  screenshots pin the *ends*, so a correction is a one-line table edit.
- A wrong countdown pasted by staff mis-times every server until someone corrects it; the +15 min
  dashboard warning and the audit columns are the mitigation.
- `maze_events` writes are allowed to any signed-in dashboard user by RLS (the repo-wide trust model
  documented in `shared/schema.sql`); the owner-only UI is not a security boundary yet.

## Verification

- `cd bot && python3 -m unittest discover -s tests -v` — 8 tests pass.
- `cd dashboard && npm run check:maze` — PASS (and FAILs when either ladder is edited alone).
- `cd dashboard && npx tsc --noEmit` — clean; `next build` compiles and type-checks (page-data
  collection stops at the pre-existing Paddle webhook route, which needs a real service key).
- Bot files compile (`python3 -m py_compile`).
