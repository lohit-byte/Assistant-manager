"""Regression tests for the Monster Legends bot (offline, no network).

Run with:  /data/data/com.termux/files/usr/bin/python3 -m pytest tests -q
"""

import types
from datetime import datetime, timezone, timedelta

from fakes import (
    FakeAttachment,
    FakeBot,
    FakeChannel,
    FakeGuild,
    FakeMember,
    FakeMessage,
    FakeRole,
    call,
    make_ctx,
    run,
)

from cogs.admin import Admin
from cogs.maze import MazeTracker
from cogs.race import RaceTracker, format_amount, parse_amount, parse_node_args, parse_sheet_csv
from cogs.war import WarTracker, _due_pings, _initial_sent, fmt_td, parse_time, phase_at, progress_bar
import ocr_engine

GUILD = 100
CHANNEL = 10


def war_cog():
    return WarTracker(FakeBot())


def race_cog():
    return RaceTracker(FakeBot())


def admin_cog():
    return Admin(FakeBot())


def seed_war(db, **overrides):
    row = {
        "channel_id": CHANNEL,
        "guild_id": GUILD,
        "war_start": "2026-01-01T00:00:00+00:00",
        "phase": "attack",
        "missing_list": [{"name": "sam"}, {"name": "bob"}],
        "absent_list": [],
        "attack_counts": {},
        "is_active": True,
    }
    row.update(overrides)
    db.seed("wars", row)
    return row


def seed_race(db, **overrides):
    row = {
        "channel_id": CHANNEL,
        "guild_id": GUILD,
        "current_lap": 1,
        "current_node": 1,
        "target_laps": 0,
        "task_description": "Kill the dragon",
        "ofa_holder_id": None,
        "ofa_target": "10",
        "ofa_done": False,
        "dyp_progress": 0,
        "dyp_target": 5,
        "dyp_contributors": [],
        "je_progress": "0",
        "je_target": "1000",
        "je_done": False,
        "pending_ofa_message_id": None,
        "pending_ofa_user_id": None,
        "active_race_sheet": None,
    }
    row.update(overrides)
    db.seed("race_state", row)
    return row


# --------------------------------------------------------------------- war


def test_war_attacks_pipe_syntax_records_the_name(clean_db):
    db = clean_db
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL)
    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="| 6"))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"].get("sam") == 6
    assert all(m["name"].lower() != "sam" for m in row["missing_list"])


def test_war_attacks_space_syntax_records_the_name(clean_db):
    db = clean_db
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL)
    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="6"))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"].get("sam") == 6


def test_war_missing_add_resolves_a_mention(clean_db):
    db = clean_db
    seed_war(db, missing_list=[])
    ctx = make_ctx(channel_id=CHANNEL)
    member = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]

    run(war_cog().war_missing(ctx, "add", "<@200>"))

    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert [m["name"] for m in missing] == ["sam"]


def test_war_missing_unknown_subcommand_does_not_remove(clean_db):
    db = clean_db
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL)

    run(war_cog().war_missing(ctx, "bogus", "sam"))

    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert any(m["name"] == "sam" for m in missing)
    assert any("Usage" in text for text in ctx.texts)


