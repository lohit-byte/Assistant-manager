# One-stop team setup, attack log and war + race rating

- Date: 2026-11-10
- Repo: `Assistant-manager` (working tree `/root/work/am-main`, branch `deploy-fix`)
- Status: draft for owner approval

## Intent and why

The product is a Discord bot + web dashboard for Monster Legends alliances. The owner
runs several teams per server and wants:

1. **One stop** — team setup and the live overview on one dashboard page instead of
   bouncing between Settings, War, Race and Maze.
2. **Alias rename** — edit an alias in place instead of delete + re-add.
3. **"I attacked" button** — the war missing list is the owner's most important feature;
   a missing player should log an attack with one tap, and staff should see the
   self-reports on the dashboard.
4. **War + race score and rating** — Monster Legends already shows war participation %
   to everyone, so re-showing that adds nothing. The alliance's differentiator is one
   activity rating that combines war attacks with race contributions.
5. **Bundled node sheet** — the owner will make one `nodesheet.json`, upload it to the
   bot host (Wispbyte) directly, and every server should be able to use it without
   uploading a sheet per server.
6. **Per-team captains** — a captain assigned to a team acts as staff for that team.

## What the code does today (findings)

- **Dashboard** is Next.js App Router, client-side Supabase with the anon key.
  `components/guild-shell.tsx` decides access: Discord Manage Server/Admin = staff;
  a premium server's alias member = read-only. Overview reads the first active war and
  the first `race_state` row. Settings edits one war/race/maze channel and one staff
  role on `guilds`. War and Race pages already accept `?channel=`, list channels and
  Race can edit sheet JSON in the browser.
- **Bot**: `wars` rows (keyed by channel) and `race_state` rows (keyed by channel) are
  the real team state. Typing `attacks done` in a war channel self-logs
  `wars.attack_counts`; a staff ❌ reaction undoes the missing-list removal. The bot
  maintains a live war board and reminder messages. Race actions (OFA claim/done, DYP,
  JE) write `race_logs` with `guild_id`, `discord_id`, `player_name` — no channel.
  Race sheets live in `race_sheets` per guild; `!race next` auto-advances only when
  `active_race_sheet` is set.
- **Staff** = guild admin/manage-guild or a role in `guilds.leader_role_id` /
  `colead_role_id` / `staff_role_id` (`database.is_staff_member`, 60 s cache).
  There is no captain concept, and no table links a team's war channel to its race
  channel. `max_teams` is checked independently per event type.
- **War history**: `attack_counts` lives only on the current war row; the next war
  replaces it. `race_logs` persists but is guild-scoped.
- **Tests**: offline pytest suite with fake Discord + fake Supabase (65 passing when
  `python3-pytest` and `python3-discord` are installed in this PRoot); dashboard is
  checked with `npx tsc --noEmit`.

## Goals

1. Overview page becomes the one-stop page: server + team + captain setup (staff only)
   plus a live snapshot per team; read-only members see only the snapshot.
2. A `teams` row pairs a team's war channel and race channel, has a name and team role,
   and owns its captains. Existing servers with no teams keep working.
3. Captains act as staff only for their own team: bot commands in that team's channels,
   dashboard management for that team. Never settings, billing, aliases, maze or other
   teams.
4. Alias rename in dashboard and bot, without losing the current war's counts or lists.
5. One-tap "I attacked" with a durable `war_logs` record so staff can audit self-reports;
   the existing text command keeps working.
6. Combined war + race activity **score (0–100) and grade** per player per team, visible
   to everyone who can open the server dashboard; raw log detail for staff/captains.
7. One bundled `nodesheet.json` on the bot host used as the default race sheet for every
   server, overridable per server.
8. No new runtime dependencies; offline bot tests stay offline.

## Non-goals

- No billing, paywall or plan-enforcement changes (team limit stays UI copy + the
  existing bot `check_team_limit`).
- No OCR changes and no maze feature changes; maze stays guild-level staff-only.
- No change to the trust model: the dashboard still uses the anon key and captain
  scoping is UI-level, matching how staff/read-only access works today. RLS for new
  tables mirrors the existing "authenticated" pattern.
