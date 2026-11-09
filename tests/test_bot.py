"""Regression tests for the Monster Legends bot (offline, no network).

Run with:  /data/data/com.termux/files/usr/bin/python3 -m pytest tests -q
"""

import types
from datetime import datetime, timezone, timedelta

from fakes import (
    FakeBot,
    FakeChannel,
    FakeGuild,
    FakeMember,
    FakeMessage,
    call,
    make_ctx,
    run,
)

from cogs.admin import Admin
from cogs.maze import MazeTracker
from cogs.race import RaceTracker, format_amount, parse_amount, parse_node_args
from cogs.war import WarTracker, fmt_td, parse_time, phase_at, progress_bar
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