def test_attacks_done_message_is_recorded(clean_db):
    db = clean_db
    seed_war(db, missing_list=[{"name": "sam"}, {"name": "bob"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, display_name="Sam")
    war = war_cog()

    # Both documented formats must work: "<n> attacks done" and "attacks done <n>".
    for text, expected in (("4 attacks done", 4), ("attacks done 5", 5)):
        message = FakeMessage(content=text, author=ctx.author,
                              guild=ctx.guild, channel=ctx.channel)
        run(war.on_message(message))
        assert db.one("wars", channel_id=CHANNEL)["attack_counts"]["sam"] == expected
        assert message.replies
        db.one("wars", channel_id=CHANNEL)["missing_list"] = [{"name": "sam"}]


def test_warning_add_creates_missing_user_row(clean_db):
    db = clean_db
    ctx = make_ctx()
    member = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)

    run(call(WarTracker.warning_group, war_cog(), ctx, "add", member.mention, reason="late"))

    assert db.one("warnings", discord_id=200) is not None
    assert db.one("users", discord_id=200) is not None


def test_warning_list_without_target_lists_guild_warnings(clean_db):
    db = clean_db
    db.seed("users", {"discord_id": 200})
    db.seed("warnings", {"id": 1, "guild_id": GUILD, "discord_id": 200, "reason": "late", "issued_by": 1})
    ctx = make_ctx()

    run(call(WarTracker.warning_group, war_cog(), ctx, "list"))

    assert any(embed is not None for _content, embed in ctx.sent)


# ------------------------------------------------------------------ alias


def test_alias_add_creates_missing_user_row(clean_db):
    db = clean_db
    ctx = make_ctx()
    member = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]

    run(call(Admin.alias_group, admin_cog(), ctx, "add", args=f"{member.mention} sam"))

    assert db.one("users", discord_id=200) is not None
    assert db.one("aliases", guild_id=GUILD, discord_id=200, alias_name="sam") is not None


def test_alias_list(clean_db):
    db = clean_db
    db.seed("users", {"discord_id": 200})
    db.seed("aliases", {"guild_id": GUILD, "discord_id": 200, "alias_name": "sam"})
    ctx = make_ctx()

    run(call(Admin.alias_group, admin_cog(), ctx, "list"))

    assert any(embed is not None for _content, embed in ctx.sent)


# ------------------------------------------------------------------- race


def test_race_clear_sets_guild_id(clean_db):
    db = clean_db
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "clear"))

    row = db.one("race_state", channel_id=CHANNEL)
    assert row is not None
    assert row.get("guild_id") == GUILD


def test_race_set_desc_does_not_store_the_keyword(clean_db):
    db = clean_db
    seed_race(db)
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "set", args="desc Kill the dragon"))

    assert db.one("race_state", channel_id=CHANNEL)["task_description"] == "Kill the dragon"


def test_race_dyp_without_target_does_not_report_completion(clean_db):
    db = clean_db
    seed_race(db, dyp_target=0, dyp_contributors=[])
    ctx = make_ctx(channel_id=CHANNEL)

    run(race_cog().handle_task(ctx, "dyp", None, None))

    row = db.one("race_state", channel_id=CHANNEL)
    assert row["dyp_progress"] == 0
    assert row["dyp_contributors"] == []
    assert not any("Target Reached" in text for text in ctx.texts)
    assert any("target" in text.lower() for text in ctx.texts)


def test_race_ofa_release_clears_the_holder(clean_db):
    db = clean_db
    seed_race(db, ofa_holder_id=555, ofa_done=False)
    ctx = make_ctx(channel_id=CHANNEL)

    run(race_cog().handle_task(ctx, "ofa", "release", "ofa release"))

    assert db.one("race_state", channel_id=CHANNEL)["ofa_holder_id"] is None


def test_race_dmp_logs_contribution(clean_db):
    db = clean_db
    seed_race(db, dyp_target=5, dyp_progress=0, dyp_contributors=[])
    ctx = make_ctx(channel_id=CHANNEL)

    run(race_cog().handle_task(ctx, "dyp", None, None))

    row = db.one("race_state", channel_id=CHANNEL)
    assert row["dyp_progress"] == 1
    assert row["dyp_contributors"] == ["1"]


# ------------------------------------------------------------------- maze


def test_maze_ping_survives_uncached_bot_member(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "event_end": "2099-01-01T00:00:00+00:00",
                               "ping_enabled_global": True})
    guild = FakeGuild(GUILD, me=None)  # bot member not cached
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild))

    run(MazeTracker(FakeBot()).ping_discount_at_time(GUILD, channel, "20%", 0))

    assert channel.messages, "maze ping should still be sent without @everyone"