- No cross-war or seasonal rating history beyond the current war + 7-day window.
- Aliases stay guild-wide and staff-managed; no per-team aliases.
- No deployment automation. Owner runs SQL, redeploys the bot and the dashboard.

## Anti-goals (failure even if it works)

- Presenting in-game participation % as the headline.
- Members seeing or using setup controls.
- Making servers upload a sheet again after rollout.
- Losing a player's current war counts/lists because their alias was renamed.
- Double-counting the same attack click, or a bad nodesheet file crashing the bot.

## Constraints

- Discord OAuth does not expose a user's role list to the dashboard, so captains are
  assigned by **Discord user id** (like aliases), not by role. The bot checks the same
  rows, so both sides agree.
- Bot must keep working before the SQL migration is run? No — new features need the new
  tables; the bot must degrade gracefully (log and continue) if a team/captain lookup
  fails, so war/race still work.
- Rust-free stack: no new Python/Node packages.

## Approaches considered

### 1. Team model

- **A (chosen)** — additive `teams` + `team_captains` tables. Existing war/race rows stay
  keyed by channel; the bot resolves channel → team only for captain checks; the
  dashboard creates/edits teams and can import channels it already sees. Smallest change
  that gives captains a stable identity.
- **B** — derive teams from channel pairs with no table: no place for names/captains;
  every page re-derives pairs and captain checks need another source. Rejected.
- **C** — one settings row per channel: duplicates the war/race pairing and still needs a
  captain table. Rejected as messier than A.

### 2. Attack capture

- **A (chosen)** — persistent Discord button ("✅ I attacked", fixed `custom_id`,
  registered on startup, attached to war announcements/board/reminders). Each press
  inserts a signed `war_logs` row and bumps `attack_counts`.
- **B** — dashboard-only button: players live in Discord, so adoption would be worse and
  staff would still lack Discord-side input.
- **C** — keep the text command only: already exists, but one tap is the owner's priority.

### 3. Rating

- **A (chosen)** — one score 0–100 + grade from war attendance (60 %) and race task count
  (40 %) over the current war window (7-day fallback).
- **B** — war-only rating: duplicates the in-game participation %.
- **C** — raw counts side by side: no rating; owner asked for score + rating.

### 4. Bundled node sheet

- **A (chosen)** — JSON file on disk (`nodesheet.json` in the bot's working directory,
  `NODESHEET_PATH` override), used when the channel has no active sheet. Per-server
  uploads still override.
- **B** — a global row in `race_sheets` with `guild_id NULL`: needs a constraint change
  and a SQL upload, not the Wispbyte file drop the owner wants.
- **C** — embed in the Python package: harder for the owner to edit on Wispbyte.

## Design

### Schema (`shared/schema.sql`, migration section)

```sql
-- 11. TEAMS: a team pairs one war channel with one race channel and owns captains.
CREATE TABLE IF NOT EXISTS teams (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    war_channel_id BIGINT,
    race_channel_id BIGINT,
    team_role_id BIGINT, -- role pinged by this team's war announcements
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (guild_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_guild_war_channel_key
    ON teams (guild_id, war_channel_id) WHERE war_channel_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teams_guild_race_channel_key
    ON teams (guild_id, race_channel_id) WHERE race_channel_id IS NOT NULL;

-- 12. TEAM CAPTAINS: a captain is staff for their team only.
CREATE TABLE IF NOT EXISTS team_captains (
    team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (team_id, discord_id)
);

-- 13. WAR LOGS: one row per attack report (button = +1, text = delta, undo = negative).
CREATE TABLE IF NOT EXISTS war_logs (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id BIGINT NOT NULL,
    war_start TIMESTAMP WITH TIME ZONE,
    discord_id BIGINT,
    player_name TEXT,
    attacks INTEGER NOT NULL DEFAULT 1,  -- signed delta
    source TEXT DEFAULT 'self',          -- 'self' | 'staff' | 'undo'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS war_logs_channel_idx ON war_logs (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS war_logs_guild_idx ON war_logs (guild_id, created_at DESC);

-- 14. RACE LOGS get the team channel and the node they belong to. Old rows stay NULL and
-- are excluded from per-team ratings.
ALTER TABLE race_logs ADD COLUMN IF NOT EXISTS channel_id BIGINT;
ALTER TABLE race_logs ADD COLUMN IF NOT EXISTS lap INTEGER;
ALTER TABLE race_logs ADD COLUMN IF NOT EXISTS node INTEGER;
CREATE INDEX IF NOT EXISTS race_logs_channel_idx ON race_logs (channel_id, created_at DESC);

-- RLS: mirror the existing dashboard model (authenticated read/write). The bot uses the
-- service-role key and bypasses RLS. The statements are idempotent (drop + create) because
-- the owner runs this block by hand. If the live project uses stricter policies, mirror
-- those instead of the permissive ones below.
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teams_authenticated ON teams;
CREATE POLICY teams_authenticated ON teams
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE team_captains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_captains_authenticated ON team_captains;
CREATE POLICY team_captains_authenticated ON team_captains
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE war_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS war_logs_read ON war_logs;
CREATE POLICY war_logs_read ON war_logs
    FOR SELECT TO authenticated USING (true);
```

