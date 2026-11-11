-- Migration: guild-level staff roles and channels
-- Date: 2026-11-11
-- Safe to run repeatedly on an existing Supabase project.
--
-- Why: the dashboard's new Server setup page lets staff set the Leader,
-- Helper staff (co-lead) and Staff role IDs the bot treats as staff, plus the
-- maze/absence channels. These columns exist in the fresh-install CREATE TABLE
-- guilds in shared/schema.sql, but projects created before they were added do
-- not have them — and bot/database.py reads all three staff roles.
--
-- Run this once in the Supabase SQL editor. No data is touched or dropped.

ALTER TABLE guilds ADD COLUMN IF NOT EXISTS leader_role_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS colead_role_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS staff_role_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS member_role_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS maze_channel_id BIGINT;
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS absence_channel_id BIGINT;

-- Per-subteam channel configuration (one team = one war channel + one race
-- channel + captains) is stored in the `teams` and `team_captains` tables.
-- Those tables were introduced earlier; if this project has never run the
-- "MIGRATIONS for existing databases" section of shared/schema.sql, run that
-- whole block once — it creates `teams`, `team_captains`, `team_players` and
-- `war_logs` with IF NOT EXISTS and is safe to re-run.