def _maze_bot():
    bot = FakeBot()
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    bot.guilds.append(guild)
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    return bot, guild, channel


def test_maze_restore_uses_guild_channel_fallback(clean_db):
    db = clean_db
    db.one("guilds", guild_id=GUILD)["maze_channel_id"] = CHANNEL
    db.seed("maze_schedules", {"guild_id": GUILD, "channel_id": None,
                               "event_start": "2026-01-01T00:00:00+00:00",
                               "event_end": "2099-01-01T00:00:00+00:00",
                               "maze_type": "7d", "ping_enabled_global": True})
    bot, _guild, channel = _maze_bot()
    tracker = MazeTracker(bot)

    async def scenario():
        await tracker.restore_schedules()
        assert tracker.timers.get(GUILD), "schedule should be restored"
        assert tracker.schedule_signatures.get(GUILD) is not None
        for task in tracker.timers[GUILD]:
            task.cancel()

    run(scenario())


def test_maze_sync_reschedules_after_dashboard_edit(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "channel_id": CHANNEL,
                               "event_start": "2026-01-01T00:00:00+00:00",
                               "event_end": "2099-01-01T00:00:00+00:00",
                               "maze_type": "7d", "ping_enabled_global": True})
    bot, _guild, _channel = _maze_bot()
    tracker = MazeTracker(bot)

    async def scenario():
        await tracker.restore_schedules()
        first = tracker.schedule_signatures[GUILD]
        # unchanged row -> timers are left alone
        await tracker.restore_schedules()
        assert tracker.schedule_signatures[GUILD] == first
        # dashboard edit -> new signature and fresh timers
        db.one("maze_schedules", guild_id=GUILD)["event_end"] = "2099-02-01T00:00:00+00:00"
        await tracker.restore_schedules()
        assert tracker.schedule_signatures[GUILD] != first
        for task in tracker.timers[GUILD]:
            task.cancel()

    run(scenario())


def test_maze_unknown_channel_row_is_cancelled(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "channel_id": 999,
                               "event_end": "2099-01-01T00:00:00+00:00"})
    bot, _guild, _channel = _maze_bot()
    tracker = MazeTracker(bot)
    tracker.timers[GUILD] = []
    tracker.schedule_signatures[GUILD] = ("old",)

    run(tracker.restore_schedules())

    assert GUILD not in tracker.timers


def test_maze_custom_schedule_is_used(clean_db):
    assert MazeTracker._normalise_schedule([[1, 30, "10%"]]) == [(1, 30, "10%")]
    assert MazeTracker._normalise_schedule("nope") is None
    assert MazeTracker._normalise_schedule([[1, 2]]) is None


def test_maze_stale_timer_does_not_ping_after_reschedule(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "event_end": "2099-01-01T00:00:00+00:00",
                               "ping_enabled_global": True})
    _bot, _guild, channel = _maze_bot()
    stale_end = datetime(2099, 2, 1, tzinfo=timezone.utc)

    run(MazeTracker(FakeBot()).ping_discount_at_time(GUILD, channel, "20%", 0, stale_end))

    assert channel.messages == []


# -------------------------------------------------------------- pure logic


def test_parse_time():
    assert parse_time("20h") == timedelta(hours=20)
    assert parse_time("1h30m") == timedelta(hours=1, minutes=30)
    assert parse_time("45m") == timedelta(minutes=45)
    assert parse_time("nope") is None
    assert parse_time("0h") is None


def test_phase_timeline():
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert phase_at(start, start) == "defence"
    assert phase_at(start, start + timedelta(hours=23)) == "defence"
    assert phase_at(start, start + timedelta(hours=25)) == "attack"
    assert phase_at(start, start + timedelta(hours=48)) == "ended"