`teams.team_role_id` is the value the Setup editor owns. The bot keeps reading
`wars.team_role_id` (no announcement change): a team save upserts
`wars.team_role_id` for the team's war channel when that war row exists, and `!war`
start copies `teams.team_role_id` into a fresh war row when it has no role yet (existing
`wars.team_role_id` still wins). The War page's role control writes both. Deleted teams
leave their war/race rows alone (the dashboard warns that the team's data is kept).

### Bundled node sheet format

File: `nodesheet.json` in the bot's working directory (repo root on Wispbyte), or the path
in `NODESHEET_PATH`. Shape (same as the JSON the race page already edits):

```json
{
  "0.1": { "ofa": "OFA task text", "dyp": "DYP task text", "je": "JE task text" },
  "0.2": { "ofa": "...", "dyp": "...", "je": "..." }
}
```

Keys are `lap.node` for nodes `1..NODES_PER_LAP`. An optional top-level `"nodes"` wrapper
(`{"nodes": {...}}`) is accepted. Validation rules (used for the bundled file **and** the
per-server sheet upload/paste paths so they stay consistent):

- Whole file rejected (logged, bundled sheet ignored, bot keeps running) only when the
  top-level is not an object, or the `nodes` value is not an object.
- A single malformed node (not an object, or has non-string/missing `ofa`/`dyp`/`je`) is
  skipped with a warning; the remaining nodes stay usable.
- Node keys are accepted as `"lap.node"` strings; keys without a dot are rejected for the
  bundled file (no lap context).
- The loader caches by mtime, tolerates BOM/whitespace, and never raises into the cog.

Behavior: `!race next` (auto-advance) uses the bundled sheet when the channel has no
`active_race_sheet`; `!race use default` (alias `bundled`) selects it explicitly;
`!race sheets` lists guild sheets plus "default (bundled)". `!race newnode` is unchanged
(OCR / text input) — the bundled sheet does not silently invent task text there. Per-server
sheets always win over the bundled file. Ship `nodesheet.example.json` with two sample
nodes; the owner uploads the real file to the bot host.

### Bot

- `bot/database.py`
  - `get_team_captain_map(guild_id)` → `{channel_id: {discord_id, ...}}` from `teams`
    (war and race channels) joined to `team_captains`; 60 s cache like the role cache.
  - `is_team_staff(member, channel_id)` = `is_staff_member(member)` **or** member id in
    the channel's team captain set. `is_staff_member` stays for guild-level actions.
  - A failed lookup (table missing, network) logs and returns "not a captain"; the
    global staff path is unaffected.
- `bot/cogs/war.py`
  - Channel-scoped staff checks switch to `is_team_staff(ctx.author, ctx.channel.id)`:
    start/cancel war, board start/stop, missing/absent add/remove, `!war attacks`,
    `!war check`, `!war set role`. Warnings, `!war set attacks` stay global staff.
  - `log_attack(...)` helper inserts into `war_logs`. Text `attacks done` (delta = new
    total − old total, min 0), button (+1), staff ❌ undo (negative row). War start is
    stored on the row so logs group by war.
  - Persistent `AttackButton` view: `custom_id = "war:i_attacked"`, label
    "✅ I attacked", registered in `cog_load` via `bot.add_view`. On press: resolve the
    presser's alias (same rules as the text handler), load the war for the interaction's
    channel, cap at `attacks_required`, remove from missing at the cap, write the log,
    reply ephemeral ("Sam: 4/6 attacks recorded"). No alias → ephemeral "ask staff for an
    alias". Attach the view to the attack-phase announcement, the live board (edited
    messages keep the view) and the reminder messages.
  - Alias-rename migration helper used by admin: rewrite `attack_counts` keys and
    `missing_list`/`absent_list` names for every war row of the guild.
  - `start_timer` copies `teams.team_role_id` into a fresh war row that has no role yet
    (an existing `wars.team_role_id` still wins).
