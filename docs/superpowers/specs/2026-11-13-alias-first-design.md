# Alias-first players + row actions on the War attendance table — design

**Date:** 2026-11-13
**Status:** approved 2026-11-13 (scope widened: race feature removed; war + maze only)
**Size:** project

## Intent

Staff work the War page's **Missing attacks** table every war. Its last column is the player's
raw Discord ID — long numbers that tell a human nothing ("boring discord ids") and make the
table read as a database dump. The same numbers leak into a handful of fallbacks (`User 123…`)
in the dashboard and into two bot embeds (`!team players`, `!alias list`).

The product rule we want: **aliases are the player identity, everywhere.** A raw Discord ID is
shown only in the one place that exists to attach an ID to an alias — the **Aliases settings
page** — and accepted by configuration fields where staff must paste a channel/role ID (the
dashboard cannot resolve those names; see non-goals).

Second half of the ask: the **Discord ID column becomes row actions**. `+` opens a small menu —
**Add to missing** / **Warn player** — and the existing bin removes the player from the missing
list. The “Add Missing” dropdown above the table shrinks to a one-line fallback for players the
table can't show (guests/loans, mid-war roster changes).

## Goals

1. **War attendance table:** drop the `Discord ID` column; add an actions cell (same gate as the
   bin today: `canManage`) with a `+` menu (Add to missing / Warn player) and the existing bin
   (Remove from missing) when the player is on the missing list.
2. **Warn from a row:** `Warn player` reveals a short reason field in place, then records the
   warning through the existing `addWarning` path; toast confirms.
3. **One alias-only display rule** in dashboard and bot: show the alias; if the player has no
   alias show the words `No alias`; never a Discord snowflake and never `User <id>`.
   When an alias is *missing or not configured*, staff get a small warning toast telling them to
   finish the alias first (`!alias add @user <name>` / the Aliases page) instead of the UI
   silently showing placeholders.
4. **Keep the existing safety rules** for the missing list: refuse excused players, players who
   already reported enough attacks, and players already on the list. The bin still edits only
   `missing_list` — it must never touch attack logs.
5. **Keep the Aliases settings page and configuration paste fields unchanged** (IDs allowed).
6. Bot: `!team players`, `!alias list`, `!warning list` and `!race status` stop printing player IDs;
   command syntax is unchanged. The `!ids` / `!roles` lookup commands stay — they exist so staff can
   get the numbers that the setup paste fields need (see calls).

## Non-goals

- Replacing channel/role IDs in **Server setup / team cards** with `#channel` names. That needs
  the bot to store channel names (schema + sync) and was rejected as much bigger for little
  gain. Configuration surfaces keep their IDs; they are not player identity.
- Changing the warnings data model, or `!warning remove <ticket-id>` syntax.
- Server-side permission changes (staff scoping stays in the UI, as today).
- Restyling other tables, the attack log, or the rating table beyond the ID fallbacks.
- Unifying *which* alias a multi-alias player shows: the war table keeps its existing “alias with
  the attack reports, else alphabetically first” rule (`lib/attendance.ts`) while logs keep the
  name the bot recorded. Same person, same page, possibly two different aliases — accepted and
  documented rather than changing attendance fixtures.

## Anti-goals

- A row that says only `No alias` without any way for staff to fix it — the empty state must
  point at `!alias add` / the Aliases page, like the existing empty-table hint does.
- Removing information staff need to act: every removed ID is either replaced by an alias or by
  an explicit `No alias`, and the warn action is disabled (not silently broken) when a row has
  no Discord user behind it.
- New runtime dependencies. The menu is plain React + Tailwind.

## Constraints and evidence

- **The table sits in a scroll container** (`max-h-[360px] overflow-x-auto overflow-y-auto`).
  A floating popover anchored inside it gets clipped, so the row menu is an **inline drawer row**
  (`<tr>` with a full-width cell) rather than an absolutely positioned popover.
- **The dashboard cannot resolve Discord display names.** It only has OAuth guild metadata, so
  aliases are the only human names available client-side; the honest fallback is `No alias`.