def test_formatting_helpers():
    assert fmt_td(timedelta(hours=3, minutes=5)) == "3h 5m"
    assert len(progress_bar(50, 100)) == 20
    assert progress_bar(50, 100).count("█") == 10
    assert format_amount(1_500_000) == "1.5 M"
    assert parse_amount("1.2M") == 1_200_000


def test_parse_node_args():
    parsed = parse_node_args("50 hatch | 10 breed | 5 craft")
    assert [task for _value, task in parsed] == ["hatch", "breed", "craft"]
    assert [value for value, _task in parsed] == ["50", "10", "5"]


def test_ocr_clean_val_handles_thousands_separator():
    assert ocr_engine.clean_val("1,200") == 1200
    assert ocr_engine.clean_val("1.2M") == 1_200_000


# ------------------------------------------------------------------- main


def test_command_error_handler_tells_the_user():
    import main as botmain

    ctx = make_ctx()
    ctx.command = types.SimpleNamespace(name="war")
    error = botmain.commands.CommandInvokeError(ValueError("secret internals"))

    run(botmain.on_command_error(ctx, error))

    assert ctx.texts, "the user should get an error message"
    assert all("secret internals" not in text for text in ctx.texts)


def test_help_works_when_trial_expired(clean_db):
    db = clean_db
    db.reset()
    db.seed("guilds", {"guild_id": GUILD, "premium_status": "expired",
                       "trial_ends_at": "2020-01-01T00:00:00+00:00"})
    import main as botmain

    ctx = make_ctx()
    ctx.command = types.SimpleNamespace(name="help")
    assert run(botmain.premium_gate(ctx)) is True

    ctx.command = types.SimpleNamespace(name="war")
    assert run(botmain.premium_gate(ctx)) is False


def test_maze_start_schedules_and_signature(clean_db):
    db = clean_db
    bot, _guild, channel = _maze_bot()
    tracker = MazeTracker(bot)
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.channel = channel

    run(call(MazeTracker.maze_group, tracker, ctx, "start", "7d", arg2="6d12h"))

    row = db.one("maze_schedules", guild_id=GUILD)
    assert row is not None and row["event_end"]
    assert tracker.schedule_signatures.get(GUILD) is not None

    async def cleanup():
        for task in tracker.timers.get(GUILD, []):
            task.cancel()

    run(cleanup())


def test_maze_status_is_public(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "event_start": "2026-01-01T00:00:00+00:00",
                               "event_end": "2099-01-01T00:00:00+00:00",
                               "maze_type": "7d", "ping_enabled_global": True})
    ctx = make_ctx(channel_id=CHANNEL, administrator=False)

    run(call(MazeTracker.maze_group, MazeTracker(FakeBot()), ctx, "status"))

    assert any(embed is not None for _content, embed in ctx.sent)


# ------------------------------------------------- audit round 2 regressions


def test_team_limit_blocks_second_team_via_set_desc(clean_db):
    db = clean_db
    db.one("guilds", guild_id=GUILD)["max_teams"] = 1
    db.seed("race_state", {"channel_id": 20, "guild_id": GUILD,
                           "task_description": "Team A", "is_event_active": False})
    ctx = make_ctx(channel_id=CHANNEL)
    race = race_cog()

    run(call(RaceTracker.race_group, race, ctx, "set", args="desc Team B"))
    assert db.one("race_state", channel_id=CHANNEL) is None
    assert any("Team limit" in text for text in ctx.texts)

    run(call(RaceTracker.race_group, race, ctx, "target", args="20"))
    assert db.one("race_state", channel_id=CHANNEL) is None
    assert sum("Team limit" in text for text in ctx.texts) == 2


def test_war_attacks_resolves_a_mention(clean_db):
    db = clean_db
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL)
    member = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "<@200>", args="6"))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"]["sam"] == 6
    assert row["missing_list"] == []


def test_war_attacks_lowering_count_readds_to_missing(clean_db):
    db = clean_db
    seed_war(db, missing_list=[], attack_counts={"sam": 5})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="2"))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"]["sam"] == 2
    assert any(m["name"] == "sam" for m in row["missing_list"])