- `bot/cogs/race.py`
  - `log_race_action` gains `channel_id`, `lap`, `node` (from the current `race_state`
    row at the call site); call sites updated for OFA done, DYP, JE add/done, OFA claim.
  - Channel-scoped staff checks → `is_team_staff`: target, newnode, next, set, OFA
    approve/cancel/release, `!race use`, `!race sheets`. `!race uploadsheet` stays global
    staff.
  - `!race next` / `!race use default` fall back to the bundled sheet when
    `active_race_sheet` is empty; `!race sheets` lists guild sheets + "default (bundled)".
  - The `!race je +<amount>` loop keeps writing one row per submission; the rating dedupes
    by node (see below), so spamming it cannot inflate a score.
- `bot/cogs/admin.py` — `!alias rename <old> <new>` (global staff): update the alias row,
  migrate live war data, error on duplicate/new-missing.
- `bot/cogs/help.py` — document captain powers, `!alias rename`, `!race sheets`.
- `bot/node_sheet.py` — the loader; no discord imports so tests stay offline.
- `nodesheet.example.json`, README section, tests.

### Dashboard

- `components/guild-shell.tsx`
  - Load `teams` for the guild and the viewer's captain team ids (by Discord id from the
    session). Context gains `isStaff`, `captainTeamIds`, `canManageChannel(channelId)`
    (`isStaff || captain of the team that owns the channel`) and `teams`.
  - **Access grant:** a `team_captains` row is itself an access grant, on any plan (trial,
    premium or expired), with no alias row required. Captains therefore also appear on the
    server picker and pass the shell check; the existing premium-alias read-only rule is
    unchanged and still applies to non-captains. A captain who is also a premium alias
    member gets write on their own team and read-only everywhere else.
  - Nav: staff see everything as today; captains see Overview, War, Race only (no Maze,
    Aliases, Settings, Billing); alias members and captains of nothing stay read-only.
- `lib/data.ts` (+ `lib/types.ts`)
  - `listTeams`, `createTeam`, `saveTeam`, `deleteTeam`, `listTeamCaptains`,
    `addTeamCaptain`, `removeTeamCaptain` (upsert the `users` row first, like aliases).
  - `renameAlias(supabase, guildId, alias, newName)` — update the row then migrate the
    guild's war `attack_counts` / `missing_list` / `absent_list`; reject duplicates.
  - `listWarLogs(supabase, channelId, sinceIso, limit)`,
    `listRaceLogs(supabase, guildId, channelId, sinceIso)`.
  - `getTeamsOverview(supabase, guildId)` — teams + each team's war, race, logs and
    detected channels (`wars` / `race_state` channels not in any team).
- `lib/rating.ts` (new)
  - `computeRatings({ war, warSettings, raceLogs, aliases, required, windowStart })` → rows
    `{alias, discordId, attacks, required, raceTasks, score, grade, excused}`.
  - Window: active war `war_start`, else now − 7 days.
  - War part = `min(attacks / required, 1)`.
  - **Race tasks:** one task = one distinct `(channel_id, lap, node, player, kind)` where
    kind ∈ {OFA done, DYP contribution, JE contribution}; `ofa_claim` is not a task.
    Repeated `je_add` rows on the same node, and a claim followed by a done, count once.
    Nodes logged before the migration (NULL `lap`/`node`) fall back to one task per row.
  - Race part = `min(raceTasks / RACE_ACTIVITY_TARGET, 1)` with
    `RACE_ACTIVITY_TARGET = 10` in `lib/constants.ts`.
  - `score = round(100 * (0.6 * war + 0.4 * race))`; grades: A+ ≥ 90, A ≥ 80, B ≥ 65,
    C ≥ 50, else D. If a team has only a war **or** only a race channel, the weights are
    renormalized over the halves that exist (so a race-only team can still reach 100).
  - **Excused players:** when `war_settings.exempt_absent` is on and the player is in
    `absent_list`, they are not ranked and get no D: the UI lists them in a separate
    "Excused" group with their race task count. With `exempt_absent` off they rank
    normally (missing attacks = 0 war credit).
  - Rows = union of war `attack_counts`/`missing_list` players and race loggers (race
    rows resolved to aliases), sorted score desc then alias; excused rows after the
    ranked ones.