- `addWarning` writes `warnings(discord_id, reason, issued_by)` and defaults an empty reason to
  “No reason provided”; the drawer still asks for one (staff prefer context), and the dashboard
  path does not DM the player (the bot's `!warning add` does). Keep that behaviour.
- Some attendance rows are **legacy name-only rows** (`discordId: null`) — there is no alias row
  behind them (an alias was pruned after the log/list entry was written). They keep the bin
  (cleanup must always work); their `+` drawer offers **no player actions**, only a line pointing
  at `!alias add @user <name>` plus the warning toast. This matches today's capability — the
  dashboard has no name-only add path today either — so nothing is lost by not adding one.
- Raw-ID displays found today (evidence for scope):
  - dashboard: war table `Discord ID` column; `User <id>` fallbacks in the war attack log,
    recorded warnings, race attack log, DYP contributors and OFA holder; `lib/rating.ts` rating
    rows fall back to `User <id>`; warn-player `<option>` renders `alias (id)`; team setup shows
    a captain ID chip; team card captain summary and error text fall back to `User <id>`.
  - bot: `!team players` prints `display name (id)` and `<@id>` for departed players;
    `!alias list` prints `<@id>` mentions (departed players show as unresolved mentions);
    `!warning list` names the warned player with a `<@id>` mention; `!race status` falls back to
    `<@id>` for the OFA holder; `bot/cogs/race.py:676` **stores** `f"<@{user_id}>"` in
    `race_logs.player_name`, so the dashboard prints the literal text `<@123…>` — a leak into both
    the race activity feed and the war attack log. Fix at the source and guard the dashboards
    against legacy `<@id>` names that are already stored.
  - keep: Aliases page (ID column + add field), setup/paste fields (channel, role, maze channel,
    team role), team card War/Race channel chips and the "Team Channel (id)" selector, the
    overview server ID footer, warning **ticket** numbers (`ID 12` — not a Discord ID;
    `!warning remove 12` needs them), and the explicit `!ids` / `!roles` lookup commands.

## Approaches

**A — one alias-first rule everywhere, plus the row drawer (chosen).** Add two tiny pure helpers
(`playerLabel`, `aliasForDiscordId`) and use them at every display site; extract the row actions
into one component; separately trim the bot embeds. Touches ~7 dashboard files + 4 bot files.
This is the only choice that actually satisfies "everywhere".

**B — table-only.** Drop the ID column, add `+`/bin, trim the warn dropdown. Cheap, but the
`User <id>` fallbacks and both bot embeds stay; it answers the screenshot, not the request.

**C — A plus channel names in setup.** Requires the bot to persist channel names and a schema
migration; rejected: configuration IDs are not player identity and C adds real risk for a
cosmetic gain.

## The how

### The display rule (shared, pure)

In `dashboard/lib/format.ts`:

- `aliasForDiscordId(aliases, discordId): string | null` → first alias name for that id, else
  `null` (the map is built once per render pass; pages already hold the alias list).
- `playerLabel(name, aliases, discordId): string` → the display label, with the precedence below,
  else `'No alias'`.

Label precedence for a log/warning row, in order:
1. the stored `player_name`/`reason`-row name, **if it is a real name** (trimmed, and not a raw
   snowflake or a stored `<@id>` mention — legacy rows from the old race OFA lock can contain
   literally `<@123…>`, so those count as empty);
2. `aliasForDiscordId(aliases, discord_id)`;
3. `'No alias'`.
So the bot-recorded alias keeps winning over an alphabetical lookup (a player with two aliases
must not be re-labelled in a log), and a real stored name is never thrown away.

Every display site renders according to that precedence. Applied at:

| Surface | Change |
|---|---|
| War · Missing attacks | ID column deleted, actions cell added (below) |
| War · Attack log | `playerLabel(log.player_name, aliases, log.discord_id)` |
| War · Recorded warnings | `playerLabel(null, aliases, w.discord_id)` |
| War · “Player to warn” select | option text is `alias_name` only (no ` (id)`) |
| War · Team rating | `lib/rating.ts` fallback name becomes `No alias` (it has no stored name) |
| War · page (staff, no aliases) | one warning toast on load — “add an alias first” |
| Race · Attack log | `playerLabel(log.player_name, aliases, log.discord_id)` |
| Race · DYP contributors / OFA holder | `playerLabel(null, aliases, id)` |
| Team setup · captain chip | alias only (ID chip deleted); `No alias` when the captain has none |
| Team setup · “Add captain by Discord user ID” | **kept** — it is the one config input that lets staff captain a player before they have an alias (the bot's `!team add` needs an alias; the captain row does not). Chips stay identifiable by position; the remove button's aria-label says “Remove captain N” when there is no alias. |
| Team setup · team card + errors | `No alias` instead of `User <id>` |
| Bot · `!team players` | `• alias — display_name`; departed: `• alias — ⚠️ left the server` |
| Bot · `!alias list` | `• alias → display_name`; departed suffix unchanged, mention removed |
| Bot · `!warning list` | warned player shown by alias (warnings require an alias anyway); ticket `ID n` kept |
| Bot · `!race status` | OFA holder and pending claim shown by alias; no `<@id>` fallback |
| Bot · race OFA lock log | store the alias (not `<@123>`) in `race_logs.player_name`; legacy `<@id>` names are treated as empty and resolved by `discord_id` |
| Dashboard · `lib/toast.tsx` | add the `warn` variant used for the alias nudge |

### Missing alias: clean placeholder + one nudge, never a number

- Every display site uses the alias or the words `No alias`; nothing falls back to an id.
- New `toast.warn(message, detail?)` variant in `dashboard/lib/toast.tsx` (the toast API today
  only has `success`), styled with the `warn` palette and the existing auto-dismiss/announce
  behaviour. Members never see it; it is staff-only.
- It fires in exactly two cases, so it never becomes noise:
  1. **Page load:** staff (`isStaff`) on the War page, aliases list empty → one toast per visit:
     “No aliases yet — players show by alias, not Discord ID. Add one with
     `!alias add @user <name>` or on the Aliases page.” Captains get the existing inline hint
     instead; alias management is staff-only, so the nudge is too.
  2. **Opening `+` on a legacy name-only row** (`discordId: null`): one toast — “Add an alias
     first” with the same command — and the drawer shows the same line as text; there are no
     player actions to pick, so no write can happen. The bin stays enabled.
- **Unresolved players elsewhere** (team setup, attack logs, rating rows) just render `No alias`;
  no toast per row — a log with 20 legacy rows must not fire 20 toasts.
- Toast copy and timing are checked in the row-actions component test and in a small toast test.

### War attendance row actions

**Permission gates stay exactly as they are today** — this change must not move a control
between staff and captains:
- the actions cell is shown to whoever sees the bin today: `canManage` (server staff **or** the
  captain of that team's channel);
- *Add to missing* follows the same gate as today's add control (`canManage`);
- *Warn player* is staff-only, matching the dashboard's Warnings card (`isStaff`); a captain sees
  the `+` with only *Add to missing*.

New component `dashboard/components/war-row-actions.tsx` (presentational), state owned by the
war page:

- **Actions cell** (`canManage` — staff or that team's captain, exactly like the bin today): a
  `+` button (`aria-haspopup`, `aria-expanded`,
  `aria-label="Actions for {alias}"`), plus the existing bin button when `row.onMissingList`
  (`aria-label="Remove {alias} from the missing list"`).
- **Inline drawer row** rendered directly under the clicked row (`colSpan` full width,
  `data-testid`-free), containing:
  - **Add to missing** — enabled when the player is not on the list, not excused, and below the
    attack requirement; otherwise disabled with a one-line reason. Calls the same logic as the
    current `addMissing` (refactored to take `{ alias, discordId }`).
  - **Warn player** — staff-only, enabled only when `discordId` exists; reveals a reason input +
    `Record warning` / `Cancel`. Calls the existing `addWarning` + `listWarnings`, toasts, closes.
  - `Cancel` (or Escape) closes the drawer; one drawer open at a time. Focus returns to the `+`.
- The old “Add Missing” dropdown is **kept as a compact fallback** under the table, labelled
  “Add someone not in this list — pick their alias”. Reason: the table only lists rostered
  aliases when the team has a roster, so guests/loans and mid-war roster changes would otherwise
  lose the only way to add them. It is alias-only (no numbers), collapses to one line, and is
  hidden when the attendance table already covers every alias in the server.
- The old `missingAlias` state moves with it; the explanatory hint is reworded to point at the
  row `+` first, the fallback second.
- Bin behaviour is unchanged (only `missing_list` is edited).

### Bot embeds

`bot/cogs/team.py` (roster lines), `bot/cogs/admin.py` (`!alias list`), `bot/cogs/war.py`
(`!warning list`), and `bot/cogs/race.py` (OFA holder fallback, pending-claim line, and the
`log_race_action` value at 676). All of them already have the guild member, the alias row, or the
alias lookup helper in hand, so each swap is local. `!ids` / `!roles` in `admin.py` are left alone
as the explicit configuration lookup tool.

## Verification plan

- **Pure helpers:** new `dashboard/scripts/check-labels.cjs` + `npm run check:labels` in the
  house style — alias resolution by id, label fallback, no numeric fallback.
- **Row actions:** the component is presentational, so render it in a temporary dev harness page
  at 390px (dark) and assert with Playwright: `+` opens the drawer, Add is disabled for excused
  / enough-attacks / already-missing rows, Warn is disabled without a Discord user, the reason
  field appears, callbacks fire once, and an alias-less row shows the warning toast while still
  allowing the bin. (Harness page is deleted before commit, as with the toggle fix.)
- **Bot:** two gates, both run from the repo root:
  - `python3 -m unittest discover -s bot/tests` — the maze unittest suite (22 tests, green today).
  - `python3 -m pytest tests -q` — the main bot suite. **Baseline first:** it has 14 pre-existing
    maze failures at HEAD (unrelated to this work). Record the exact failure list before touching
    anything, then require the same list (no new failures) after; do not “fix” the baseline.
  Plus new assertions for this change: `!team players`, `!alias list`, `!warning list` and
  `!race status` output contains no 17–20 digit run, and the OFA lock log stores the alias rather
  than `<@id>`. These live in repo-root `tests/` (it already has `make_ctx` / `FakeGuild`), not in
  `bot/tests/` (maze-only, no Discord fakes). The 14 pre-existing maze failures are an explicit
  out-of-scope baseline, not something to fix here.
- **Repo gates:** `npx tsc --noEmit`, `npm run build`, and every existing `check:*` script.
- **Not testable here:** the authenticated War page against Supabase (no session in the sandbox).
  The row-actions logic is verified at component level and against the existing helper
  behaviours; state it plainly in the report rather than claiming an end-to-end pass.

## Calls I made (check these while reading)

1. **Inline drawer, not a floating menu** — the table's scroll container would clip a popover.
2. **Permission gates don't move:** the actions cell and *Add to missing* follow today's bin gate
   (`canManage` = staff or that team's captain); *Warn player* stays staff-only like the Warnings
   card. Captains gain no warning power.
3. **The “Add Missing” dropdown is kept as a compact fallback** under the table (“add someone not
   in this list”), because the table only lists rostered aliases and guests/loans would otherwise
   become unaddable. It is alias-only, one line, and hidden when every alias is already a row.
4. **Log labels prefer the recorded name:** stored `player_name` → alias by Discord id →
   `No alias`; stored `<@id>` strings count as empty.
5. **Warn from the row records only** (no DM), matching the current dashboard warning path.
6. **Warning ticket numbers stay** in `!warning list`/`!warning remove` — bookkeeping ids, not
   Discord snowflakes; hiding them breaks removal.
7. **`!ids` / `!roles` stay** as the explicit staff ID-lookup tool — they are how staff obtain the
   numbers the setup paste fields need. Configuration aid, not an identity display.
8. **Race `player_name` leak is fixed at the source** (store the alias), and the dashboards treat
   legacy stored `<@id>` strings as empty before rendering, so old rows stop leaking too.
9. **Team setup channel/role IDs stay** (configuration display; replacing them is approach C).
10. **War page chrome is cleaned too:** the team-channel picker shows the team name (or
    `Channel 1/2/3…`) and the read-only team-role line says set/none; the role **input** still
    accepts an ID. This is the page in the screenshot, so it should not keep long numbers.
11. **`No alias`** is the fallback wording, matching the existing team-setup text.
12. **Alias-less rows have no player actions**, not silent ID-backed ones: opening `+` shows the
    `!alias add` line and fires the nudge toast; the bin still works so stale entries can be
    cleaned up.

## Left to the builder

Exact Tailwind classes and drawer markup; focus/escape handling details; the order of the table
columns and the drawer’s disabled-reason copy; test harness details; whether the helpers live in
`lib/format.ts` or a new `lib/players.ts` (recommended: `lib/format.ts`, it already holds `cn`,
`maskId` and the war/maze formatters); commit/branch naming under the repo’s conventional style.


## Addendum (approved): remove Race completely — War and Maze only

User decision after approval: delete the Race feature everywhere; leave nothing race-related in
code, UI copy, help text, README or marketing. Data decision: **keep old race data dormant in
Supabase** (no destructive migration; code simply stops reading/writing it).

- **Bot:** delete `bot/cogs/race.py`, `process_race_image` / OCR-only code in `bot/ocr_engine.py`,
  `bot/node_sheet.py` if only race uses it; remove race refs in `main.py` (help routing),
  `help.py`, `database.py` (race_channel_id / race_state helpers), `war.py`, `team.py`,
  `billing.py`; delete race tests in `tests/test_bot.py`.
- **Dashboard:** delete the `race/` route, nav entries, race data helpers/types in `lib/data.ts` /
  `lib/types.ts`, race logic in `lib/rating.ts` (team rating loses DYP/OFA/node inputs — keep
  only what war/maze need), race sections of `team-setup.tsx`, overview, setup, billing, pricing,
  marketing, roadmap, legal, layout metadata, constants.
- **Schema:** `shared/schema.sql` stops creating race tables / `race_channel_id` for fresh installs;
  existing databases are untouched (columns/tables remain, unused). Teams become "one war channel".
- **Alias-first scope shrinks accordingly:** all race-surface rows in the table above (race log,
  DYP/OFA, `!race status`, OFA lock log leak) become moot — the code is deleted, which also removes
  the `<@id>` leak at source.
- Historical docs under `docs/superpowers/specs|plans` for earlier work are left as history; this
  design doc and README are updated.
- Any stored `<@id>` legacy `player_name` guard still applies to **war_logs**.
