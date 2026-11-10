# Team setup, attack log and war + race rating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the one-stop Overview setup + per-team snapshot, team captains as scoped staff, alias rename, the "I attacked" button with a durable war log, the combined war+race rating, and the bundled race node sheet.

**Architecture:** Additive Supabase tables (`teams`, `team_captains`, `war_logs`, plus `race_logs.channel_id/lap/node`) so existing channel-keyed war/race rows keep working. The bot resolves channel → team only for captain checks, writes attack logs on every self-report, and reads a bundled `nodesheet.json` when a channel has no active sheet. The Next.js dashboard loads teams/captains once in the guild shell, gates every edit control on staff-or-team-captain, and renders a pure rating helper over the bot's stored rows.

**Tech Stack:** Python 3 / discord.py (offline fake-based pytest suite), Next.js 14 App Router / TypeScript / Tailwind, Supabase Postgres (anon key client-side, service role in the bot). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-10-team-setup-overview-design.md`

## Global Constraints

- No new Python or npm dependencies.
- Bot tests must stay fully offline (no Discord/Supabase/OCR keys, no network). Run with `python3 -m pytest tests -q`; this PRoot needs `apt install -y python3-pytest python3-discord` first.
- Dashboard must pass `npx tsc --noEmit` and `npm run build` (`.env.local` holds build placeholders).
- Write scopes: bot executor owns `bot/**`, `tests/**`; dashboard executor owns `dashboard/**`; Lead owns `shared/schema.sql`, `docs/**`, `README.md`, `nodesheet.example.json`. Never edit outside your scope.
- No git commands by executors; the Lead commits at integration points.
- Existing single-team servers must keep working with no `teams` rows and no captains.
- The spec is the source of truth for exact values (weights 0.6/0.4, `RACE_ACTIVITY_TARGET = 10`, grades A+ ≥ 90 / A ≥ 80 / B ≥ 65 / C ≥ 50 / D, captain access on any plan, excused players unranked, one task = one distinct node contribution).

## Review Focus

- **A war board message that survives a bot restart still has a working "I attacked" button** (persistent view must be registered, `timeout=None`, fixed `custom_id`).
- **A player pressing the button and also typing `attacks done` in the same war** must never exceed `attacks_required`, never go negative, and remove the missing entry exactly once.
- **Renaming an alias during an active war** must keep `attack_counts` / `missing_list` / `absent_list` attached to the same player (no lost counts, no ghost missing entry).
- **A missing or malformed `nodesheet.json`** must not crash race commands; a single bad node is skipped while the rest of the sheet works.
- **Authorization boundaries**: a plain member can never run a team command, a captain can only affect their own channels, and a captain still cannot run guild-level staff commands (settings/warnings/aliases/uploads).

---

### Task 1: Schema, example node sheet, shared docs

**Files:**
- Modify: `shared/schema.sql` (append migration section 11–14 exactly as in the spec)
- Create: `nodesheet.example.json`
- Modify: `README.md` (env var `NODESHEET_PATH`, migration note — can land with the Lead only)

**Interfaces:**
- Produces tables/columns the bot and dashboard tasks rely on: `teams(id, guild_id, name, war_channel_id, race_channel_id, team_role_id, created_at)`, `team_captains(team_id, discord_id, created_at)`, `war_logs(id, guild_id, channel_id, war_start, discord_id, player_name, attacks, source, created_at)`, `race_logs.channel_id/lap/node`.

- [ ] **Step 1:** Append the spec's section 11–14 SQL (including idempotent `DROP POLICY IF EXISTS` RLS statements) to `shared/schema.sql`.
- [ ] **Step 2:** Create `nodesheet.example.json` with two nodes in the exact shipped shape:
```json
{ "0.1": { "ofa": "OFA task text", "dyp": "DYP task text", "je": "JE task text" },
  "0.2": { "ofa": "OFA task text", "dyp": "DYP task text", "je": "JE task text" } }
```
- [ ] **Step 3:** Add the README notes: upload `nodesheet.json` to the bot root or set `NODESHEET_PATH`; run the migration block in Supabase after deploying.
- [ ] **Step 4:** Verify `shared/schema.sql` parses in the Supabase SQL editor by eye (no local Postgres) and the JSON file is valid: `python3 -m json.tool nodesheet.example.json >/dev/null`.

---

### Task 2: Captain detection (bot)

**Files:**
- Modify: `bot/database.py`
- Modify: `tests/fakes.py` (add `teams`, `team_captains`, `war_logs` to `FakeDB.TABLES`; FK checks `team_captains.team_id → teams.id`, `team_captains.discord_id → users.discord_id`)
- Test: `tests/test_bot.py`

**Interfaces:**
- Produces: `get_team_captain_map(guild_id: int) -> dict[int, set[int]]` (channel id → captain Discord ids; empty dict on failure, 60 s cache in `_team_cache`) and `async is_team_staff(member, channel_id: int) -> bool` (global staff OR captain of the team owning that war/race channel). `database._team_cache.clear()` exists for tests.

- [ ] **Step 1: Write the failing tests**
```python
def test_team_captain_map_resolves_war_and_race_channels(clean_db):
    db = clean_db
    db.seed("teams", {"id": 1, "guild_id": GUILD, "name": "A", "war_channel_id": 10, "race_channel_id": 11})
    db.seed("users", {"discord_id": 900})
    db.seed("team_captains", {"team_id": 1, "discord_id": 900})
    import database
    database._team_cache.clear()
    assert database.get_team_captain_map(GUILD) == {10: {900}, 11: {900}}

def test_captain_is_team_staff_but_not_global_staff(clean_db):
    ...
    captain = FakeMember(user_id=900, roles=[])
    assert run(database.is_team_staff(captain, 10)) is True
    assert run(database.is_team_staff(captain, 12)) is False
    assert run(database.is_staff_member(captain)) is False


def test_plain_member_is_not_team_staff(clean_db):
    ...
```
- [ ] **Step 2:** Run `python3 -m pytest tests/test_bot.py -k "team" -v` → FAIL (`get_team_captain_map` missing / fake table missing).
- [ ] **Step 3:** Implement `get_team_captain_map` (query `teams` for the guild, then `team_captains` via `.in_("team_id", ids)`; extend `FakeDB`/`_Query` with `.in_`), `is_team_staff`, and the cache. Wrap DB errors: log + return empty/False (never raise into a command).
- [ ] **Step 4:** Run the tests → PASS. Add the `.in_` support test (`test_fake_db_in_filter`) and run the whole suite to catch regressions.
- [ ] **Step 5:** No commit (Lead commits after the bot half).

---

### Task 3: Alias rename (bot)

**Files:**
- Modify: `bot/database.py` (helper), `bot/cogs/admin.py` (`!alias rename <old> <new>` action)
- Test: `tests/test_bot.py`

**Interfaces:**
- Produces: `rename_alias(guild_id: int, old_name: str, new_name: str) -> str | None` — updates the `aliases` row, rewrites `wars.attack_counts` keys and `missing_list`/`absent_list` names for every war row of the guild; returns an error message (`"No alias named …"`, `"`…` already exists"`) or `None` on success. Bot command output uses that return value.

- [ ] **Step 1: Write the failing tests**
```python
def test_alias_rename_moves_war_data_to_the_new_name(clean_db):
    seed_alias(clean_db, 900, "sam")
    seed_war(clean_db, attack_counts={"sam": 4}, missing_list=[{"name": "sam"}], absent_list=[{"name": "bob"}])
    run(admin_cog().alias_group(make_ctx("rename sam sammy"), "rename", "sam sammy"))
    assert clean_db.one("aliases", alias_name="sammy", guild_id=GUILD)
    war = clean_db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"sammy": 4}
    assert war["missing_list"] == [{"name": "sammy"}]
    assert war["absent_list"] == [{"name": "bob"}]

def test_alias_rename_rejects_duplicate_and_unknown(clean_db):
    ...
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement helper + command branch (`rename` requires `is_staff_member`; usage string updated; returns `✅ Renamed …` or the error).
- [ ] **Step 4:** Run targeted then full suite → PASS.

---

### Task 4: "I attacked" button + `war_logs` (bot)

**Files:**
- Modify: `bot/cogs/war.py`, `bot/database.py` (if a small log helper is cleaner there)
- Test: `tests/test_bot.py`

**Interfaces:**
- Produces: `apply_attack(war: dict, alias: str, delta: int, required: int) -> tuple[dict, list]` (pure: returns new `attack_counts`, new `missing_list`, caps at `required`, floor 0, removes the alias from missing at the cap); `log_attack(guild_id, channel_id, war_start, discord_id, alias, delta, source)` writing `war_logs`; `AttackView(discord.ui.View)` with `timeout=None` and button `custom_id="war:i_attacked"`; `WarTracker._handle_attack_press(interaction)` calling the same record path as the text handler. Text `attacks done` and the ❌ undo also insert log rows (`source='self'`, `source='undo'`).

- [ ] **Step 1: Write the failing tests**
```python
def test_apply_attack_caps_and_removes_missing():
    war = {"attack_counts": {"sam": 5}, "missing_list": [{"name": "sam"}]}
    counts, missing = apply_attack(war, "sam", 1, 6)
    assert counts == {"sam": 6} and missing == []
    counts, missing = apply_attack({"attack_counts": {"sam": 6}}, "sam", 1, 6)
    assert counts == {"sam": 6}                     # never exceeds required

def test_attacks_done_message_writes_a_war_log(clean_db):
    seed_alias(clean_db, 900, "sam")
    seed_war(clean_db)
    run(war_cog().on_message(FakeMessage(900, "attacks done")))
    log = clean_db.rows("war_logs")[-1]
    assert (log["channel_id"], log["player_name"], log["attacks"], log["source"]) == (CHANNEL, "sam", 6, "self")

def test_attack_view_is_persistent():
    view = AttackView()
    button = view.children[0]
    assert view.timeout is None and button.custom_id == "war:i_attacked"
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `apply_attack`, `log_attack`, the view + `_handle_attack_press` (ephemeral replies; no alias → "ask staff for an alias"; no active war → silent/ephemeral), register `bot.add_view(AttackView())` in `cog_load`, and pass `view=self.attack_view` on the board/announcement/reminder sends and edits. Keep the existing text handler behavior and use the same alias-preference rule.
- [ ] **Step 4:** Run targeted then full suite → PASS.

---

### Task 5: Bundled node sheet + race log context (bot)

**Files:**
- Create: `bot/node_sheet.py`
- Modify: `bot/cogs/race.py` (fallback in `advance_node_auto`, `!race use default|bundled`, `!race sheets`, `log_race_action` kwargs + call sites, upload validation reuses `parse_nodesheet`)
- Test: `tests/test_bot.py`

**Interfaces:**
- Produces: `default_path() -> str` (`NODESHEET_PATH` or `<repo>/nodesheet.json`), `parse_nodesheet(payload) -> tuple[dict[str, dict[str, str]], list[str]]` (raises `ValueError` on bad top level; skips malformed nodes with warnings; accepts the `{"nodes": …}` wrapper), `load_nodesheet(path=None) -> dict | None` (mtime cache, None on missing/invalid), `bundled_sheet()`; `log_race_action(guild_id, user_id, player_name, action_type, channel_id=None, lap=None, node=None)`.

- [ ] **Step 1: Write the failing tests**
```python
def test_parse_nodesheet_accepts_wrapper_and_skips_bad_nodes():
    data, warnings = parse_nodesheet({"nodes": {"0.1": {"ofa": "a", "dyp": "b", "je": "c"}, "0.2": {"ofa": "a"}}})
    assert data == {"0.1": {"ofa": "a", "dyp": "b", "je": "c"}} and len(warnings) == 1

def test_parse_nodesheet_rejects_bad_top_level():
    with pytest.raises(ValueError):
        parse_nodesheet(["nope"])

def test_race_next_falls_back_to_the_bundled_sheet(clean_db, monkeypatch, tmp_path):
    ...write a nodesheet.json, monkeypatch NODESHEET_PATH, seed_race with active_race_sheet=None, run !race next...
    assert clean_db.one("race_state", channel_id=CHANNEL)["current_lap"] == 1

def test_race_log_records_channel_and_node(clean_db):
    ...
    assert (log["channel_id"], log["lap"], log["node"]) == (CHANNEL, 1, 1)

def test_missing_or_broken_nodesheet_does_not_crash_a_command(clean_db, monkeypatch):
    ...
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the loader, fallback resolution (`active_race_sheet` empty or `"default"` → bundled; guild sheet still primary), `!race sheets` listing, and the new log kwargs from the current `race_state` (call sites pass `ctx.channel.id`, `lap`, `node`; reaction path passes `payload.channel_id` and the state row).
- [ ] **Step 4:** Run targeted then full suite → PASS.

---

### Task 6: Team-scope the staff checks (bot)

**Files:**
- Modify: `bot/cogs/war.py`, `bot/cogs/race.py`, `bot/cogs/help.py`
- Test: `tests/test_bot.py`

**Interfaces:**
- Consumes: `is_team_staff` from Task 2. Team powers in the war channel = start/cancel war, live board start/stop, missing/absent add-remove, `!war attacks`, `!war check`, `!war set role`. Team powers in the race channel = target, newnode, next, set, `!race use`, `!race sheets`, OFA approve/cancel/release. Guild-level stays global staff: `!war set attacks`, warnings, `!alias`, `!race uploadsheet`, maze.

- [ ] **Step 1: Write the failing tests**
```python
def test_captain_can_manage_team_war_but_not_guild_settings(clean_db):
    ...seed team captain 900 on CHANNEL...
    run(war_cog().war_group(make_ctx("missing add sam", user=900), "missing", "add", "sam"))
    assert clean_db.one("wars", channel_id=CHANNEL)["missing_list"] == [{"name": "sam"}]
    run(war_cog().war_group(make_ctx("set attacks 5", user=900), "set", "attacks", "5"))
    assert clean_db.one("war_settings", guild_id=GUILD)["attacks_required"] != 5

def test_plain_member_cannot_run_team_commands(clean_db):
    ...user 901 not a captain...
    run(war_cog().war_group(make_ctx("missing add sam", user=901), "missing", "add", "sam"))
    assert clean_db.one("wars", channel_id=CHANNEL)["missing_list"] == [{"name": "sam"}, {"name": "bob"}]

def test_captain_can_advance_their_race_node(clean_db):
    ...seed team + race, run(race_cog().race_group(ctx, "newnode", "5 hatch | 2 breed | 1 craft"))...
```
- [ ] **Step 2:** Run → FAIL (captain currently rejected).
- [ ] **Step 3:** Replace channel-scoped `is_staff_member` gates with `is_team_staff(ctx.author, ctx.channel.id)`; keep guild-level gates as `is_staff_member`; move the race dispatch's global gate so it only guards the actions that stay staff-only. Reaction-based OFA approval uses `is_team_staff(reactor, payload.channel_id)`. Update `help.py` copy: captain powers, `!alias rename`, `!race sheets`.
- [ ] **Step 4:** Run targeted then full suite → PASS.

---

### Task 7: Dashboard types, data helpers, rating (dashboard)

**Files:**
- Modify: `dashboard/lib/types.ts`, `dashboard/lib/constants.ts`, `dashboard/lib/data.ts`
- Create: `dashboard/lib/rating.ts`

**Interfaces:**
- Produces exactly:
```ts
// types.ts
export interface Team { id: number; guild_id: Id; name: string; war_channel_id: Id | null; race_channel_id: Id | null; team_role_id: Id | null; created_at: string | null }
export interface TeamCaptain { team_id: number; discord_id: Id; created_at: string | null }
export interface WarLog { id: number; guild_id: Id; channel_id: Id; war_start: string | null; discord_id: Id | null; player_name: string | null; attacks: number; source: string; created_at: string | null }
export interface RaceLog { id: number; guild_id: Id; channel_id: Id | null; lap: number | null; node: number | null; discord_id: Id | null; player_name: string | null; action_type: string; created_at: string | null }
// constants.ts
export const RACE_ACTIVITY_TARGET = 10
// data.ts
listTeams(supabase, guildId): Promise<Team[]>
createTeam(supabase, guildId, values: { name: string; war_channel_id: string | null; race_channel_id: string | null; team_role_id: string | null }): Promise<void>
saveTeam(supabase, team: Team, values: { name; war_channel_id; race_channel_id; team_role_id }): Promise<void>   // also upserts wars.team_role_id when the team has a war channel
deleteTeam(supabase, teamId: number): Promise<void>
listTeamCaptains(supabase, teamIds: number[]): Promise<TeamCaptain[]>
addTeamCaptain(supabase, guildId, teamId, discordId): Promise<void>   // upserts users first
removeTeamCaptain(supabase, teamId, discordId): Promise<void>
renameAlias(supabase, guildId, alias: Alias, newName: string): Promise<void>  // rejects duplicates, migrates wars
listWarLogs(supabase, channelId, sinceIso: string | null, limit?: number): Promise<WarLog[]>
listRaceLogs(supabase, guildId, channelId, sinceIso: string | null): Promise<RaceLog[]>
// rating.ts
export interface RatingRow { alias: string; discordId: Id | null; attacks: number; required: number; raceTasks: number; score: number; grade: string; excused: boolean }
export function gradeFor(score: number): string
export function computeRatings(input: { war: War | null; warSettings: WarSettings; raceLogs: RaceLog[]; aliases: Alias[]; windowStart: string | null }): RatingRow[]
```
- [ ] **Step 1:** Add types/constants/data functions; `computeRatings` is pure (no Supabase) and dedupes race tasks by `(channel_id, lap, node, player, kind)` with `ofa_claim` excluded; renormalize weights when a side is missing; excused handling per spec.
- [ ] **Step 2:** `cd dashboard && npx tsc --noEmit` → PASS (no page uses the helpers yet).

---

### Task 8: Captain access in the shell (dashboard)

**Files:**
- Modify: `dashboard/components/guild-shell.tsx`, `dashboard/components/server-picker.tsx`, `dashboard/lib/discord.ts` (export a viewer-id helper if needed)
- Test: none (types only) — verify with tsc.

**Interfaces:**
- Produces: `GuildContextValue` gains `isStaff: boolean`, `teams: Team[]`, `captainTeamIds: number[]`, `canManageChannel(channelId: string | null | undefined): boolean`; nav rules per spec (captains: Overview/War/Race; staff unchanged; members read-only).

- [ ] **Step 1:** Load teams for the guild and the viewer's captain rows; treat a captain row as an access grant on any plan (no alias required); keep premium-alias read-only for everyone else; add captain servers to the picker.
- [ ] **Step 2:** `npx tsc --noEmit` → PASS. Confirm no `useGuild()` destructuring elsewhere was broken (`grep -r "useGuild()" dashboard`).

---

### Task 9: One-stop Overview + team setup (dashboard)

**Files:**
- Create: `dashboard/components/team-setup.tsx`
- Modify: `dashboard/app/dashboard/[guildId]/page.tsx` (rebuild)
- Modify: `dashboard/components/ui.tsx` only if a primitive is genuinely missing.

**Interfaces:**
- Consumes: Task 7 data helpers + `computeRatings`, Task 8 context. Produces the page the owner uses: staff-only Setup card (staff role, maze channel, plan/team limit, team editor with captain pickers, "Add as team" for detected `wars`/`race_state` channels not in a team) and the per-team snapshot cards (war, race, maze once, leaderboard top 5, links with `?channel=`), excused group, one-sided teams, empty states.

- [ ] **Step 1:** Build `team-setup.tsx` (props: `teams`, `captainsByTeam`, `aliases`, `guild`, detected channels, `onChanged`; uses data helpers).
- [ ] **Step 2:** Rebuild the Overview page around it; hide setup for captains/read-only; keep the existing plan/trial stat and refresh behavior.
- [ ] **Step 3:** `npx tsc --noEmit` → PASS. Manually re-read the page for the spec's empty states and one-sided-team copy.

---

### Task 10: Aliases rename, war log + rating, race sheet, remove Settings (dashboard)

**Files:**
- Modify: `dashboard/app/dashboard/[guildId]/aliases/page.tsx`, `.../war/page.tsx`, `.../race/page.tsx`
- Delete: `dashboard/app/dashboard/[guildId]/settings/page.tsx` and its nav item
- Test: none (types only) — verify with tsc/build plus a page-by-page read.

**Interfaces:**
- Consumes: Task 7 helpers, Task 8 `canManageChannel`. War page: gate every edit control (`canManageChannel`) and add the Attack log card (`listWarLogs`, recent 25 with timestamps + source) and full rating table. Race page: gate controls, add "default (bundled)" to the sheet list, filter race logs by channel. Aliases page: inline rename (pencil → input → save → error/success), note that live war lists move too. Remove Settings from nav; the fields live in Overview now.

- [ ] **Step 1:** Aliases rename UI + data call.
- [ ] **Step 2:** War page gating + attack log + rating table.
- [ ] **Step 3:** Race page gating + bundled sheet row.
- [ ] **Step 4:** Delete `settings/page.tsx` and its nav entry; `grep -rn "settings" dashboard/components/guild-shell.tsx dashboard/app | grep -v node_modules` to confirm no dead links.
- [ ] **Step 5:** `npx tsc --noEmit` → PASS; `npm run build` → PASS.

---

### Task 11: Verification, docs and commits (Lead)

- [ ] **Step 1:** Install test deps: `apt install -y python3-pytest python3-discord`; run `python3 -m pytest tests -q` → all pass.
- [ ] **Step 2:** `cd dashboard && npx tsc --noEmit && npm run build` → both pass.
- [ ] **Step 3:** Review the full diff against the spec (`git diff`), fix integration gaps (column names, `Id` string/number handling, write scopes untouched elsewhere).
- [ ] **Step 4:** Update `README.md` (captain powers, nodesheet upload, migration + deploy steps).
- [ ] **Step 5:** Commit in scoped commits: schema/docs, bot, dashboard. Do not push unless the owner asks.
- [ ] **Step 6:** Dispatch a fresh reviewer on the branch (requesting-code-review skill); address findings; re-run Step 1–2.

---

### Task 12: Fixes from review (owner of the finding)

- [ ] Apply reviewer findings inside the owning scope, re-run the verification command for that scope, and report back to the Lead.