- `app/dashboard/[guildId]/page.tsx` — rebuild as the one-stop page:
  - Staff-only **Setup** card: server row (staff role, maze channel, plan + team limit)
    and a team editor (name, war channel, race channel, team role, captains with an alias
    picker or id input, save/delete); **Add team** disabled at `max_teams`; channels
    found in `wars`/`race_state` but not in a team shown with an "Add as team" prefill.
  - **Snapshot**: plan stat + one card per team (war phase/countdown, missing/excused,
    attacks logged, last attack time; race lap.node + OFA/DYP/JE; activity leaderboard
    top 5 with score/grade/raw numbers; links to War/Race with `?channel=`). Maze next
    discount once at the top (guild-level). Empty states: no teams, no war/race data.
  - Captains and read-only members see the same snapshot but no Setup card.
- `app/dashboard/[guildId]/aliases/page.tsx` — inline rename (pencil → input → save),
  duplicate error, success note that live war lists were updated.
- `app/dashboard/[guildId]/war/page.tsx` — gate edits on `canManageChannel`; add an
  **Attack log** card (recent `war_logs`: time, alias, +N, source) and the full team
  rating table (staff/captains).
- `app/dashboard/[guildId]/race/page.tsx` — gate edits on `canManageChannel`; show
  "default (bundled)" in the sheet picker and as the active sheet when none is set.
- `app/dashboard/[guildId]/settings/page.tsx` — delete it; its fields move into the
  Overview Setup card and the nav item goes (route deleted, no links remain).
- `components/team-setup.tsx` (new) — the team editor component; reuse `ui.tsx`.

### Permissions matrix

| Action | Staff | Captain | Read-only alias member |
| --- | --- | --- | --- |
| Overview snapshot + ratings | yes | yes | yes |
| Overview setup / teams / captains | yes | no | no |
| Dashboard War: missing/absent add-remove, attack counts, team role, attack log, End war | yes | yes (own team) | no |
| Dashboard War: attacks-required/exempt settings, warnings CRUD | yes | no | no |
| Dashboard Race: target, node text, OFA/DYP/JE fixes, select sheet, **Bundled default** | yes | yes (own team) | no |
| Dashboard Race: upload/paste sheet JSON (guild-wide `race_sheets`) | yes | no | no |
| Aliases (incl. rename), Settings, Maze, Billing | yes | no | no |
| Bot guild-level commands (`!war set attacks`, warnings, `!alias`, `!race uploadsheet`, maze) | yes | no | no |
| Bot team commands in their team's channels | yes | yes | no |

Captains are team-scoped by channel: on the War/Race pages every edit control is hidden or
disabled unless `canManageChannel(selectedChannel)` is true. A captain opening another
team's channel (or a channel not in a team) gets the read-only view. Captains cannot
create/edit teams or assign other captains.

### One-sided teams

A team may have only a war channel, only a race channel, or both (all nullable). The import
of detected channels can therefore create a half team. The team card shows the missing half
as "No race channel" / "No war channel", the rating renormalizes over the halves present,
and the War/Race links are only rendered for the half that exists.

### Rating visibility

The snapshot leaderboard (score, grade, raw numbers) is shown to everyone who can open
the server dashboard, because the point is to beat the in-game participation %.
`war_logs` raw rows (timestamps, undo/source) are staff/captain only.

### Files touched

