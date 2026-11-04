-- 1. GUILDS TABLE (Stores all server configurations & subscriptions)
CREATE TABLE guilds (
    guild_id BIGINT PRIMARY KEY,
    is_blacklisted BOOLEAN DEFAULT FALSE,
    premium_status TEXT DEFAULT 'trial', -- 'trial', 'premium', 'expired'
    trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days'),
    required_attacks INTEGER DEFAULT 6,
    
    -- Channel Configurations
    war_channel_id BIGINT,
    race_channel_id BIGINT,
    maze_channel_id BIGINT,
    absence_channel_id BIGINT,
    
    -- Role Configurations
    leader_role_id BIGINT,
    colead_role_id BIGINT,
    staff_role_id BIGINT,
    member_role_id BIGINT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. USERS TABLE (For individual blacklists and player profiles)
CREATE TABLE users (
    discord_id BIGINT PRIMARY KEY,
    is_blacklisted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. ALIASES TABLE (To prevent pinging users during manual commands)
CREATE TABLE aliases (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    alias_name TEXT NOT NULL,
    UNIQUE(guild_id, alias_name) -- An alias must be unique per server
);

-- 4. WARNINGS TABLE (War punishments)
CREATE TABLE warnings (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    reason TEXT,
    issued_by BIGINT, -- Discord ID of the staff member
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. WARS TABLE (Active War Tracking)
CREATE TABLE wars (
    guild_id BIGINT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    war_start TIMESTAMP WITH TIME ZONE,
    phase TEXT, -- 'defence' or 'attack'
    missing_list JSONB DEFAULT '[]'::jsonb, -- Stores an array of {"name": "Sam", "id": 12345}
    excused_list JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE
);

-- 6. RACE STATE TABLE (Tracks the Race Node progress per server)
CREATE TABLE race_state (
    guild_id BIGINT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    target_laps INTEGER DEFAULT 0,
    current_lap INTEGER DEFAULT 0,
    current_node INTEGER DEFAULT 0,
    task_description TEXT,
    ofa_holder_id BIGINT,
    ofa_target TEXT,
    dyp_progress INTEGER DEFAULT 0,
    dyp_target INTEGER DEFAULT 0,
    je_progress TEXT DEFAULT '0',
    je_target TEXT DEFAULT '0',
    is_event_active BOOLEAN DEFAULT FALSE
);

-- 7. MAZE SCHEDULES TABLE (For upcoming discounts and timers)
CREATE TABLE maze_schedules (
    id BIGSERIAL PRIMARY KEY,
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    event_start TIMESTAMP WITH TIME ZONE,
    event_end TIMESTAMP WITH TIME ZONE,
    discount_schedule JSONB, -- Stores the exact time offsets for 10%, 20%, etc.
    ping_enabled_global BOOLEAN DEFAULT TRUE
);

-- 8. PLAYER PING PREFERENCES (To let players turn Maze pings on/off)
CREATE TABLE player_ping_settings (
    guild_id BIGINT REFERENCES guilds(guild_id) ON DELETE CASCADE,
    discord_id BIGINT REFERENCES users(discord_id) ON DELETE CASCADE,
    maze_pings_enabled BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (guild_id, discord_id)
);

-- Note on Security (RLS): 
-- When you build the dashboard, you will enable Row Level Security (RLS) 
-- on these tables so a user logged into Server A cannot view Server B's data.
-- The Python bot will use the Service Role Key, which bypasses RLS entirely 
-- (since it is a trusted backend).