def test_race_je_accepts_text_target_from_sheet(clean_db):
    db = clean_db
    seed_race(db, je_target="Breed 36 C", je_progress="0", je_done=False)
    ctx = make_ctx(channel_id=CHANNEL)

    run(race_cog().handle_task(ctx, "je", "+500k", "+500k"))

    row = db.one("race_state", channel_id=CHANNEL)
    assert row["je_progress"] == "500 K"
    assert row["je_done"] is False
    assert not any("Invalid amount" in text for text in ctx.texts)


def test_race_log_insert_does_not_report_failure(clean_db, capsys):
    db = clean_db
    seed_race(db, dyp_target=5, dyp_progress=0, dyp_contributors=[])
    ctx = make_ctx(channel_id=CHANNEL)

    run(race_cog().handle_task(ctx, "dyp", None, None))

    assert db.rows("race_logs"), "race action should be logged"
    assert "Failed to log race action" not in capsys.readouterr().out


def test_force_premium_clears_a_past_expiry(clean_db):
    db = clean_db
    db.reset()
    db.seed("guilds", {"guild_id": GUILD, "premium_status": "premium",
                       "premium_ends_at": "2020-01-01T00:00:00+00:00",
                       "trial_ends_at": "2020-01-01T00:00:00+00:00"})
    import main as botmain
    from database import check_premium_status

    ctx = make_ctx(author_id=botmain.DEVELOPER_ID)
    run(botmain.force_command.callback(ctx, "premium"))

    assert db.one("guilds", guild_id=GUILD)["premium_ends_at"] is None
    assert check_premium_status(GUILD) is True


def test_premium_gate_defers_dm_to_guild_only_check(clean_db):
    import main as botmain

    ctx = make_ctx()
    ctx.guild = None
    ctx.command = types.SimpleNamespace(name="war")
    assert run(botmain.premium_gate(ctx)) is True


def test_parse_node_args_keeps_thousands_separator():
    parsed = parse_node_args("1,200 hatch | 10 breed | 5 craft")
    assert [value for value, _task in parsed] == ["1,200", "10", "5"]
    from cogs.race import clean_val
    assert clean_val("1,200") == 1200


def test_maze_old_date_rolls_into_the_future(clean_db):
    db = clean_db
    bot, _guild, channel = _maze_bot()
    tracker = MazeTracker(bot)
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.channel = channel

    run(call(MazeTracker.maze_group, tracker, ctx, "start", "7d", arg2="01/01/2020"))

    row = db.one("maze_schedules", guild_id=GUILD)
    end = datetime.fromisoformat(row["event_end"].replace("Z", "+00:00"))
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    assert end > datetime.now(timezone.utc)

    async def cleanup():
        for task in tracker.timers.get(GUILD, []):
            task.cancel()

    run(cleanup())


def test_billing_renewal_resets_expired_marker(clean_db):
    from cogs.billing import BillingManager

    db = clean_db
    bot, _guild, _channel = _maze_bot()
    manager = object.__new__(BillingManager)
    manager.bot = bot
    row = db.one("guilds", guild_id=GUILD)
    row.update({"premium_status": "premium",
                "premium_ends_at": "2099-01-01T00:00:00+00:00",
                "last_renewal_ping": -1})

    run(manager._process_guild(dict(row), datetime.now(timezone.utc)))

    assert db.one("guilds", guild_id=GUILD)["last_renewal_ping"] == 0


def test_non_staff_denied_through_async_role_lookup(clean_db):
    ctx = make_ctx(administrator=False)

    run(call(Admin.alias_group, admin_cog(), ctx, "list"))

    assert any("Only Admins" in text for text in ctx.texts)


# --------------------------------------------------- feature: maze alerts