- Bot: `bot/database.py`, `bot/cogs/war.py`, `bot/cogs/race.py`, `bot/cogs/admin.py`,
  `bot/cogs/help.py`, `bot/node_sheet.py` (new), `nodesheet.example.json` (new),
  `tests/fakes.py`, `tests/test_bot.py`, `tests/conftest.py` (fixtures).
- Dashboard: `lib/types.ts`, `lib/data.ts`, `lib/rating.ts` (new), `lib/constants.ts`,
  `components/guild-shell.tsx`, `components/server-picker.tsx`,
  `components/team-setup.tsx` (new), `components/ui.tsx` (only if a primitive is missing),
  all pages under `app/dashboard/[guildId]/` (Overview rebuilt, War/Race/aliases edited,
  settings deleted).
- Shared: `shared/schema.sql`, `README.md`, this design doc.

### Verification

- `apt install -y python3-pytest python3-discord` (PRoot has no pip); then
  `python3 -m pytest tests -q` — fully offline.
- New bot tests: node-sheet loader (valid, missing, invalid, `nodes` wrapper, one bad node),
  captain detection (captain vs staff vs plain member, channel → team mapping, cache),
  alias rename migrates war lists/count keys, attack record helper (cap, missing removal,
  log row, no-alias), button payload handling at the helper level, race log carries
  `channel_id`/`lap`/`node`, bundled sheet fallback for `!race next` / `!race use default`.
- Dashboard: `cd dashboard && npx tsc --noEmit` and `npm run build` (`.env.local` has
  build placeholders); the rating helper is pure and kept free of Supabase calls so it
  stays easy to review.
- Manual smoke after deploy: add team, assign captain, start war, press button as two
  players, rename an alias mid-war, `!race next` with only the bundled sheet, check
  overview + rating refresh.

### Rollout

1. Owner runs the migration section of `shared/schema.sql` in the Supabase SQL editor
   (new tables + `race_logs.channel_id` + RLS policies).
2. Owner drops the real `nodesheet.json` into the bot's directory on Wispbyte (or sets
   `NODESHEET_PATH`) and redeploys the bot.
3. Owner deploys the dashboard.
4. Owner opens Overview, adds teams (or imports detected channels) and assigns captains.

Notes: `war_logs` and ratings start counting at deploy time; pre-migration `race_logs`
rows have no channel and are excluded from per-team ratings. Servers with no teams keep
their current view until a team is created.

### Calls made after the builder check (owner can override)

1. **Captain access.** A `team_captains` row is a dashboard access grant on any plan, with
   no alias required; captains show up on the server picker. Premium alias read-only stays
   for everyone else.
2. **One "race task".** One distinct node contribution per player and kind (OFA / DYP / JE);
   claims and repeated `je +` rows do not inflate a score. `race_logs` gains
   `channel_id`/`lap`/`node` so this is dedupeable.
3. **Excused players.** Not ranked, no D grade; listed separately with their race tasks
   when `exempt_absent` is on.
4. **Team role owner.** `teams.team_role_id` is what Setup edits; it is synced into the
   team's `wars.team_role_id`, which the bot still reads for announcements.
5. **Dashboard control split.** Captains manage their team's activity (lists, attack
   counts, node/target, sheet selection). War settings, warnings, sheet uploads, aliases,
   maze and captain assignment stay staff-only.
6. **Migration.** RLS statements are idempotent (drop + create) because the block is run by
   hand; the permissive authenticated policies mirror the current dashboard model.
7. **Half teams.** A team may have only a war or only a race channel; the rating
   renormalizes over what exists.
8. **Bundled sheet strictness.** A bad top-level file is ignored as a whole; one bad node is
   skipped and the rest stay usable. `!race next`/`!race use default` use the bundled sheet;
   `!race newnode` keeps its OCR/text behavior.
9. **Rating numbers.** 60 % war / 40 % race, 10 race tasks for a full race half, A+/A/B/C/D
   thresholds. Constants in `lib/constants.ts`, easy to tune after feedback.

### Left to the builder

- Component boundaries/props for `team-setup.tsx` and the rating list, within existing
  design tokens.
- Exact test names/structure and which handlers can be extracted for offline tests
  (button interaction handlers should call a plain helper so tests don't need a real
  Discord interaction).
- Copy/microcopy that stays consistent with the war-board tone.
