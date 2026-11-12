-- Monster Legends Assistant - database schema
-- This file mirrors the columns the bot and the dashboard actually use.
-- Run it on a fresh Supabase project; if you already have tables, apply the
-- -- ========== comments as migrations instead of re-creating tables.

-- 1. GUILDS TABLE (server configuration, subscription and multi-team limits)
CREATE TABLE guilds (
    guild_id BIGINT PRIMARY KEY,
    is_blacklisted BOOLEAN DEFAULT FALSE,
    premium_status TEXT DEFAULT 'trial', -- 'trial', 'premium', 'expired'
    trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
    premium_ends_at TIMESTAMP WITH TIME ZONE, -- NULL = lifetime/manual premium
    max_teams INTEGER DEFAULT 1, -- war/race team channels allowed by the plan
    last_order_id TEXT, -- last processed payment order (webhook idempotency)
    last_renewal_ping INTEGER DEFAULT 0, -- 0 none, 3 three-day warning, 1 one-day warning, -1 expired
    required_attacks INTEGER DEFAULT 6, -- legacy; war_settings.attacks_required is authoritative

    -- Channel configurations
    war_channel_id BIGINT,
    race_channel_id BIGINT,
    maze_channel_id BIGINT,
    absence_channel_id BIGINT,

    -- Role configurations
    leader_role_id BIGINT,
    colead_role_id BIGINT,
    staff_role_id BIGINT,
    member_role_id BIGINT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USERS TABLE (per-player blacklists)
CREATE TABLE users (
    discord_id BIGINT PRIMARY KEY,
    is_blacklisted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. ALIASES TABLE (in-game name -> Discord user, used to avoid accidental pings)
CREATE TABLE aliases (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    alias_name TEXT NOT NULL,
    UNIQUE(guild_id, alias_name)
);

-- 4. WARNINGS TABLE (war punishments)
CREATE TABLE warnings (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    reason TEXT,
    issued_by BIGINT, -- Discord ID of the staff member
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. WAR SETTINGS TABLE (per-server attack rules)
CREATE TABLE war_settings (
    guild_id BIGINT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    attacks_required INTEGER DEFAULT 6,
    exempt_absent BOOLEAN DEFAULT TRUE
);

-- 6. WARS TABLE (one active war per war channel; a server can have several teams)
CREATE TABLE wars (
    channel_id BIGINT PRIMARY KEY, -- unique per war/team channel
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    war_start TIMESTAMP WITH TIME ZONE,
    phase TEXT, -- 'defence' or 'attack' (then 'ended')
    missing_list JSONB DEFAULT '[]'::jsonb, -- [{ "name": "sam" }]; id is optional when known
    absent_list JSONB DEFAULT '[]'::jsonb,
    attack_counts JSONB DEFAULT '{}'::jsonb, -- { "sam": 6 }
    status_message_id BIGINT, -- live war board message; NULL = auto-create, -1 = stopped by staff
    sent_pings JSONB DEFAULT '[]'::jsonb, -- reminder keys already sent, e.g. ["hours_12"]
    team_role_id BIGINT, -- role pinged by announcements in this team's war channel
    is_active BOOLEAN DEFAULT TRUE
);

-- 7. RACE STATE TABLE (one active race per race channel)
CREATE TABLE race_state (
    channel_id BIGINT PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    target_laps INTEGER DEFAULT 0,
    current_lap INTEGER DEFAULT 0,
    current_node INTEGER DEFAULT 0,
    task_description TEXT,
    ofa_holder_id BIGINT,
    ofa_target TEXT,
    ofa_done BOOLEAN DEFAULT FALSE,
    dyp_progress INTEGER DEFAULT 0,
    dyp_target INTEGER DEFAULT 0,
    dyp_contributors JSONB DEFAULT '[]'::jsonb,
    je_progress TEXT DEFAULT '0',
    je_target TEXT DEFAULT '0',
    je_done BOOLEAN DEFAULT FALSE,
    pending_ofa_message_id BIGINT,
    pending_ofa_user_id BIGINT,
    is_event_active BOOLEAN DEFAULT FALSE,
    active_race_sheet TEXT
);

-- 8. RACE SHEETS & LOGS (task checklists and the activity feed in the dashboard)
CREATE TABLE race_sheets (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data JSONB,
    UNIQUE(guild_id, name)
);

CREATE TABLE race_logs (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id BIGINT,
    player_name TEXT,
    action_type TEXT,
    channel_id BIGINT, -- team race channel the action belongs to
    lap INTEGER,
    node INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. MAZE EVENTS TABLE (the shared maze: one row per event, not per server)
-- The in-game monthly calendar predicts it, the first staff member who sees the
-- maze countdown confirms or corrects it, and every server's discount pings are
-- derived from this one row.  event_start/event_end are the maze open/close
-- times; the discount windows are fixed offsets from event_start.
CREATE TABLE maze_events (
    id BIGSERIAL PRIMARY KEY,
    event_start TIMESTAMP WITH TIME ZONE NOT NULL,
    event_end TIMESTAMP WITH TIME ZONE NOT NULL,
    maze_type TEXT NOT NULL DEFAULT '7d',
    status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled' (predicted) | 'confirmed' | 'cancelled'
    source TEXT NOT NULL DEFAULT 'calendar', -- 'calendar' | 'report'
    confirmed_by_guild BIGINT, -- server whose staff reported the in-game countdown
    confirmed_by_user BIGINT, -- staff member who reported it
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX maze_events_start_key ON maze_events (event_start);

-- 9b. MAZE SCHEDULES TABLE (per-server subscription to the shared maze)
-- One row per server that wants maze alerts.  event_start/event_end/maze_type
-- and discount_schedule are legacy columns from the per-server schedule model;
-- the bot and dashboard read the shared maze_events row instead.
CREATE TABLE maze_schedules (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT UNIQUE REFERENCES guilds(guild_id) ON DELETE CASCADE,
    event_start TIMESTAMP WITH TIME ZONE, -- legacy, unused
    event_end TIMESTAMP WITH TIME ZONE, -- legacy, unused
    maze_type TEXT DEFAULT '7d', -- legacy, unused
    channel_id BIGINT, -- channel the discount pings are sent to
    discount_schedule JSONB, -- legacy, unused
    ping_enabled_global BOOLEAN DEFAULT TRUE,
    ping_mention TEXT DEFAULT 'here', -- 'here', 'everyone', 'role', 'none'
    ping_role_id BIGINT, -- role pinged when ping_mention = 'role'
    sent_pings JSONB DEFAULT '[]'::jsonb -- discount keys already announced (restart dedupe)
);

-- 9c. MAZE SETTINGS (one row). windows = the editable discount ladder, NULL = built-in table.
-- The built-in ladder lives in bot/maze_timing.py and dashboard/lib/constants.ts; staff can
-- replace it from Discord (`!maze windows set ...`) or the dashboard when the game changes it.
CREATE TABLE maze_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    windows JSONB, -- [[start_hour, end_hour, "50%"], ...], NULL = built-in
    updated_by BIGINT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
INSERT INTO maze_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 9d. MAZE PINGS (manual "ping now" requests from the dashboard; the bot drains the queue).
CREATE TABLE maze_pings (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    percent TEXT NOT NULL,
    requested_by BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX maze_pings_pending_idx ON maze_pings (created_at);

-- 10. PLAYER PING PREFERENCES (players choose channel @here, DM alerts, or off)
CREATE TABLE player_ping_settings (
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    maze_pings_enabled BOOLEAN DEFAULT TRUE, -- legacy mirror of maze_alert_mode != 'off'
    maze_alert_mode TEXT DEFAULT 'here', -- 'here' (channel @here), 'dm', 'off'
    PRIMARY KEY (guild_id, discord_id)
);

-- ============================================================================
-- MIGRATIONS for existing databases (safe to run repeatedly)
-- ============================================================================
-- Guild-level staff roles and channels. These exist in the fresh-install CREATE
-- above but older projects can miss the role columns; the bot now reads all
-- three staff roles from the Server setup page, so make the columns explicit.
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS leader_role_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS colead_role_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS staff_role_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS member_role_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS maze_channel_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS absence_channel_id BIGINT;

ALTER TABLE wars ADD COLUMN IF NOT EXISTS sent_pings JSONB DEFAULT '[]'::jsonb;
ALTER TABLE wars ADD COLUMN IF NOT EXISTS team_role_id BIGINT;
ALTER TABLE maze_schedules ADD COLUMN IF NOT EXISTS ping_mention TEXT DEFAULT 'here';
ALTER TABLE maze_schedules ADD COLUMN IF NOT EXISTS ping_role_id BIGINT;
ALTER TABLE maze_schedules ADD COLUMN IF NOT EXISTS sent_pings JSONB DEFAULT '[]'::jsonb;

-- MIGRATION 2026-11 (maze): one shared maze event for every server.
-- Before this, each server stored its own maze schedule and had to run
-- `!maze start` itself.  Now the shared row is the truth and maze_schedules is
-- only the per-server alert subscription, so the two legacy time columns above
-- are no longer read (kept so an older bot build can still start).
CREATE TABLE IF NOT EXISTS maze_events (
    id BIGSERIAL PRIMARY KEY,
    event_start TIMESTAMP WITH TIME ZONE NOT NULL,
    event_end TIMESTAMP WITH TIME ZONE NOT NULL,
    maze_type TEXT NOT NULL DEFAULT '7d',
    status TEXT NOT NULL DEFAULT 'scheduled',
    source TEXT NOT NULL DEFAULT 'calendar',
    confirmed_by_guild BIGINT,
    confirmed_by_user BIGINT,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS maze_events_start_key ON maze_events (event_start);

CREATE TABLE IF NOT EXISTS maze_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    windows JSONB,
    updated_by BIGINT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
INSERT INTO maze_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS maze_pings (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
    percent TEXT NOT NULL,
    requested_by BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS maze_pings_pending_idx ON maze_pings (created_at);
ALTER TABLE player_ping_settings ADD COLUMN IF NOT EXISTS maze_alert_mode TEXT DEFAULT 'here';
ALTER TABLE race_logs ADD COLUMN IF NOT EXISTS channel_id BIGINT;
ALTER TABLE race_logs ADD COLUMN IF NOT EXISTS lap INTEGER;
ALTER TABLE race_logs ADD COLUMN IF NOT EXISTS node INTEGER;
CREATE INDEX IF NOT EXISTS race_logs_channel_idx ON race_logs (channel_id, created_at DESC);
UPDATE player_ping_settings
   SET maze_alert_mode = 'off'
 WHERE maze_pings_enabled = FALSE AND maze_alert_mode = 'here';

-- ----------------------------------------------------------------------------
-- MIGRATION 2026-11: teams, team captains and the war attack log.
-- Existing servers keep working without this block; running it enables the
-- one-stop team setup, captains, the "I attacked" button and the activity rating.
-- Every statement is idempotent, so the whole block can be re-run.
-- ----------------------------------------------------------------------------

-- Teams: a team pairs one war channel with one race channel and owns captains.
CREATE TABLE IF NOT EXISTS teams (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    war_channel_id BIGINT,
    race_channel_id BIGINT,
    team_role_id BIGINT, -- role pinged by this team's war announcements (synced to wars.team_role_id)
    attacks_required INTEGER, -- NULL = inherit war_settings.attacks_required
    exempt_absent BOOLEAN, -- NULL = inherit war_settings.exempt_absent
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (guild_id, name)
);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS attacks_required INTEGER;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS exempt_absent BOOLEAN;
CREATE UNIQUE INDEX IF NOT EXISTS teams_guild_war_channel_key
    ON teams (guild_id, war_channel_id) WHERE war_channel_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teams_guild_race_channel_key
    ON teams (guild_id, race_channel_id) WHERE race_channel_id IS NOT NULL;

-- Team roster: which players belong to which team. A player can be on one team
-- per server; the bot moves them when they are added to another team. The roster
-- is what `!war missing add` and the 12h reminder validate against, so a player
-- who left a team stops being treated as an active member of it.
CREATE TABLE IF NOT EXISTS team_players (
    id BIGSERIAL PRIMARY KEY,
    team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (team_id, discord_id)
);
CREATE INDEX IF NOT EXISTS team_players_team_idx ON team_players (team_id);

-- Team captains: a captain is staff for their team channels only.
CREATE TABLE IF NOT EXISTS team_captains (
    team_id BIGINT REFERENCES teams(id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (team_id, discord_id)
);

-- War logs: one row per attack report (button = +1, text = delta, staff = correction, undo = negative).
CREATE TABLE IF NOT EXISTS war_logs (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    channel_id BIGINT NOT NULL,
    war_start TIMESTAMP WITH TIME ZONE,
    discord_id BIGINT,
    player_name TEXT,
    attacks INTEGER NOT NULL DEFAULT 1, -- signed delta
    source TEXT DEFAULT 'self',         -- 'self' | 'staff' | 'undo'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS war_logs_channel_idx ON war_logs (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS war_logs_guild_idx ON war_logs (guild_id, created_at DESC);

-- Security: the Python bot uses the service role key (bypasses RLS). The dashboard reads
-- and writes with the anon key, so the dashboard-facing tables need permissive RLS policies
-- for signed-in users (the same trust model the existing dashboard tables use: staff and
-- captain scoping is enforced by the UI, not by Postgres). Tighten these if the project ever
-- moves permission checks server-side.
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teams_authenticated ON teams;
CREATE POLICY teams_authenticated ON teams
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE team_captains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_captains_authenticated ON team_captains;
CREATE POLICY team_captains_authenticated ON team_captains
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE team_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_players_authenticated ON team_players;
CREATE POLICY team_players_authenticated ON team_players
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE war_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS war_logs_read ON war_logs;
CREATE POLICY war_logs_read ON war_logs
    FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- MIGRATION 2026-11 (security): RLS for the core dashboard tables.
-- The bot uses the service-role key (bypasses RLS); the dashboard uses the anon
-- key with a signed-in Supabase user, so these policies keep authenticated access
-- exactly as before while denying anonymous PostgREST writes. A signed-in user
-- can still reach any guild row (the UI scopes them), which is the documented
-- trust model; move dashboard writes behind a server route to tighten it.
-- Idempotent, safe to re-run.
-- ----------------------------------------------------------------------------
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guilds_authenticated ON guilds;
CREATE POLICY guilds_authenticated ON guilds
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_authenticated ON users;
CREATE POLICY users_authenticated ON users
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aliases_authenticated ON aliases;
CREATE POLICY aliases_authenticated ON aliases
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE warnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warnings_authenticated ON warnings;
CREATE POLICY warnings_authenticated ON warnings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE war_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS war_settings_authenticated ON war_settings;
CREATE POLICY war_settings_authenticated ON war_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wars ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wars_authenticated ON wars;
CREATE POLICY wars_authenticated ON wars
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE race_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS race_state_authenticated ON race_state;
CREATE POLICY race_state_authenticated ON race_state
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE race_sheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS race_sheets_authenticated ON race_sheets;
CREATE POLICY race_sheets_authenticated ON race_sheets
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE race_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS race_logs_authenticated ON race_logs;
CREATE POLICY race_logs_authenticated ON race_logs
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE maze_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maze_schedules_authenticated ON maze_schedules;
CREATE POLICY maze_schedules_authenticated ON maze_schedules
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE maze_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maze_settings_authenticated ON maze_settings;
CREATE POLICY maze_settings_authenticated ON maze_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE maze_pings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maze_pings_authenticated ON maze_pings;
CREATE POLICY maze_pings_authenticated ON maze_pings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE maze_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS maze_events_authenticated ON maze_events;
CREATE POLICY maze_events_authenticated ON maze_events
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE player_ping_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_ping_settings_authenticated ON player_ping_settings;
CREATE POLICY player_ping_settings_authenticated ON player_ping_settings
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Legacy single-team channel columns (guilds.war_channel_id / race_channel_id) are no
-- longer used by the bot; teams own those channels now. maze_channel_id and the
-- leader / helper (co-lead) / staff role ids stay guild-level and are edited from the
-- dashboard's Server setup page.

-- ----------------------------------------------------------------------------
-- MIGRATION 2026-12: plan tiers, unlimited Elite, locked subscription columns.
-- Run the whole block in the Supabase SQL editor. Idempotent; safe to re-run.
-- ----------------------------------------------------------------------------
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS plan TEXT; -- 'starter_monthly' | 'pro_monthly' | 'elite_yearly'

-- Backfill legacy paid guilds from the old team cap (99 was Elite).
UPDATE guilds
   SET plan = CASE
         WHEN max_teams IS NULL OR max_teams <= 1 THEN 'starter_monthly'
         WHEN max_teams <= 3 THEN 'pro_monthly'
         ELSE 'elite_yearly'
       END
 WHERE plan IS NULL AND premium_status = 'premium';

-- Elite is sold as unlimited teams. 1e6 is the numeric sentinel the bot and dashboard read.
UPDATE guilds
   SET max_teams = 1000000
 WHERE plan = 'elite_yearly' AND (max_teams IS NULL OR max_teams < 1000000);

-- Subscription columns are written only by the service role (webhooks, bot, SQL editor).
-- The dashboard keeps saving its server-config columns from the browser.
REVOKE UPDATE ON public.guilds FROM authenticated, anon;
REVOKE INSERT, DELETE ON public.guilds FROM authenticated, anon;
GRANT UPDATE (war_channel_id, race_channel_id, maze_channel_id, absence_channel_id,
              leader_role_id, colead_role_id, staff_role_id, member_role_id)
  ON public.guilds TO authenticated;