def test_maze_alerts_dm_preference(clean_db):
    db = clean_db
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(MazeTracker.maze_group, MazeTracker(FakeBot()), ctx, "alerts", "dm"))

    row = db.one("player_ping_settings", guild_id=GUILD, discord_id=1)
    assert row["maze_alert_mode"] == "dm"
    assert row["maze_pings_enabled"] is True
    assert any("DM" in text for text in ctx.texts)


def test_maze_alerts_off_preference(clean_db):
    db = clean_db
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(MazeTracker.maze_group, MazeTracker(FakeBot()), ctx, "alerts", "off"))

    row = db.one("player_ping_settings", guild_id=GUILD, discord_id=1)
    assert row["maze_alert_mode"] == "off"
    assert row["maze_pings_enabled"] is False


def test_maze_ping_uses_here_and_dms_opt_ins(clean_db):
    db = clean_db
    bot, guild, channel = _maze_bot()
    member = FakeMember(200, "Sam", administrator=False, guild=guild)
    guild.members.append(member)
    db.seed("users", {"discord_id": 200})
    db.seed("maze_schedules", {"guild_id": GUILD, "event_end": "2099-01-01T00:00:00+00:00",
                               "ping_enabled_global": True, "ping_mention": "here"})
    db.seed("player_ping_settings", {"guild_id": GUILD, "discord_id": 200,
                                     "maze_alert_mode": "dm", "maze_pings_enabled": True})
    db.one("guilds", guild_id=GUILD)["maze_channel_id"] = CHANNEL

    run(MazeTracker(bot).ping_discount_at_time(GUILD, channel, "20%", 0))

    assert any("@here" in (content or "") for content in channel.texts())
    assert member.dms, "a DM-alert player should get a DM"


def test_maze_set_ping_everyone(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "event_end": "2099-01-01T00:00:00+00:00"})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(MazeTracker.maze_group, MazeTracker(FakeBot()), ctx, "set", "ping", arg2="everyone"))

    assert db.one("maze_schedules", guild_id=GUILD)["ping_mention"] == "everyone"


def test_maze_set_ping_role(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "event_end": "2099-01-01T00:00:00+00:00"})
    ctx = make_ctx(channel_id=CHANNEL)
    role = FakeRole(555, "Maze Alerts")
    ctx.guild.roles.append(role)
    ctx.message.role_mentions = [role]

    run(call(MazeTracker.maze_group, MazeTracker(FakeBot()), ctx, "set", "ping", arg2="role"))

    row = db.one("maze_schedules", guild_id=GUILD)
    assert row["ping_mention"] == "role"
    assert row["ping_role_id"] == 555


def test_maze_status_shows_ping_details(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "event_start": "2026-01-01T00:00:00+00:00",
                               "event_end": "2099-01-01T00:00:00+00:00",
                               "maze_type": "7d", "ping_enabled_global": True,
                               "ping_mention": "here"})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(MazeTracker.maze_group, MazeTracker(FakeBot()), ctx, "status"))

    embed = next(e for _c, e in ctx.sent if e is not None)
    field_names = [field.name for field in embed.fields]
    assert "Ping mention" in field_names
    assert "Next discounts" in field_names


# --------------------------------------------------- feature: race sheets


def test_parse_sheet_csv_lap_and_node():
    data = parse_sheet_csv(
        "lap,node,ofa,dyp,je\n1,1,Hatch 5,Collect 20k,5\n1,2,Breed 3,10 members,Craft 2\n"
    )
    assert set(data) == {"1.1", "1.2"}
    assert data["1.1"] == {"ofa": "Hatch 5", "dyp": "Collect 20k", "je": "5"}


def test_parse_sheet_csv_node_key_column():
    data = parse_sheet_csv("node,ofa,dyp,je\n0.1,Hatch,10,5\n")
    assert data == {"0.1": {"ofa": "Hatch", "dyp": "10", "je": "5"}}


