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
    required_attacks INTEGER DEFAULT 6,

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
    missing_list JSONB DEFAULT '[]'::jsonb, -- [{ "name": "Sam", "id": 12345 }]
    absent_list JSONB DEFAULT '[]'::jsonb,
    attack_counts JSONB DEFAULT '{}'::jsonb, -- { "sam": 6 }
    status_message_id BIGINT,
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. MAZE SCHEDULES TABLE (one event per server)
CREATE TABLE maze_schedules (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT UNIQUE REFERENCES guilds(guild_id) ON DELETE CASCADE,
    event_start TIMESTAMP WITH TIME ZONE,
    event_end TIMESTAMP WITH TIME ZONE,
    maze_type TEXT DEFAULT '7d', -- '7d' or '3d'
    channel_id BIGINT, -- channel the discount pings are sent to
    discount_schedule JSONB, -- optional custom offsets; SCHEDULE_7D/3D in bot/cogs/maze.py are the defaults
    ping_enabled_global BOOLEAN DEFAULT TRUE
);

-- 10. PLAYER PING PREFERENCES (players can opt out of maze pings)
CREATE TABLE player_ping_settings (
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    maze_pings_enabled BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (guild_id, discord_id)
);

-- Security: the Python bot uses the service role key (bypasses RLS).
-- The dashboard reads with the anon key, so enable RLS and add policies that
-- let a user read only the guilds they manage through the Discord OAuth token.