def test_upload_sheet_accepts_csv(clean_db):
    db = clean_db
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.message.attachments = [FakeAttachment(
        "nodes.csv", "lap,node,ofa,dyp,je\n1,1,Hatch,10,5\n"
    )]

    run(call(RaceTracker.race_group, race_cog(), ctx, "uploadsheet", args="my sheet"))

    row = db.one("race_sheets", guild_id=GUILD, name="my sheet")
    assert row is not None
    assert row["data"] == {"1.1": {"ofa": "Hatch", "dyp": "10", "je": "5"}}


# --------------------------------------------------- feature: war timeline


def test_war_due_and_initial_pings():
    now = datetime(2026, 1, 3, tzinfo=timezone.utc)
    war_end = now + timedelta(hours=12)
    assert [key for key, _label, _at in _due_pings(war_end, set(), now)] == ["hours_12"]

    # A war that began 40h ago: defence/attack-start/12h reminders are stale.
    war_end = now + timedelta(hours=8)
    initial = _initial_sent(war_end, now)
    assert "defence_30m" in initial
    assert "attack_started" in initial
    assert "hours_12" in initial
    assert "hours_6" not in initial


def test_war_board_embed_matches_live_style():
    now = datetime.now(timezone.utc)
    war = {
        "channel_id": CHANNEL, "guild_id": GUILD,
        "war_start": (now - timedelta(hours=31)).isoformat(),
        "phase": "attack", "is_active": True,
        "missing_list": [{"name": "sam"}],
        "absent_list": [{"name": "FBW SunnyMC47"}],
        "sent_pings": ["defence_30m", "attack_started"],
        "status_message_id": None,
    }
    channel = FakeChannel(CHANNEL, name="FBW")

    embed = WarTracker(FakeBot()).build_embed(war, channel=channel)

    assert embed.title == "⚔️ ATTACK PHASE — FBW"
    assert "Defence phase ended" in embed.description
    fields = {field.name: field.value for field in embed.fields}
    assert "🏖️ Excused (absence channel) — 1" in fields
    assert "12h warning" in fields["🔔 Pings"]
    assert "Pings sent: 2/7" in fields["🔔 Pings"]


def test_war_board_command_posts_live_message(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), phase="defence")
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "board"))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["status_message_id"] is not None
    assert any(embed is not None for _c, embed in ctx.channel.messages)


def test_war_missing_add_pings_the_player(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), missing_list=[])
    db.seed("users", {"discord_id": 200})
    db.seed("aliases", {"guild_id": GUILD, "discord_id": 200, "alias_name": "sam"})
    ctx = make_ctx(channel_id=CHANNEL)
    member = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)

    run(war_cog().war_missing(ctx, "add", "sam"))

    row = db.one("wars", channel_id=CHANNEL)
    assert any(entry.get("id") == 200 for entry in row["missing_list"])
    assert any("<@200>" in (content or "") for content, _embed in ctx.channel.messages)
    assert member.dms


def test_finish_war_pings_staff_roles(clean_db):
    db = clean_db
    db.one("guilds", guild_id=GUILD)["staff_role_id"] = 555
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=49)).isoformat())
    _bot, _guild, channel = _maze_bot()

    run(war_cog().finish_war(CHANNEL, channel))

    assert db.one("wars", channel_id=CHANNEL)["is_active"] is False
    assert any("<@&555>" in (content or "") for content, _embed in channel.messages)


def test_billing_expiry_dms_the_owner(clean_db):
    from cogs.billing import BillingManager

    db = clean_db
    bot, guild, _channel = _maze_bot()
    manager = object.__new__(BillingManager)
    manager.bot = bot
    row = db.one("guilds", guild_id=GUILD)
    row.update({
        "premium_status": "premium",
        "premium_ends_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
        "last_renewal_ping": 0,
    })

    run(manager._process_guild(dict(row), datetime.now(timezone.utc)))

    assert db.one("guilds", guild_id=GUILD)["premium_status"] == "expired"
    assert guild.owner.dms, "the owner should receive a premium-expiry DM"
