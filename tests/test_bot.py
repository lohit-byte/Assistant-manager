"""Regression tests for the Monster Legends bot (offline, no network).

Run with:  /data/data/com.termux/files/usr/bin/python3 -m pytest tests -q
"""

import json
import os
import types
from datetime import datetime, timezone, timedelta

import pytest

import database
from fakes import (
    FakeAttachment,
    FakeBot,
    FakeChannel,
    FakeGuild,
    FakeInteraction,
    FakeMember,
    FakeMessage,
    FakeReactionPayload,
    FakeRole,
    call,
    make_ctx,
    run,
)

from cogs.admin import Admin
from cogs.billing import BillingManager
from cogs.help import Help
from cogs.maze import MazeTracker
from cogs.race import (RaceTracker, clean_val, format_amount, parse_amount,
                       parse_dyp_target, parse_node_args, parse_sheet_csv)
from cogs.team import Teams
from cogs.war import (
    AttackView,
    WarTracker,
    _due_pings,
    _initial_sent,
    _ping_phase_label,
    apply_attack,
    fmt_td,
    join_names,
    log_attack,
    parse_time,
    phase_at,
    progress_bar,
)
import ocr_engine
import node_sheet
from node_sheet import bundled_sheet, default_path, load_nodesheet, parse_nodesheet

GUILD = 100
CHANNEL = 10


def war_cog():
    return WarTracker(FakeBot())


def race_cog():
    return RaceTracker(FakeBot())


def admin_cog():
    return Admin(FakeBot())


def seed_alias(db, discord_id, name, guild=GUILD):
    db.seed("users", {"discord_id": discord_id})
    db.seed("aliases", {"guild_id": guild, "discord_id": discord_id, "alias_name": name})


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
    seed_alias(db, 200, "sam")
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL)
    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="| 6"))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"].get("sam") == 6
    assert all(m["name"].lower() != "sam" for m in row["missing_list"])


def test_war_attacks_space_syntax_records_the_name(clean_db):
    db = clean_db
    seed_alias(db, 200, "sam")
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL)
    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="6"))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"].get("sam") == 6


def test_war_missing_add_resolves_a_mention(clean_db):
    db = clean_db
    seed_alias(db, 200, "sam")
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


def _seed_two_missing_players(db, now):
    seed_alias(db, 200, "sam")
    seed_alias(db, 201, "bob")
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), missing_list=[])


def test_war_missing_add_accepts_several_mentions_in_one_command(clean_db):
    """Staff paste every name at once: treat each @mention as its own player."""
    db = clean_db
    now = datetime.now(timezone.utc)
    _seed_two_missing_players(db, now)
    ctx = make_ctx(channel_id=CHANNEL)
    for member_id, name in ((200, "Sam"), (201, "Bob")):
        ctx.guild.members.append(FakeMember(member_id, name, administrator=False, guild=ctx.guild))

    run(war_cog().war_missing(ctx, "add", "<@200> <@201>"))

    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert {entry["name"] for entry in missing} == {"sam", "bob"}
    text = "\n".join(ctx.texts)
    assert "No alias" not in text
    assert "2 player" in text


def test_war_missing_add_reports_an_unknown_alias_next_to_the_valid_ones(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    _seed_two_missing_players(db, now)
    ctx = make_ctx(channel_id=CHANNEL)

    run(war_cog().war_missing(ctx, "add", "<@200>, ghost"))

    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert [entry["name"] for entry in missing] == ["sam"]
    text = "\n".join(ctx.texts)
    assert "sam" in text
    assert "No alias" in text and "ghost" in text


def test_war_missing_add_keeps_an_alias_name_with_spaces_whole(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_alias(db, 200, "fbw lloyd frontiera")
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), missing_list=[])
    ctx = make_ctx(channel_id=CHANNEL)

    run(war_cog().war_missing(ctx, "add", "fbw lloyd frontiera"))

    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert [entry["name"] for entry in missing] == ["fbw lloyd frontiera"]


def test_war_missing_remove_accepts_several_mentions(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_alias(db, 200, "sam")
    seed_alias(db, 201, "bob")
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(),
             missing_list=[{"name": "sam", "id": 200}, {"name": "bob", "id": 201}])
    ctx = make_ctx(channel_id=CHANNEL)

    run(war_cog().war_missing(ctx, "remove", "<@200> <@201>"))

    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []


def test_attacks_done_message_is_recorded(clean_db):
    db = clean_db
    seed_alias(db, 1, "sam")
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


def test_attacks_done_handlers_are_registered_discord_listeners(clean_db):
    """Regression: calling the coroutine directly in tests bypasses discord's registration."""
    assert getattr(WarTracker.on_message, "__cog_listener__", False)
    assert getattr(WarTracker.on_raw_reaction_add, "__cog_listener__", False)


def test_attacks_done_accepts_a_fraction_of_the_requirement(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done 4/6", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"]["sam"] == 4
    # 4 of 6 is a partial report: the player still owes attacks, so they stay missing.
    assert any(entry.get("name") == "sam" for entry in row["missing_list"])


def test_attacks_done_fraction_at_the_target_clears_the_missing_entry(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done 6/6", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"]["sam"] == 6
    assert row["missing_list"] == []


def test_attacks_done_with_a_trailing_reaction_is_still_plain(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done ✅", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"]["sam"] == 6


def test_long_message_mentioning_attacks_done_is_not_recorded(clean_db):
    """A chat line is not a report: tag the player and ask for the plain message."""
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done lol", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"] == {}
    assert db.rows("war_logs") == []
    assert message.replies and "<@900>" in message.replies[0]
    assert "attacks done" in message.replies[0]
    assert message.reactions == ["❓"]


def test_long_message_from_a_player_who_already_reported_is_left_alone(clean_db):
    """Nothing is left to record, so the bot does not nag finished players."""
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[], attack_counts={"sam": 6})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done lol", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    assert message.replies == []
    assert message.reactions == []
    assert db.rows("war_logs") == []


def test_attacks_done_outside_an_active_war_is_ignored(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, is_active=False, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done 6/6", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"] == {}


def test_warning_add_creates_missing_user_row(clean_db):
    db = clean_db
    seed_alias(db, 200, "sam")
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
    seed_alias(db, 1, "tester")
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
    seed_alias(db, 1, "tester")
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
    seed_alias(db, 200, "sam")
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
    seed_alias(db, 200, "sam")
    seed_war(db, missing_list=[], attack_counts={"sam": 5})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="2"))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"]["sam"] == 2
    assert any(m["name"] == "sam" for m in row["missing_list"])


def test_race_je_accepts_text_target_from_sheet(clean_db):
    db = clean_db
    seed_alias(db, 1, "tester")
    seed_race(db, je_target="Breed 36 C", je_progress="0", je_done=False)
    ctx = make_ctx(channel_id=CHANNEL)

    run(race_cog().handle_task(ctx, "je", "+500k", "+500k"))

    row = db.one("race_state", channel_id=CHANNEL)
    assert row["je_progress"] == "500 K"
    assert row["je_done"] is False
    assert not any("Invalid amount" in text for text in ctx.texts)


def test_race_log_insert_does_not_report_failure(clean_db, capsys):
    db = clean_db
    seed_alias(db, 1, "tester")
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


def test_war_missing_add_is_alias_only_and_does_not_ping(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), missing_list=[])
    seed_alias(db, 200, "sam")
    ctx = make_ctx(channel_id=CHANNEL)
    member = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)

    run(war_cog().war_missing(ctx, "add", "sam"))

    row = db.one("wars", channel_id=CHANNEL)
    assert any(entry.get("id") == 200 for entry in row["missing_list"])
    # Pings only happen in announcement messages, never as a command side effect.
    assert not member.dms
    assert all("<@200>" not in (content or "") for content, _embed in ctx.channel.messages)


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


def test_war_board_stop_disables_auto_board(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), phase="defence")
    ctx = make_ctx(channel_id=CHANNEL)
    tracker = war_cog()

    run(call(WarTracker.war_group, tracker, ctx, "board"))
    run(call(WarTracker.war_group, tracker, ctx, "board", "stop"))

    assert db.one("wars", channel_id=CHANNEL)["status_message_id"] == -1


# ------------------------------------------- aliases-only + announcement pings


def test_war_team_role_is_pinged_in_announcements(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    war = seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), team_role_id=777)
    _bot, guild, channel = _maze_bot()
    guild.roles.append(FakeRole(777, "Team A"))
    tracker = war_cog()

    run(tracker._send_ping(channel, "⏰ test reminder", war=war))

    assert any("<@&777>" in (content or "") for content, _embed in channel.messages)
    allowed = channel.sent_kwargs[-1]["allowed_mentions"]
    assert allowed.roles is True
    assert allowed.everyone is False


def test_war_announcement_falls_back_to_here(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    war = seed_war(db, war_start=(now - timedelta(hours=1)).isoformat())
    _bot, _guild, channel = _maze_bot()
    tracker = war_cog()

    run(tracker._send_ping(channel, "⏰ test reminder", war=war))

    assert any("@here" in (content or "") for content, _embed in channel.messages)
    assert channel.sent_kwargs[-1]["allowed_mentions"].everyone is True


def test_war_12h_reminder_mentions_team_role_and_missing_players(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=36)
    seed_alias(db, 200, "sam")
    war = seed_war(db, war_start=start.isoformat(), team_role_id=777,
                   missing_list=[{"name": "sam", "id": 200}])
    _bot, guild, channel = _maze_bot()
    guild.roles.append(FakeRole(777, "Team A"))
    guild.members.append(FakeMember(200, "Sam", guild=guild))
    tracker = war_cog()

    run(tracker.send_reminder(channel, war, start, "hours_12", "12h warning"))

    content = channel.last_text()
    assert "<@&777>" in content
    assert "<@200>" in content
    assert content.count("<@200>") == 1  # role prefix + missing mention, no duplicate
    assert "12 hours left" in content
    assert "@everyone" not in content


def test_war_missing_rejects_unknown_alias(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), missing_list=[])
    ctx = make_ctx(channel_id=CHANNEL)

    run(war_cog().war_missing(ctx, "add", "ghost"))

    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []
    assert any("No alias" in text for text in ctx.texts)


def test_war_attacks_rejects_unknown_alias(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "ghost", args="6"))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"] == {}
    assert any("No alias" in text for text in ctx.texts)


def test_attack_logging_requires_an_alias(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(),
             missing_list=[{"name": "bob"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, display_name="Bob")
    message = FakeMessage(content="2 attacks done", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"] == {}
    assert message.replies
    assert "alias" in (message.replies[0] or "")


def test_warning_add_requires_an_alias(clean_db):
    db = clean_db
    ctx = make_ctx()
    member = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)

    run(call(WarTracker.warning_group, war_cog(), ctx, "add", member.mention, reason="late"))

    assert db.rows("warnings") == []
    assert any("no alias" in text.lower() for text in ctx.texts)


def test_war_set_role_command(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat())
    ctx = make_ctx(channel_id=CHANNEL)
    role = FakeRole(777, "Team A")
    ctx.guild.roles.append(role)
    ctx.message.role_mentions = [role]

    run(call(WarTracker.war_group, war_cog(), ctx, "set", "role", args="<@&777>"))

    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 777
    # The confirmation names the role; a live mention would ping the whole team
    # from a plain command reply.
    assert any("Team A" in text for text in ctx.texts)
    assert all("<@&777>" not in text for text in ctx.texts)


def test_war_board_shows_team_role(clean_db):
    now = datetime.now(timezone.utc)
    war = {
        "guild_id": GUILD, "channel_id": CHANNEL, "is_active": True,
        "war_start": (now - timedelta(hours=1)).isoformat(),
        "phase": "defence", "missing_list": [], "absent_list": [],
        "sent_pings": [], "team_role_id": 777, "status_message_id": None,
    }
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    guild.roles.append(FakeRole(777, "Team A"))
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild, name="team-a"))

    embed = war_cog().build_embed(war, channel=channel)

    fields = {field.name: field.value for field in embed.fields}
    assert fields.get("🔔 Team role") == "<@&777>"


def test_war_team_role_survives_starting_the_next_war(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=60)).isoformat(), phase="ended",
             is_active=False, team_role_id=777)
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "defence", "ends", args="20h"))

    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 777


def test_finish_war_falls_back_to_the_team_role_without_staff_roles(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    war = seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), team_role_id=777)
    _bot, guild, channel = _maze_bot()
    guild.roles.append(FakeRole(777, "Team A"))
    tracker = war_cog()

    run(tracker._send_staff_ping(channel, tracker.build_embed(war), war))

    assert any("<@&777>" in (content or "") for content, _embed in channel.messages)
    assert channel.sent_kwargs[-1]["allowed_mentions"].roles is True


def test_war_missing_remove_works_after_the_alias_is_deleted(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(),
             missing_list=[{"name": "ghost"}])
    ctx = make_ctx(channel_id=CHANNEL)

    run(war_cog().war_missing(ctx, "remove", "ghost"))

    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []


def test_attack_logging_prefers_the_alias_tracked_by_the_war(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_alias(db, 1, "s4m")
    seed_alias(db, 1, "sam")
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(),
             missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL)
    message = FakeMessage(content="6 attacks done", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"] == {"sam": 6}
    assert row["missing_list"] == []


def test_war_set_role_accepts_a_raw_id_and_none(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat())
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.guild.roles.append(FakeRole(777, "Team A"))
    ctx.message.role_mentions = []
    tracker = war_cog()

    run(call(WarTracker.war_group, tracker, ctx, "set", "ROLE", args="777"))
    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 777

    run(call(WarTracker.war_group, tracker, ctx, "set", "role", args="none"))
    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] is None


def test_war_absent_add_and_remove_by_alias(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_alias(db, 200, "sam")
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(),
             missing_list=[{"name": "sam"}], absent_list=[])
    ctx = make_ctx(channel_id=CHANNEL)
    tracker = war_cog()

    run(tracker.war_absent(ctx, "add", "sam"))
    row = db.one("wars", channel_id=CHANNEL)
    assert [a.get("name") for a in row["absent_list"]] == ["sam"]
    assert row["missing_list"] == []

    run(tracker.war_absent(ctx, "remove", "sam"))
    assert db.one("wars", channel_id=CHANNEL)["absent_list"] == []


def test_war_absent_add_accepts_several_mentions(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_alias(db, 200, "sam")
    seed_alias(db, 201, "bob")
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(),
             missing_list=[{"name": "sam"}, {"name": "bob"}], absent_list=[])
    ctx = make_ctx(channel_id=CHANNEL)

    run(war_cog().war_absent(ctx, "add", "<@200> <@201>"))

    row = db.one("wars", channel_id=CHANNEL)
    assert {entry["name"] for entry in row["absent_list"]} == {"sam", "bob"}
    assert row["missing_list"] == []


# -------------------------------------------------- feature: team captains


def seed_team(db, team_id=1, guild=GUILD, name="A", war_channel_id=CHANNEL,
              race_channel_id=None, team_role_id=None,
              attacks_required=None, exempt_absent=None):
    db.seed("teams", {"id": team_id, "guild_id": guild, "name": name,
                      "war_channel_id": war_channel_id,
                      "race_channel_id": race_channel_id,
                      "team_role_id": team_role_id,
                      "attacks_required": attacks_required,
                      "exempt_absent": exempt_absent})
    return team_id


def seed_team_player(db, team_id, discord_id, alias=None):
    db.seed("users", {"discord_id": discord_id})
    db.seed("team_players", {"team_id": team_id, "discord_id": discord_id})
    if alias:
        db.seed("aliases", {"guild_id": GUILD, "discord_id": discord_id, "alias_name": alias})


def seed_captain(db, team_id, discord_id):
    db.seed("users", {"discord_id": discord_id})
    db.seed("team_captains", {"team_id": team_id, "discord_id": discord_id})


def start_war(cog, ctx, phase="attack", time_left="20h"):
    """Start a war without leaving the live status updater running in the test loop."""
    async def _noop(*_args, **_kwargs):
        return None

    cog.status_updater = _noop
    run(cog.start_timer(ctx, phase, time_left))
    return cog


def _war_started_fields(ctx):
    embed = next(
        embed for _content, embed in ctx.sent
        if embed is not None and "War tracking started" in str(embed.title)
    )
    return {field.name: field.value for field in embed.fields}


def test_war_start_fills_missing_from_the_team_roster(clean_db):
    """The bot cannot see in-game attacks, so every rostered alias starts missing."""
    db = clean_db
    team_id = seed_team(db, war_channel_id=CHANNEL)
    seed_team_player(db, team_id, 200, alias="sam")
    seed_team_player(db, team_id, 201, alias="bob")
    seed_team_player(db, team_id, 202)  # rostered, but still has no alias
    ctx = make_ctx(channel_id=CHANNEL)

    start_war(war_cog(), ctx)

    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert {entry["name"] for entry in missing} == {"sam", "bob"}
    assert {int(entry["id"]) for entry in missing} == {200, 201}
    field = _war_started_fields(ctx)["Missing list"]
    assert "2" in field
    assert "no alias" in field.lower()


def test_war_start_seeds_one_alias_for_a_player_who_has_two(clean_db):
    db = clean_db
    team_id = seed_team(db, war_channel_id=CHANNEL)
    seed_team_player(db, team_id, 200, alias="sam")
    db.seed("aliases", {"guild_id": GUILD, "discord_id": 200, "alias_name": "s4m"})
    seed_team_player(db, team_id, 201, alias="bob")
    ctx = make_ctx(channel_id=CHANNEL)

    start_war(war_cog(), ctx)

    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert len(missing) == 2
    assert {int(entry["id"]) for entry in missing} == {200, 201}


def test_war_start_without_a_team_keeps_the_missing_list_manual(clean_db):
    db = clean_db
    ctx = make_ctx(channel_id=CHANNEL)

    start_war(war_cog(), ctx)

    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []
    assert "Not auto-filled" in _war_started_fields(ctx)["Missing list"]


def test_war_start_with_an_empty_roster_points_staff_at_team_add(clean_db):
    db = clean_db
    seed_team(db, name="FBW", war_channel_id=CHANNEL)
    ctx = make_ctx(channel_id=CHANNEL)

    start_war(war_cog(), ctx)

    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []
    note = _war_started_fields(ctx)["Missing list"]
    assert "no players on its roster" in note.lower()
    assert "!team add" in note


def test_rebasing_an_active_war_keeps_reports_and_missing_entries(clean_db):
    """Re-issuing the timer mid-war must not wipe what players already reported."""
    db = clean_db
    team_id = seed_team(db, war_channel_id=CHANNEL)
    seed_team_player(db, team_id, 200, alias="sam")
    seed_team_player(db, team_id, 201, alias="bob")
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(),
             missing_list=[{"name": "bob", "id": 201}], attack_counts={"sam": 6})
    ctx = make_ctx(channel_id=CHANNEL)

    start_war(war_cog(), ctx, time_left="10h")

    row = db.one("wars", channel_id=CHANNEL)
    assert row["missing_list"] == [{"name": "bob", "id": 201}]
    assert row["attack_counts"] == {"sam": 6}


def test_war_missing_add_refuses_a_player_who_already_reported(clean_db):
    """Self-report is the source of truth: a done player is never put back on missing."""
    db = clean_db
    seed_alias(db, 200, "sam")
    seed_war(db, missing_list=[], attack_counts={"sam": 6})
    ctx = make_ctx(channel_id=CHANNEL)

    run(war_cog().war_missing(ctx, "add", "sam"))

    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []
    assert any("already reported" in text for text in ctx.texts)


def test_fake_db_in_filter(clean_db):
    db = clean_db
    db.seed("teams", {"id": 1}, {"id": 2}, {"id": 3})

    rows = db.table("teams").select("id").in_("id", [1, 3]).execute().data

    assert [row["id"] for row in rows] == [1, 3]


def test_fake_db_team_captains_enforces_foreign_keys(clean_db):
    db = clean_db

    with pytest.raises(RuntimeError):
        db.table("team_captains").insert({"team_id": 5, "discord_id": 900}).execute()


def test_team_captain_map_resolves_war_and_race_channels(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=10, race_channel_id=11)
    seed_captain(db, 1, 900)
    database._team_cache.clear()

    assert database.get_team_captain_map(GUILD) == {10: {900}, 11: {900}}


def test_team_captain_map_without_teams_is_empty(clean_db):
    database._team_cache.clear()

    assert database.get_team_captain_map(GUILD) == {}


def test_captain_is_team_staff_but_not_global_staff(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL, race_channel_id=11)
    seed_captain(db, 1, 900)
    database._team_cache.clear()
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    captain = FakeMember(900, "Cap", administrator=False, guild=guild)

    assert run(database.is_team_staff(captain, CHANNEL)) is True
    assert run(database.is_team_staff(captain, 11)) is True
    assert run(database.is_team_staff(captain, 12)) is False
    assert run(database.is_staff_member(captain)) is False


def test_plain_member_is_not_team_staff(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL, race_channel_id=11)
    seed_captain(db, 1, 900)
    database._team_cache.clear()
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    member = FakeMember(901, "Plain", administrator=False, guild=guild)

    assert run(database.is_team_staff(member, CHANNEL)) is False
    assert run(database.is_team_staff(member, 11)) is False


def test_staff_role_columns_cover_leader_helper_and_staff(clean_db):
    """Dashboard "Server setup" edits Leader / Helper staff (co-lead) / Staff role ids on
    guilds. The bot must treat all three as staff, otherwise a role saved in the dashboard
    would still be denied the bot's staff commands."""
    db = clean_db
    db.one("guilds", guild_id=GUILD).update(
        {"leader_role_id": 111, "colead_role_id": 222, "staff_role_id": 333}
    )
    database._role_cache.clear()

    assert database.get_staff_role_ids(GUILD) == {111, 222, 333}

    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    for member_id, role_id in ((901, 111), (902, 222), (903, 333)):
        member = FakeMember(member_id, "Tier", administrator=False, guild=guild)
        member.roles = [FakeRole(role_id)]
        assert run(database.is_staff_member(member)) is True

    outsider = FakeMember(904, "Outsider", administrator=False, guild=guild)
    outsider.roles = [FakeRole(444)]
    assert run(database.is_staff_member(outsider)) is False


def test_staff_lookup_tolerates_guilds_without_role_columns(clean_db):
    """An existing database that predates the role columns returns a row without
    them; the lookup must yield an empty set instead of raising and denying staff."""
    database._role_cache.clear()

    assert database.get_staff_role_ids(GUILD) == set()


def test_global_staff_is_team_staff_without_any_team(clean_db):
    database._team_cache.clear()
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    admin = FakeMember(902, "Admin", administrator=True, guild=guild)

    assert run(database.is_team_staff(admin, CHANNEL)) is True


def test_team_captain_lookup_failure_is_not_a_captain(clean_db, monkeypatch):
    database._team_cache.clear()

    class BrokenClient:
        def table(self, name):
            raise RuntimeError("teams table missing")

    monkeypatch.setattr(database, "supabase", BrokenClient())
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    member = FakeMember(900, "Cap", administrator=False, guild=guild)

    assert database.get_team_captain_map(GUILD) == {}
    assert run(database.is_team_staff(member, CHANNEL)) is False


def test_team_captain_map_is_cached(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL)
    seed_captain(db, 1, 900)
    database._team_cache.clear()

    assert database.get_team_captain_map(GUILD) == {CHANNEL: {900}}
    calls_after_first = len(db.calls)
    assert database.get_team_captain_map(GUILD) == {CHANNEL: {900}}
    assert len(db.calls) == calls_after_first


# ------------------------------------------------------ feature: alias rename


def test_alias_rename_moves_war_data_to_the_new_name(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, attack_counts={"sam": 4}, missing_list=[{"name": "sam"}],
             absent_list=[{"name": "bob"}])
    ctx = make_ctx()

    run(call(Admin.alias_group, admin_cog(), ctx, "rename", args="sam sammy"))

    assert db.one("aliases", alias_name="sammy", guild_id=GUILD)
    assert db.one("aliases", alias_name="sam", guild_id=GUILD) is None
    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"sammy": 4}
    assert war["missing_list"] == [{"name": "sammy"}]
    assert war["absent_list"] == [{"name": "bob"}]


def test_alias_rename_also_renames_excused_and_other_wars(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, channel_id=CHANNEL, attack_counts={"sam": 2},
             missing_list=[], absent_list=[{"name": "sam"}])
    seed_war(db, channel_id=12, attack_counts={"bob": 6},
             missing_list=[{"name": "sam"}], absent_list=[])
    ctx = make_ctx()

    run(call(Admin.alias_group, admin_cog(), ctx, "rename", args="SAM Sammy"))

    first = db.one("wars", channel_id=CHANNEL)
    second = db.one("wars", channel_id=12)
    assert first["attack_counts"] == {"sammy": 2}
    assert first["absent_list"] == [{"name": "sammy"}]
    assert second["attack_counts"] == {"bob": 6}
    assert second["missing_list"] == [{"name": "sammy"}]


def test_alias_rename_rejects_duplicate_and_unknown(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_alias(db, 901, "sammy")
    ctx = make_ctx()
    cog = admin_cog()

    run(call(Admin.alias_group, cog, ctx, "rename", args="sam sammy"))
    assert any("already exists" in text for text in ctx.texts)
    assert db.one("aliases", alias_name="sam", guild_id=GUILD) is not None

    ctx.sent.clear()
    run(call(Admin.alias_group, cog, ctx, "rename", args="ghost ghosty"))
    assert any("No alias named" in text for text in ctx.texts)


def test_alias_rename_requires_guild_staff(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    ctx = make_ctx(administrator=False)

    run(call(Admin.alias_group, admin_cog(), ctx, "rename", args="sam sammy"))

    assert db.one("aliases", alias_name="sam", guild_id=GUILD) is not None
    assert any("Only Admins" in text for text in ctx.texts)


def test_rename_alias_helper_returns_errors_instead_of_raising(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")

    assert "No alias named" in database.rename_alias(GUILD, "ghost", "ghosty")
    assert database.rename_alias(GUILD, "sam", "sammy") is None
    assert "already exists" in database.rename_alias(GUILD, "sammy", "sammy")


# -------------------------------------------------- feature: I attacked button


def test_apply_attack_caps_and_removes_missing():
    war = {"attack_counts": {"sam": 5}, "missing_list": [{"name": "sam"}]}

    counts, missing = apply_attack(war, "sam", 1, 6)

    assert counts == {"sam": 6} and missing == []


def test_apply_attack_never_exceeds_required_or_goes_negative():
    counts, _missing = apply_attack({"attack_counts": {"sam": 6}}, "sam", 1, 6)
    assert counts == {"sam": 6}

    counts, _missing = apply_attack({"attack_counts": {"sam": 1}}, "sam", -5, 6)
    assert counts == {"sam": 0}

    counts, missing = apply_attack(
        {"attack_counts": {}, "missing_list": [{"name": "sam"}]}, "sam", 1, 6)
    assert counts == {"sam": 1}
    assert missing == [{"name": "sam"}]  # still missing below the requirement


def test_attack_view_is_persistent():
    async def scenario():
        view = AttackView()
        return view, view.children[0]

    view, button = run(scenario())

    assert view.timeout is None
    assert button.custom_id == "war:i_attacked"
    assert button.label == "✅ I attacked"


def test_attack_view_is_registered_on_cog_load(clean_db):
    bot = FakeBot()
    tracker = WarTracker(bot)

    async def scenario():
        tracker.register_persistent_views()

    run(scenario())

    assert any(getattr(view, "timeout", "missing") is None for view in bot.views)
    registered = bot.views[0]
    assert registered.children[0].custom_id == "war:i_attacked"


def test_attacks_done_message_writes_a_war_log(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    log = db.rows("war_logs")[-1]
    assert (log["channel_id"], log["player_name"], log["attacks"], log["source"]) == (
        CHANNEL, "sam", 6, "self")
    assert log["guild_id"] == GUILD
    assert log["discord_id"] == 900
    assert log["war_start"] == "2026-01-01T00:00:00+00:00"


def test_attack_button_records_one_attack(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={"sam": 5})
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    user = FakeMember(900, "Sam", administrator=False, guild=guild)
    interaction = FakeInteraction(user=user, guild=guild, channel=channel)

    run(war_cog()._handle_attack_press(interaction))

    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"sam": 6}
    assert war["missing_list"] == []
    log = db.rows("war_logs")[-1]
    assert (log["player_name"], log["attacks"], log["source"]) == ("sam", 1, "self")
    assert any("6/6" in text for text in interaction.texts)
    assert all(ephemeral is True for ephemeral in interaction.response.ephemeral)


def test_attack_button_and_text_never_double_count(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={"sam": 5})
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    user = FakeMember(900, "Sam", administrator=False, guild=guild)
    tracker = war_cog()

    for _ in range(3):
        run(tracker._handle_attack_press(
            FakeInteraction(user=user, guild=guild, channel=channel)))
    message = FakeMessage(content="attacks done", author=user,
                          guild=guild, channel=channel)
    run(tracker.on_message(message))

    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"sam": 6}
    assert war["missing_list"] == []
    assert sum(row["attacks"] for row in db.rows("war_logs")) == 1
    assert [row["attacks"] for row in db.rows("war_logs")] == [1]


def test_attack_button_without_an_alias_is_ephemeral(clean_db):
    db = clean_db
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    user = FakeMember(901, "NoAlias", administrator=False, guild=guild)
    interaction = FakeInteraction(user=user, guild=guild, channel=channel)

    run(war_cog()._handle_attack_press(interaction))

    assert db.rows("war_logs") == []
    assert any("alias" in text.lower() for text in interaction.texts)
    assert all(ephemeral is True for ephemeral in interaction.response.ephemeral)


def test_attack_button_reports_no_active_war(clean_db):
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    user = FakeMember(900, "Sam", administrator=False, guild=guild)
    interaction = FakeInteraction(user=user, guild=guild, channel=channel)

    run(war_cog()._handle_attack_press(interaction))

    assert any("No active war" in text for text in interaction.texts)
    assert interaction.response.messages


def test_undo_reaction_writes_a_negative_log(clean_db):
    db = clean_db
    seed_alias(db, 200, "sam")
    seed_war(db, missing_list=[], attack_counts={"sam": 6})
    bot = FakeBot()
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    bot.guilds.append(guild)
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    reactor = FakeMember(1, "Staff", administrator=True, guild=guild)
    guild.members.append(reactor)
    tracker = WarTracker(bot)
    tracker.done_replies[555] = {"name": "sam", "id": 200}

    run(tracker.on_raw_reaction_add(
        FakeReactionPayload(guild_id=GUILD, channel_id=CHANNEL, message_id=555, user_id=1)))

    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"sam": 0}
    assert any(entry.get("name") == "sam" for entry in war["missing_list"])
    log = db.rows("war_logs")[-1]
    assert (log["player_name"], log["attacks"], log["source"]) == ("sam", -6, "undo")
    assert channel.messages


def test_war_board_message_carries_the_attack_view(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    seed_war(db, war_start=(now - timedelta(hours=1)).isoformat(), phase="defence")
    ctx = make_ctx(channel_id=CHANNEL)
    tracker = war_cog()

    run(call(WarTracker.war_group, tracker, ctx, "board"))

    view = ctx.channel.sent_kwargs[-1].get("view")
    assert view is not None
    assert view.children[0].custom_id == "war:i_attacked"
    assert view.timeout is None


def test_war_reminder_carries_the_attack_view(clean_db):
    db = clean_db
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=36)
    war = seed_war(db, war_start=start.isoformat(), missing_list=[{"name": "sam"}])
    _bot, _guild, channel = _maze_bot()
    tracker = war_cog()

    run(tracker.send_reminder(channel, war, start, "hours_12", "12h warning"))

    assert channel.sent_kwargs[-1].get("view") is not None


# --------------------------------------------- feature: bundled node sheet


NODE_1_2 = {"1.2": {"ofa": "Hatch 5", "dyp": "10 members", "je": "5"}}
NODE_1_3 = {"1.3": {"ofa": "Breed 3", "dyp": "5 members", "je": "2"}}


def write_nodesheet(tmp_path, payload, monkeypatch, name="nodesheet.json"):
    path = tmp_path / name
    if isinstance(payload, str):
        path.write_text(payload, encoding="utf-8")
    else:
        path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setenv("NODESHEET_PATH", str(path))
    return path


def test_parse_nodesheet_accepts_wrapper_and_skips_bad_nodes():
    data, warnings = parse_nodesheet({
        "nodes": {
            "0.1": {"ofa": "a", "dyp": "b", "je": "c"},
            "0.2": {"ofa": "a"},
        }
    })

    assert data == {"0.1": {"ofa": "a", "dyp": "b", "je": "c"}}
    assert len(warnings) == 1


def test_parse_nodesheet_rejects_bad_top_level():
    with pytest.raises(ValueError):
        parse_nodesheet(["nope"])
    with pytest.raises(ValueError):
        parse_nodesheet({"nodes": "nope"})


def test_parse_nodesheet_skips_a_node_without_lap_context():
    data, warnings = parse_nodesheet({
        "1": {"ofa": "a", "dyp": "b", "je": "c"},
        "0.1": {"ofa": "a", "dyp": "b", "je": "c"},
    })

    assert set(data) == {"0.1"}
    assert warnings


def test_default_path_uses_the_environment_override(tmp_path, monkeypatch):
    path = tmp_path / "sheet.json"
    monkeypatch.setenv("NODESHEET_PATH", str(path))

    assert default_path() == str(path)


def test_missing_or_broken_nodesheet_is_ignored(tmp_path, monkeypatch):
    monkeypatch.setenv("NODESHEET_PATH", str(tmp_path / "missing.json"))
    assert load_nodesheet() is None
    assert bundled_sheet() is None

    write_nodesheet(tmp_path, "{ not valid json", monkeypatch)
    assert load_nodesheet() is None


def test_load_nodesheet_tolerates_bom_and_whitespace(tmp_path, monkeypatch):
    write_nodesheet(tmp_path, "\ufeff\n  " + json.dumps(NODE_1_2) + "\n", monkeypatch)

    assert load_nodesheet() == NODE_1_2


def test_load_nodesheet_reloads_when_the_file_changes(tmp_path, monkeypatch):
    path = write_nodesheet(tmp_path, NODE_1_2, monkeypatch)
    assert load_nodesheet() == NODE_1_2

    path.write_text(json.dumps(NODE_1_3), encoding="utf-8")
    future = os.path.getmtime(path) + 10
    os.utime(path, (future, future))

    assert load_nodesheet() == NODE_1_3


def test_race_next_falls_back_to_the_bundled_sheet(clean_db, monkeypatch, tmp_path):
    db = clean_db
    write_nodesheet(tmp_path, NODE_1_2, monkeypatch)
    seed_race(db, current_lap=1, current_node=1, active_race_sheet=None)
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "next"))

    row = db.one("race_state", channel_id=CHANNEL)
    assert (row["current_lap"], row["current_node"]) == (1, 2)
    assert row["dyp_target"] == 10
    assert any("default (bundled)" in text for text in ctx.texts)


def test_race_use_default_selects_the_bundled_sheet(clean_db, monkeypatch, tmp_path):
    db = clean_db
    write_nodesheet(tmp_path, NODE_1_2, monkeypatch)
    seed_race(db, active_race_sheet=None)
    ctx = make_ctx(channel_id=CHANNEL)
    race = race_cog()

    run(call(RaceTracker.race_group, race, ctx, "use", args="default"))
    assert db.one("race_state", channel_id=CHANNEL)["active_race_sheet"] == "default"

    run(call(RaceTracker.race_group, race, ctx, "use", args="bundled"))
    assert db.one("race_state", channel_id=CHANNEL)["active_race_sheet"] == "default"


def test_race_use_default_without_a_bundled_sheet_errors(clean_db, monkeypatch, tmp_path):
    db = clean_db
    monkeypatch.setenv("NODESHEET_PATH", str(tmp_path / "missing.json"))
    seed_race(db, active_race_sheet=None)
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "use", args="default"))

    assert db.one("race_state", channel_id=CHANNEL)["active_race_sheet"] is None
    assert any("bundled" in text.lower() for text in ctx.texts)


def test_race_sheets_lists_guild_sheets_and_the_bundled_default(clean_db, monkeypatch, tmp_path):
    db = clean_db
    write_nodesheet(tmp_path, NODE_1_2, monkeypatch)
    db.seed("race_sheets", {"id": 1, "guild_id": GUILD, "name": "alpha", "data": {}})
    db.seed("race_sheets", {"id": 2, "guild_id": GUILD, "name": "beta", "data": {}})
    seed_race(db, active_race_sheet="alpha")
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "sheets"))

    text = " ".join(ctx.texts)
    assert "alpha" in text and "beta" in text
    assert "default (bundled)" in text


def test_race_log_records_channel_and_node(clean_db):
    db = clean_db
    seed_alias(db, 1, "tester")
    seed_race(db, current_lap=1, current_node=1)
    ctx = make_ctx(channel_id=CHANNEL)

    run(race_cog().handle_task(ctx, "dyp", None, None))

    log = db.rows("race_logs")[-1]
    assert (log["channel_id"], log["lap"], log["node"]) == (CHANNEL, 1, 1)


def test_ofa_claim_reaction_logs_channel_lap_node(clean_db):
    db = clean_db
    seed_race(db, current_lap=2, current_node=3,
              pending_ofa_message_id=555, pending_ofa_user_id=200)
    bot, guild, channel = _maze_bot()
    guild.members.append(FakeMember(1, "Staff", administrator=True, guild=guild))
    tracker = race_cog()
    tracker.bot = bot

    run(tracker.on_raw_reaction_add(
        FakeReactionPayload(guild_id=GUILD, channel_id=CHANNEL, message_id=555, user_id=1,
                            emoji="✅")))

    log = db.rows("race_logs")[-1]
    assert (log["channel_id"], log["lap"], log["node"]) == (CHANNEL, 2, 3)


def test_missing_or_broken_nodesheet_does_not_crash_a_command(clean_db, monkeypatch, tmp_path):
    db = clean_db
    write_nodesheet(tmp_path, "{ not valid json", monkeypatch)
    seed_race(db, current_lap=1, current_node=1, active_race_sheet=None)
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "next"))

    assert ctx.texts, "the command should reply instead of crashing"
    assert db.one("race_state", channel_id=CHANNEL)["current_lap"] == 1


def test_upload_sheet_skips_a_bad_node_and_keeps_the_rest(clean_db):
    db = clean_db
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.message.attachments = [FakeAttachment(
        "nodes.json",
        json.dumps({"0.1": {"ofa": "Hatch 5", "dyp": "10 members", "je": "5"},
                    "0.2": {"ofa": "missing the rest"}}),
    )]

    run(call(RaceTracker.race_group, race_cog(), ctx, "uploadsheet", args="my sheet"))

    row = db.one("race_sheets", guild_id=GUILD, name="my sheet")
    assert row is not None
    assert set(row["data"]) == {"0.1"}
    assert any("skipped" in text.lower() for text in ctx.texts)


# ------------------------------------------------ feature: team-scoped staff


def seed_captain_team(db, channel_id=CHANNEL, captain_id=900, team_id=1,
                      race_channel_id=CHANNEL):
    seed_team(db, team_id, war_channel_id=channel_id, race_channel_id=race_channel_id)
    seed_captain(db, team_id, captain_id)
    database._team_cache.clear()


def test_captain_can_manage_team_war_but_not_guild_settings(clean_db):
    db = clean_db
    seed_captain_team(db)
    seed_alias(db, 200, "sam")
    seed_war(db, missing_list=[{"name": "bob"}])
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)
    cog = war_cog()

    run(call(WarTracker.war_group, cog, ctx, "missing", "add", args="sam"))

    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert [entry["name"] for entry in missing] == ["bob", "sam"]

    run(call(WarTracker.war_group, cog, ctx, "set", "attacks", args="5"))

    # A team channel stores the team's own value; the server default is untouched.
    assert db.rows("war_settings") == []
    assert db.one("teams", id=1)["attacks_required"] == 5
    assert not any("Staff only" in text for text in ctx.texts)


def test_captain_can_record_attacks_and_set_the_team_role(clean_db):
    db = clean_db
    seed_captain_team(db)
    seed_alias(db, 200, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)
    cog = war_cog()

    run(call(WarTracker.war_group, cog, ctx, "attacks", "Sam", args="6"))
    assert db.one("wars", channel_id=CHANNEL)["attack_counts"]["sam"] == 6

    role = FakeRole(777, "Team A")
    ctx.guild.roles.append(role)
    ctx.message.role_mentions = [role]
    run(call(WarTracker.war_group, cog, ctx, "set", "role", args="<@&777>"))
    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 777


def test_plain_member_cannot_run_team_commands(clean_db):
    db = clean_db
    seed_captain_team(db)
    seed_alias(db, 200, "sam")
    seed_war(db, missing_list=[{"name": "sam"}, {"name": "bob"}])
    ctx = make_ctx(channel_id=CHANNEL, author_id=901, administrator=False)

    run(call(WarTracker.war_group, war_cog(), ctx, "missing", "add", args="sam"))

    assert [entry["name"] for entry in db.one("wars", channel_id=CHANNEL)["missing_list"]] == [
        "sam", "bob"]
    assert any("Staff only" in text for text in ctx.texts)


def test_captain_cannot_manage_another_teams_channel(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL)
    seed_team(db, 2, name="B", war_channel_id=12, race_channel_id=13)
    seed_captain(db, 1, 900)
    database._team_cache.clear()
    seed_alias(db, 200, "sam")
    seed_war(db, channel_id=12, missing_list=[])
    ctx = make_ctx(channel_id=12, author_id=900, administrator=False)

    run(call(WarTracker.war_group, war_cog(), ctx, "missing", "add", args="sam"))

    assert db.one("wars", channel_id=12)["missing_list"] == []
    assert any("Staff only" in text for text in ctx.texts)


def test_captain_can_advance_their_race_node(clean_db):
    db = clean_db
    seed_captain_team(db)
    seed_race(db)
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)

    run(call(RaceTracker.race_group, race_cog(), ctx, "newnode",
             args="5 hatch | 2 breed | 1 craft"))

    row = db.one("race_state", channel_id=CHANNEL)
    assert (row["current_lap"], row["current_node"]) == (1, 2)
    assert "hatch" in row["task_description"]


def test_captain_can_select_the_team_sheet_and_list_sheets(clean_db, monkeypatch, tmp_path):
    db = clean_db
    write_nodesheet(tmp_path, NODE_1_2, monkeypatch)
    seed_captain_team(db)
    seed_race(db, current_lap=1, current_node=1, active_race_sheet=None)
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)
    race = race_cog()

    run(call(RaceTracker.race_group, race, ctx, "sheets"))
    assert any("default (bundled)" in text for text in ctx.texts)

    run(call(RaceTracker.race_group, race, ctx, "use", args="default"))
    assert db.one("race_state", channel_id=CHANNEL)["active_race_sheet"] == "default"

    run(call(RaceTracker.race_group, race, ctx, "next"))
    assert db.one("race_state", channel_id=CHANNEL)["current_node"] == 2


def test_captain_cannot_upload_a_race_sheet(clean_db):
    db = clean_db
    seed_captain_team(db)
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)
    ctx.message.attachments = [FakeAttachment(
        "nodes.csv", "lap,node,ofa,dyp,je\n1,1,Hatch,10,5\n")]

    run(call(RaceTracker.race_group, race_cog(), ctx, "uploadsheet", args="cap sheet"))

    assert db.one("race_sheets", name="cap sheet") is None
    assert any("Staff only" in text for text in ctx.texts)


def test_captain_cannot_issue_warnings_or_clear_a_race_node(clean_db):
    db = clean_db
    seed_captain_team(db)
    seed_alias(db, 200, "sam")
    seed_race(db)
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)
    member = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]
    war = war_cog()

    run(call(WarTracker.warning_group, war, ctx, "add", member.mention, reason="late"))
    assert db.rows("warnings") == []

    run(call(RaceTracker.race_group, race_cog(), ctx, "clear"))
    assert db.one("race_state", channel_id=CHANNEL)["task_description"] == "Kill the dragon"


def test_captain_can_approve_ofa_but_a_plain_member_cannot(clean_db):
    db = clean_db
    seed_captain_team(db)
    seed_race(db, pending_ofa_message_id=555, pending_ofa_user_id=200)
    bot = FakeBot()
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    bot.guilds.append(guild)
    guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    guild.members.append(FakeMember(901, "Plain", administrator=False, guild=guild))
    guild.members.append(FakeMember(900, "Cap", administrator=False, guild=guild))
    tracker = race_cog()
    tracker.bot = bot

    def react(user_id):
        return FakeReactionPayload(guild_id=GUILD, channel_id=CHANNEL,
                                   message_id=555, user_id=user_id, emoji="✅")

    run(tracker.on_raw_reaction_add(react(901)))
    assert db.one("race_state", channel_id=CHANNEL)["pending_ofa_message_id"] == 555

    run(tracker.on_raw_reaction_add(react(900)))
    row = db.one("race_state", channel_id=CHANNEL)
    assert row["ofa_holder_id"] == 200
    assert row["pending_ofa_message_id"] is None


# ------------------------------------- feature: team role on a fresh war row


def test_war_start_copies_the_team_role_when_the_channel_has_none(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL, team_role_id=777)
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "defence", "ends", args="20h"))

    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 777


def test_war_start_keeps_the_existing_war_role_over_the_team_role(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL, team_role_id=777)
    seed_war(db, phase="ended", is_active=False, team_role_id=888)
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "defence", "ends", args="20h"))

    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 888


def test_race_next_prefers_the_guild_sheet_over_the_bundled(clean_db, monkeypatch, tmp_path):
    db = clean_db
    write_nodesheet(tmp_path, NODE_1_2, monkeypatch)
    db.seed("race_sheets", {"id": 1, "guild_id": GUILD, "name": "mine", "data": {
        "1.2": {"ofa": "Guild OFA", "dyp": "4 members", "je": "Guild JE"}}})
    seed_race(db, current_lap=1, current_node=1, active_race_sheet="mine")
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "next"))

    row = db.one("race_state", channel_id=CHANNEL)
    assert "Guild OFA" in row["task_description"]
    assert row["dyp_target"] == 4
    assert any("mine" in text for text in ctx.texts)


def test_captain_can_cancel_the_team_war(clean_db):
    db = clean_db
    seed_captain_team(db)
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)

    run(call(WarTracker.war_group, war_cog(), ctx, "cancel"))

    assert db.one("wars", channel_id=CHANNEL)["is_active"] is False


# ------------------------------------------- review fixes: round 2 (task-5)


def test_war_set_role_syncs_the_team_setup_row(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL)
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL)
    role = FakeRole(777, "Team A")
    ctx.guild.roles.append(role)
    ctx.message.role_mentions = [role]

    run(call(WarTracker.war_group, war_cog(), ctx, "set", "role", args="<@&777>"))

    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 777
    team = db.one("teams", id=1)
    assert team["team_role_id"] == 777


def test_war_set_role_clears_both_the_war_and_the_team_row(clean_db):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL, team_role_id=777)
    seed_war(db, team_role_id=777)
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.message.role_mentions = []

    run(call(WarTracker.war_group, war_cog(), ctx, "set", "role", args="none"))

    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] is None
    assert db.one("teams", id=1)["team_role_id"] is None


def test_war_set_role_without_a_team_row_keeps_working(clean_db):
    db = clean_db
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL)
    role = FakeRole(777, "Team A")
    ctx.guild.roles.append(role)
    ctx.message.role_mentions = [role]

    run(call(WarTracker.war_group, war_cog(), ctx, "set", "role", args="<@&777>"))

    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 777
    assert db.rows("teams") == []


def test_default_path_resolves_repo_root_then_cwd(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    cwd = tmp_path / "cwd"
    repo.mkdir()
    cwd.mkdir()
    monkeypatch.delenv("NODESHEET_PATH", raising=False)
    monkeypatch.setattr(node_sheet, "ROOT_DIR", str(repo))
    monkeypatch.chdir(cwd)

    # Neither file exists -> repo-root fallback (the historical behaviour).
    assert default_path() == str(repo / "nodesheet.json")

    # Docker layout (`COPY bot/ .`): only the working directory has the file.
    (cwd / "nodesheet.json").write_text("{}", encoding="utf-8")
    assert default_path() == str(cwd / "nodesheet.json")

    # A repo-root file still wins over the working directory.
    (repo / "nodesheet.json").write_text("{}", encoding="utf-8")
    assert default_path() == str(repo / "nodesheet.json")


def test_alias_rename_accepts_quoted_names_with_spaces(clean_db):
    db = clean_db
    seed_alias(db, 900, "old name")
    seed_war(db, attack_counts={"old name": 4},
             missing_list=[{"name": "old name"}], absent_list=[])
    ctx = make_ctx()

    run(call(Admin.alias_group, admin_cog(), ctx, "rename",
             args='"old name" "new name"'))

    assert db.one("aliases", alias_name="new name", guild_id=GUILD)
    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"new name": 4}
    assert war["missing_list"] == [{"name": "new name"}]


def test_alias_rename_bad_quoting_reports_an_error(clean_db):
    db = clean_db
    seed_alias(db, 900, "old name")
    ctx = make_ctx()

    run(call(Admin.alias_group, admin_cog(), ctx, "rename", args='"old name'))

    assert db.one("aliases", alias_name="old name", guild_id=GUILD)
    assert any("rename" in text.lower() for text in ctx.texts)


def test_war_attacks_logs_the_staff_correction(clean_db):
    db = clean_db
    seed_alias(db, 200, "sam")
    seed_war(db, attack_counts={"sam": 2})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="6"))

    row = db.one("wars", channel_id=CHANNEL)
    assert row["attack_counts"] == {"sam": 6}
    log = db.rows("war_logs")[-1]
    assert (log["player_name"], log["attacks"], log["source"]) == ("sam", 4, "staff")
    assert log["discord_id"] == 200
    assert log["channel_id"] == CHANNEL


def test_war_attacks_negative_correction_logs_a_negative_staff_delta(clean_db):
    db = clean_db
    seed_alias(db, 200, "sam")
    seed_war(db, attack_counts={"sam": 6})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="2"))

    log = db.rows("war_logs")[-1]
    assert (log["attacks"], log["source"]) == (-4, "staff")


def test_war_attacks_without_a_change_writes_no_log(clean_db):
    db = clean_db
    seed_alias(db, 200, "sam")
    seed_war(db, attack_counts={"sam": 6})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "Sam", args="6"))

    assert db.rows("war_logs") == []


def test_attack_button_survives_a_war_log_failure(clean_db, monkeypatch):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={"sam": 5})
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    channel = guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    user = FakeMember(900, "Sam", administrator=False, guild=guild)
    interaction = FakeInteraction(user=user, guild=guild, channel=channel)

    def broken_log(*args, **kwargs):
        raise RuntimeError("war_logs insert failed")

    monkeypatch.setattr("cogs.war.log_attack", broken_log)

    run(war_cog()._handle_attack_press(interaction))

    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"sam": 6}
    assert war["missing_list"] == []
    assert any("6/6" in text for text in interaction.texts)


def test_attacks_done_message_survives_a_war_log_failure(clean_db, monkeypatch):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    def broken_log(*args, **kwargs):
        raise RuntimeError("war_logs insert failed")

    monkeypatch.setattr("cogs.war.log_attack", broken_log)

    run(war_cog().on_message(message))

    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"sam": 6}
    assert war["missing_list"] == []
    assert message.replies
    assert "6/6" in message.replies[-1]


class _BrokenTableDB:
    """Delegates to the fake DB but raises for one table name."""

    def __init__(self, db, broken_table):
        self._db = db
        self._broken = broken_table

    def table(self, name):
        if name == self._broken:
            raise RuntimeError(f"relation {self._broken} does not exist")
        return self._db.table(name)


def test_attacks_done_survives_a_missing_war_logs_table(clean_db, monkeypatch):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)
    monkeypatch.setattr("cogs.war.supabase", _BrokenTableDB(db, "war_logs"))

    run(war_cog().on_message(message))

    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"] == {"sam": 6}
    assert message.replies and "6/6" in message.replies[-1]


def test_war_set_role_survives_a_team_sync_failure(clean_db, monkeypatch):
    db = clean_db
    seed_team(db, 1, war_channel_id=CHANNEL)
    seed_war(db)
    ctx = make_ctx(channel_id=CHANNEL)
    role = FakeRole(777, "Team A")
    ctx.guild.roles.append(role)
    ctx.message.role_mentions = [role]
    monkeypatch.setattr("cogs.war.supabase", _BrokenTableDB(db, "teams"))

    run(call(WarTracker.war_group, war_cog(), ctx, "set", "role", args="<@&777>"))

    assert db.one("wars", channel_id=CHANNEL)["team_role_id"] == 777
    assert any("will ping" in text for text in ctx.texts)


# --------------------------------- help embed: !ids and !roles visibility

def _embed_text(embed):
    return "\n".join(f"{field.name}\n{field.value}" for field in embed.fields)


def test_help_overview_lists_ids_and_roles_for_staff(clean_db):
    ctx = make_ctx()

    run(call(Help.help_command, Help(FakeBot()), ctx))

    embed = ctx.sent[-1][1]
    text = _embed_text(embed)
    assert "!ids" in text, "staff help should advertise the ID lookup command"
    assert "!roles" in text, "staff help should advertise the role lookup command"


def test_help_overview_hides_staff_utilities_from_plain_members(clean_db):
    ctx = make_ctx(administrator=False)

    run(call(Help.help_command, Help(FakeBot()), ctx))

    text = _embed_text(ctx.sent[-1][1])
    assert "!ids" not in text
    assert "!roles" not in text


def test_help_roles_topic_documents_the_roles_command(clean_db):
    ctx = make_ctx()

    run(call(Help.help_command, Help(FakeBot()), ctx, "roles"))

    embed = ctx.sent[-1][1]
    text = _embed_text(embed)
    assert "role" in embed.title.lower()
    assert "!roles" in text
    assert "!ids" in text


def test_roles_lists_role_ids_and_cached_member_counts(clean_db):
    ctx = make_ctx()
    team_role = FakeRole(777, "Team A")
    captain_role = FakeRole(888, "Captain")
    ctx.guild.roles.extend([team_role, captain_role])
    sam = FakeMember(42, "Sam", guild=ctx.guild)
    sam.roles = [team_role]
    ctx.guild.members.append(sam)

    run(call(Admin.roles_command, admin_cog(), ctx))

    embed = ctx.sent[-1][1]
    text = embed.description or ""
    assert "Team A" in text and "777" in text and "1 member" in text
    assert "Captain" in text and "888" in text and "0 member" in text
    assert "@everyone" not in text


def test_roles_filters_members_by_role_name(clean_db):
    ctx = make_ctx()
    team_role = FakeRole(777, "Team A")
    ctx.guild.roles.append(team_role)
    sam = FakeMember(42, "Sam", guild=ctx.guild)
    sam.roles = [team_role]
    other = FakeMember(43, "Other", guild=ctx.guild)
    ctx.guild.members.extend([sam, other])

    run(call(Admin.roles_command, admin_cog(), ctx, query="team a"))

    text = ctx.sent[-1][1].description or ""
    assert "Sam" in text and "42" in text
    assert "Other" not in text


def test_roles_accepts_a_role_mention(clean_db):
    ctx = make_ctx()
    team_role = FakeRole(777, "Team A")
    ctx.guild.roles.append(team_role)
    sam = FakeMember(42, "Sam", guild=ctx.guild)
    sam.roles = [team_role]
    ctx.guild.members.append(sam)
    ctx.message.role_mentions = [team_role]

    run(call(Admin.roles_command, admin_cog(), ctx))

    text = ctx.sent[-1][1].description or ""
    assert "Sam" in text and "42" in text


def test_roles_unknown_role_explains_instead_of_crashing(clean_db):
    ctx = make_ctx()
    ctx.guild.roles.append(FakeRole(777, "Team A"))

    run(call(Admin.roles_command, admin_cog(), ctx, query="ghost"))

    assert any("No role" in text for text in ctx.texts)


def test_roles_is_staff_only(clean_db):
    ctx = make_ctx(administrator=False)
    ctx.guild.roles.append(FakeRole(777, "Team A"))

    run(call(Admin.roles_command, admin_cog(), ctx))

    assert any("Staff only" in text for text in ctx.texts)
    assert not any(embed is not None for _content, embed in ctx.sent)


# ------------------------------- legacy war rows (plain-string list entries)

def test_join_names_accepts_legacy_plain_string_entries():
    assert join_names(["sam", {"name": "bob"}]) == "sam, bob"


def test_get_war_normalises_legacy_plain_string_entries(clean_db):
    db = clean_db
    seed_war(db, missing_list=["sam"], absent_list=["bob"])

    import cogs.war as war_module

    war = run(war_module.get_war(CHANNEL))

    assert war["missing_list"] == [{"name": "sam"}]
    assert war["absent_list"] == [{"name": "bob"}]


def test_war_check_handles_legacy_string_missing_and_absent_entries(clean_db):
    db = clean_db
    seed_war(db, missing_list=["sam", "bob"], absent_list=["cara"])
    ctx = make_ctx(channel_id=CHANNEL)

    run(WarTracker.war_check(war_cog(), ctx))

    embed = ctx.sent[-1][1]
    assert "sam" in (embed.description or "")
    assert "bob" in (embed.description or "")


def test_missing_list_command_handles_legacy_string_entries(clean_db):
    db = clean_db
    seed_war(db, missing_list=["sam"])
    ctx = make_ctx(channel_id=CHANNEL)

    run(WarTracker.war_missing(war_cog(), ctx, "list", None))

    assert any("sam" in text for text in ctx.texts)


def test_12h_reminder_mentions_legacy_string_missing_entries(clean_db):
    db = clean_db
    seed_alias(db, 200, "sam")

    mentions = run(war_cog()._missing_mentions({"guild_id": GUILD, "missing_list": ["sam"]}))

    assert mentions == ["<@200>"]


def test_12h_reminder_keeps_stored_discord_ids(clean_db):
    mentions = run(war_cog()._missing_mentions(
        {"guild_id": GUILD, "missing_list": [{"name": "sam", "id": 200}]}))

    assert mentions == ["<@200>"]


# ----------------------------------------- help embeds stay inside Discord limits

def test_every_help_page_stays_within_discord_embed_limits(clean_db):
    topics = (None, "war", "race", "maze", "team", "alias", "ids", "roles", "warning", "pings")

    for topic in topics:
        ctx = make_ctx()
        run(call(Help.help_command, Help(FakeBot()), ctx, topic))

        embed = ctx.sent[-1][1]
        assert embed is not None, f"topic {topic!r} produced no embed"
        assert len(embed) <= 6000, f"topic {topic!r} exceeds the 6000-char embed limit"
        for field in embed.fields:
            assert len(field.name) <= 256, f"topic {topic!r} has an over-long field name"
            assert len(field.value) <= 1024, f"topic {topic!r} has an over-long field value"


# ------------------------------------- long user text must not break embeds

def test_warning_list_keeps_long_reasons_inside_embed_limits(clean_db):
    db = clean_db
    for i in range(15):
        db.seed("warnings", {"id": i + 1, "guild_id": GUILD, "discord_id": 200,
                             "reason": "x" * 1000, "issued_by": 1})
    ctx = make_ctx()

    run(call(WarTracker.warning_group, war_cog(), ctx, "list"))

    embed = ctx.sent[-1][1]
    assert embed is not None
    assert len(embed) <= 6000
    assert all(len(field.value) <= 1024 for field in embed.fields)


def test_member_warning_list_keeps_long_reasons_inside_embed_limits(clean_db):
    db = clean_db
    for i in range(10):
        db.seed("warnings", {"id": i + 1, "guild_id": GUILD, "discord_id": 200,
                             "reason": "x" * 1000, "issued_by": 1})
    ctx = make_ctx()
    sam = FakeMember(200, "Sam", guild=ctx.guild)
    ctx.guild.members.append(sam)
    ctx.message.mentions = [sam]

    run(call(WarTracker.warning_group, war_cog(), ctx, "list", "sam"))

    embed = ctx.sent[-1][1]
    assert embed is not None
    assert len(embed) <= 6000
    assert all(len(field.value) <= 1024 for field in embed.fields)


def test_race_status_truncates_a_long_node_description(clean_db):
    db = clean_db
    db.seed("race_state", {
        "channel_id": CHANNEL, "guild_id": GUILD, "current_lap": 1, "current_node": 2,
        "task_description": "x" * 5000, "is_event_active": True,
        "ofa_holder_id": None, "pending_ofa_message_id": None, "ofa_done": False,
        "dyp_progress": 0, "dyp_target": 0, "je_progress": "0", "je_target": "0",
        "je_done": False, "target_laps": 10, "active_race_sheet": None,
    })
    ctx = make_ctx(channel_id=CHANNEL)

    run(RaceTracker.show_status(race_cog(), ctx))

    embed = ctx.sent[-1][1]
    assert embed is not None
    assert len(embed) <= 6000
    assert all(len(field.value) <= 1024 for field in embed.fields)


def test_je_unknown_input_tells_the_user_the_usage(clean_db):
    db = clean_db
    seed_alias(db, 1, "tester")
    db.seed("race_state", {
        "channel_id": CHANNEL, "guild_id": GUILD, "current_lap": 1, "current_node": 2,
        "task_description": "OFA: x | DYP: y | JE: z", "is_event_active": True,
        "ofa_holder_id": None, "pending_ofa_message_id": None, "ofa_done": False,
        "dyp_progress": 0, "dyp_target": 0, "je_progress": "0", "je_target": "0",
        "je_done": False, "target_laps": 10, "active_race_sheet": None,
    })
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "je", args="banana"))

    assert any("+" in text or "usage" in text.lower() for text in ctx.texts)


# ------------------------- premium gate covers message/button attack logging

def test_expired_server_does_not_log_attacks_from_a_message(clean_db):
    db = clean_db
    db.reset()
    db.seed("guilds", {"guild_id": GUILD, "premium_status": "expired",
                       "trial_ends_at": "2020-01-01T00:00:00+00:00"})
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="attacks done", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"] == {}
    assert not message.replies


def test_expired_server_does_not_log_attacks_from_the_button(clean_db):
    db = clean_db
    db.reset()
    db.seed("guilds", {"guild_id": GUILD, "premium_status": "expired",
                       "trial_ends_at": "2020-01-01T00:00:00+00:00"})
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    interaction = FakeInteraction(user=ctx.author, guild=ctx.guild, channel=ctx.channel)

    run(war_cog()._handle_attack_press(interaction))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"] == {}
    assert any("premium" in text.lower() or "trial" in text.lower()
               for text in interaction.texts)


def test_maze_ping_accepts_a_space_before_the_percent(clean_db):
    db = clean_db
    db.seed("maze_schedules", {"guild_id": GUILD, "event_end": "2099-01-01T00:00:00+00:00",
                               "ping_enabled_global": True, "ping_mention": "none"})
    bot, _guild, channel = _maze_bot()
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.channel = channel
    ctx.bot = bot

    run(call(MazeTracker.maze_group, MazeTracker(bot), ctx, "ping", "20", arg2=" %"))

    embed = ctx.sent[-1][1]
    assert embed is not None and "20% Discount" in (embed.description or "")


# ----------------------------------------- audit fixes: security and sending

def test_bot_defaults_never_allow_everyone_or_role_mentions():
    import main as botmain

    allowed = botmain.bot.allowed_mentions
    assert allowed is not None
    assert allowed.everyone is False
    assert allowed.roles is False


def test_send_ping_reports_whether_the_announcement_was_delivered(clean_db):
    cog = war_cog()
    ctx = make_ctx(channel_id=CHANNEL)

    assert run(cog._send_ping(ctx.channel, "hello")) is True

    async def boom(**kwargs):
        raise TypeError("channel is gone")

    ctx.channel.send = boom
    assert run(cog._send_ping(ctx.channel, "hello")) is False


# ------------------------------------------- audit fixes: war correctness

def test_finish_war_keeps_the_updater_when_the_database_update_fails(clean_db, monkeypatch):
    import asyncio
    import contextlib

    db = clean_db
    seed_war(db)
    cog = war_cog()
    ctx = make_ctx(channel_id=CHANNEL)
    monkeypatch.setattr("cogs.war.supabase", _BrokenTableDB(db, "wars"))

    async def go():
        task = asyncio.create_task(asyncio.sleep(5))
        cog.status_tasks[CHANNEL] = task
        try:
            await cog.finish_war(CHANNEL, ctx.channel)
            assert cog.status_tasks.get(CHANNEL) is task, "the updater must not be stranded"
            assert not task.cancelled()
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    asyncio.run(go())


def test_rebasing_an_active_war_recomputes_the_reminder_marks(clean_db):
    db = clean_db
    seed_war(db, sent_pings=["hours_12"])
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "defence", "ends", args="24h"))

    assert "hours_12" not in (db.one("wars", channel_id=CHANNEL)["sent_pings"] or [])


def test_attacks_done_lower_count_readds_the_player_to_missing(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[], attack_counts={"sam": 6})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    message = FakeMessage(content="2 attacks done", author=ctx.author,
                          guild=ctx.guild, channel=ctx.channel)

    run(war_cog().on_message(message))

    war = db.one("wars", channel_id=CHANNEL)
    assert war["attack_counts"]["sam"] == 2
    assert [m["name"] for m in war["missing_list"]] == ["sam"]


def test_attack_button_prefers_the_alias_already_tracked(clean_db):
    db = clean_db
    seed_alias(db, 900, "aaa")
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[], attack_counts={"sam": 2})
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, display_name="Sam")
    interaction = FakeInteraction(user=ctx.author, guild=ctx.guild, channel=ctx.channel)

    run(war_cog()._handle_attack_press(interaction))

    counts = db.one("wars", channel_id=CHANNEL)["attack_counts"]
    assert counts == {"sam": 3}


def test_war_check_includes_absent_players_when_absence_is_not_exempt(clean_db):
    db = clean_db
    db.seed("war_settings", {"guild_id": GUILD, "attacks_required": 6, "exempt_absent": False})
    seed_war(db, missing_list=[], absent_list=[{"name": "cara"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL)

    run(WarTracker.war_check(war_cog(), ctx))

    assert "cara" in (ctx.sent[-1][1].description or "")


def test_war_attacks_caps_at_the_requirement(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam"}], attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "sam", args="10"))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"]["sam"] == 6


def test_war_attacks_refuses_an_inactive_war(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    seed_war(db, is_active=False, attack_counts={})
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(WarTracker.war_group, war_cog(), ctx, "attacks", "sam", args="3"))

    assert db.one("wars", channel_id=CHANNEL)["attack_counts"] == {}
    assert any("No active war" in text for text in ctx.texts)


def test_ping_phase_label_treats_the_attack_start_as_attack():
    assert _ping_phase_label(24 * 3600) == "attack"
    assert _ping_phase_label(25 * 3600) == "defence"


def test_resolve_member_prefers_the_named_alias_over_an_unrelated_mention(clean_db):
    ctx = make_ctx()
    sam = FakeMember(42, "sam", guild=ctx.guild)
    bob = FakeMember(43, "bob", guild=ctx.guild)
    ctx.guild.members.extend([sam, bob])
    ctx.message.mentions = [bob]

    found = run(WarTracker._resolve_member(war_cog(), ctx, "sam"))

    assert found is sam


# --------------------------------------------- audit fixes: race and OCR

def test_ocr_fraction_numbers_keep_thousands_separators():
    assert ocr_engine._fraction_number("1,200") == "1,200"
    assert int(ocr_engine.clean_val(ocr_engine._fraction_number("1,200"))) == 1200
    assert int(ocr_engine.clean_val(ocr_engine._fraction_number("1O,5"))) == 10


def test_ocr_clean_val_survives_huge_numbers():
    assert ocr_engine.clean_val("9" * 400) == 0


def test_parse_dyp_target_reads_members_and_grouped_numbers():
    assert parse_dyp_target("Collect 10 members") == 10
    assert parse_dyp_target("Collect 1,000 members") == 1000
    assert parse_dyp_target("Collect 1.5K members") == 1500
    assert parse_dyp_target("Collect 20,000 gold") == 20000
    assert parse_dyp_target("no numbers here") == 0


def test_race_clean_val_and_parse_amount_survive_huge_numbers():
    assert clean_val("9" * 400) == 0
    with pytest.raises(ValueError):
        parse_amount("9" * 400)


def test_je_stays_completed_after_more_progress(clean_db):
    db = clean_db
    seed_alias(db, 1, "tester")
    seed_race(db, je_done=True, je_progress="1000", je_target="1000", task_description="JE done")
    ctx = make_ctx(channel_id=CHANNEL)

    run(call(RaceTracker.race_group, race_cog(), ctx, "je", args="+500k"))

    assert any("already" in text.lower() for text in ctx.texts)
    assert db.one("race_state", channel_id=CHANNEL)["je_progress"] == "1000"


def test_race_status_clips_a_long_ofa_target(clean_db):
    db = clean_db
    seed_race(db, ofa_target="y" * 1500)
    ctx = make_ctx(channel_id=CHANNEL)

    run(RaceTracker.show_status(race_cog(), ctx))

    embed = ctx.sent[-1][1]
    assert all(len(field.value) <= 1024 for field in embed.fields)


def test_node_sheet_rejects_keys_outside_the_lap_node_grid():
    node = {"ofa": "a", "dyp": "b", "je": "c"}
    data, warnings = parse_nodesheet({"1.6": node, "2.1": node})

    assert set(data) == {"2.1"}
    assert warnings


# ---------------------------------------- audit fixes: maze and billing

def test_maze_pings_stop_for_an_expired_server(clean_db):
    db = clean_db
    db.reset()
    db.seed("guilds", {"guild_id": GUILD, "premium_status": "expired",
                       "trial_ends_at": "2020-01-01T00:00:00+00:00"})
    seed = {"guild_id": GUILD, "event_end": "2099-01-01T00:00:00+00:00",
            "ping_enabled_global": True, "ping_mention": "here"}
    db.seed("maze_schedules", seed)
    bot, _guild, channel = _maze_bot()

    run(MazeTracker(bot).ping_discount_at_time(GUILD, channel, "20%", 0))

    assert channel.messages == []


def test_billing_resets_a_stale_renewal_marker_after_renewal(clean_db):
    from datetime import datetime, timezone

    db = clean_db
    row = db.one("guilds", guild_id=GUILD)
    row["premium_ends_at"] = "2099-01-01T00:00:00+00:00"
    row["last_renewal_ping"] = 3
    bot = FakeBot()
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    guild.add_channel(FakeChannel(CHANNEL, guild=guild))
    bot.guilds.append(guild)

    manager = object.__new__(BillingManager)  # skip the 12h task loop
    manager.bot = bot
    run(manager._process_guild(dict(row), datetime.now(timezone.utc)))

    assert db.one("guilds", guild_id=GUILD)["last_renewal_ping"] == 0


def test_billing_keeps_the_marker_when_no_notice_was_delivered(clean_db):
    from datetime import datetime, timedelta, timezone

    db = clean_db
    row = db.one("guilds", guild_id=GUILD)
    row["premium_ends_at"] = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()
    row["last_renewal_ping"] = 0
    bot = FakeBot()
    guild = FakeGuild(GUILD, me=FakeMember(999, "Bot", administrator=False))
    guild.owner = None  # nobody to DM
    bot.guilds.append(guild)

    manager = object.__new__(BillingManager)  # skip the 12h task loop
    manager.bot = bot
    run(manager._process_guild(dict(row), datetime.now(timezone.utc)))

    assert db.one("guilds", guild_id=GUILD)["last_renewal_ping"] == 0


def test_help_subcommand_bypasses_the_expired_trial_gate(clean_db):
    db = clean_db
    db.reset()
    db.seed("guilds", {"guild_id": GUILD, "premium_status": "expired",
                       "trial_ends_at": "2020-01-01T00:00:00+00:00"})
    import main as botmain

    ctx = make_ctx()
    ctx.command = types.SimpleNamespace(name="race")
    ctx.message.content = "!race help"
    assert run(botmain.premium_gate(ctx)) is True

    ctx.message.content = "!race status"
    assert run(botmain.premium_gate(ctx)) is False


def test_maze_restart_does_not_repeat_a_recent_discount(clean_db):
    from cogs.maze import _discount_key

    db = clean_db
    end = datetime(2099, 1, 1, tzinfo=timezone.utc)
    key = _discount_key("20%", end)
    db.seed("maze_schedules", {"guild_id": GUILD, "event_end": end.isoformat(),
                               "ping_enabled_global": True, "ping_mention": "here",
                               "sent_pings": [key]})
    bot, _guild, channel = _maze_bot()

    run(MazeTracker(bot).ping_discount_at_time(GUILD, channel, "20%", 0, end, key))

    assert channel.messages == []


def test_maze_ping_records_the_discount_for_restart_dedupe(clean_db):
    from cogs.maze import _discount_key

    db = clean_db
    end = datetime(2099, 1, 1, tzinfo=timezone.utc)
    key = _discount_key("20%", end)
    db.seed("maze_schedules", {"guild_id": GUILD, "event_end": end.isoformat(),
                               "ping_enabled_global": True, "ping_mention": "none"})
    bot, _guild, channel = _maze_bot()

    run(MazeTracker(bot).ping_discount_at_time(GUILD, channel, "20%", 0, end, key))

    assert channel.messages
    assert key in db.one("maze_schedules", guild_id=GUILD)["sent_pings"]


def test_alias_add_and_remove_accept_quoted_names(clean_db):
    db = clean_db
    ctx = make_ctx()
    member = FakeMember(900, "Sam", guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]

    run(call(Admin.alias_group, admin_cog(), ctx, "add", args=f'{member.mention} "sam smith"'))
    assert db.one("aliases", guild_id=GUILD)["alias_name"] == "sam smith"

    run(call(Admin.alias_group, admin_cog(), ctx, "remove", args='"sam smith"'))
    assert db.one("aliases", guild_id=GUILD) is None


# --------------------------------------- aliases: identity and departed members

def test_race_task_without_alias_tells_the_player_to_set_one(clean_db):
    db = clean_db
    seed_race(db, dyp_target=5, dyp_progress=0, dyp_contributors=[])
    ctx = make_ctx(channel_id=CHANNEL, author_id=7, display_name="Lone", administrator=False)

    run(race_cog().handle_task(ctx, "dyp", None, None))

    assert any("set your alias first" in text.lower() for text in ctx.texts)
    assert db.one("race_state", channel_id=CHANNEL)["dyp_progress"] == 0


def test_race_task_logs_the_alias_instead_of_the_display_name(clean_db):
    db = clean_db
    seed_race(db, dyp_target=5, dyp_progress=0, dyp_contributors=[])
    seed_alias(db, 1, "sam")
    ctx = make_ctx(channel_id=CHANNEL)

    run(race_cog().handle_task(ctx, "dyp", None, None))

    assert db.rows("race_logs")[-1]["player_name"] == "sam"
    assert any("sam" in text for text in ctx.texts)


def test_alias_list_marks_members_who_left_the_server(clean_db):
    db = clean_db
    db.seed("users", {"discord_id": 200})
    db.seed("aliases", {"guild_id": GUILD, "discord_id": 200, "alias_name": "gone"})
    ctx = make_ctx()  # guild.members contains only the author

    run(call(Admin.alias_group, admin_cog(), ctx, "list"))

    description = ctx.sent[-1][1].description or ""
    assert "left" in description.lower()


def test_alias_prune_removes_departed_aliases_and_active_war_lists(clean_db):
    db = clean_db
    seed_alias(db, 1, "here")
    seed_alias(db, 200, "gone")
    seed_war(db, missing_list=[{"name": "here", "id": 1}, {"name": "gone", "id": 200}],
             absent_list=[{"name": "gone", "id": 200}],
             attack_counts={"here": 2, "gone": 4})
    ctx = make_ctx()

    run(call(Admin.alias_group, admin_cog(), ctx, "prune"))

    assert [row["alias_name"] for row in db.rows("aliases")] == ["here"]
    war = db.one("wars", channel_id=CHANNEL)
    assert [entry["name"] for entry in war["missing_list"]] == ["here"]
    assert war["absent_list"] == []
    assert war["attack_counts"] == {"here": 2, "gone": 4}  # history is kept


def test_war_missing_list_marks_a_member_who_left(clean_db):
    db = clean_db
    seed_war(db, missing_list=[{"name": "gone", "id": 200}])
    ctx = make_ctx(channel_id=CHANNEL)

    run(WarTracker.war_missing(war_cog(), ctx, "list", None))

    assert "left" in ctx.texts[-1].lower()


def test_12h_reminder_skips_members_who_left(clean_db):
    db = clean_db
    seed_alias(db, 900, "sam")
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.guild.members.append(FakeMember(900, "Sam", guild=ctx.guild))

    mentions = run(war_cog()._missing_mentions(
        {"guild_id": GUILD, "missing_list": [{"name": "gone", "id": 200},
                                             {"name": "sam", "id": 900}]},
        ctx.guild,
    ))

    assert mentions == ["<@900>"]


# ------------------------------------ per-team rosters and per-team war rules

def test_team_list_shows_settings_and_roster_count(clean_db):
    db = clean_db
    seed_team(db, attacks_required=4, exempt_absent=False)
    seed_team_player(db, 1, 900, "sam")
    ctx = make_ctx()

    run(call(Teams.team_group, Teams(FakeBot()), ctx))

    description = ctx.sent[-1][1].description or ""
    assert "**A**" in description
    assert "4 attacks" in description
    assert "absences count" in description
    assert "👥 1" in description


def test_team_add_requires_the_player_to_have_an_alias(clean_db):
    db = clean_db
    seed_team(db)
    ctx = make_ctx()
    member = FakeMember(900, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]

    run(call(Teams.team_group, Teams(FakeBot()), ctx, "add", args=f"{member.mention} A"))

    assert any("alias" in text.lower() for text in ctx.texts)
    assert db.rows("team_players") == []


def test_team_add_moves_a_player_and_cleans_the_old_team_lists(clean_db):
    db = clean_db
    seed_team(db, 1, name="A", war_channel_id=CHANNEL)
    seed_team(db, 2, name="B", war_channel_id=CHANNEL + 1)
    seed_team_player(db, 1, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam", "id": 900}])
    ctx = make_ctx()
    member = FakeMember(900, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]

    run(call(Teams.team_group, Teams(FakeBot()), ctx, "add", args=f"{member.mention} B"))

    assert db.one("team_players", discord_id=900)["team_id"] == 2
    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []
    assert any("Moved from" in text for text in ctx.texts)


def test_team_players_marks_members_who_left_the_server(clean_db):
    db = clean_db
    seed_team(db)
    seed_team_player(db, 1, 200, "gone")
    ctx = make_ctx()

    run(call(Teams.team_group, Teams(FakeBot()), ctx, "players", args="A"))

    assert "left the server" in (ctx.sent[-1][1].description or "")


def test_team_remove_clears_active_war_lists(clean_db):
    db = clean_db
    seed_team(db)
    seed_team_player(db, 1, 900, "sam")
    seed_war(db, missing_list=[{"name": "sam", "id": 900}])
    ctx = make_ctx()
    member = FakeMember(900, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]

    run(call(Teams.team_group, Teams(FakeBot()), ctx, "remove", args=""))

    assert db.rows("team_players") == []
    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []


def test_team_captain_can_manage_only_their_own_roster(clean_db):
    db = clean_db
    seed_team(db, 1, name="A", war_channel_id=CHANNEL)
    seed_team(db, 2, name="B", war_channel_id=CHANNEL + 1)
    seed_captain(db, 1, 900)
    seed_alias(db, 200, "sam")
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)
    target = FakeMember(200, "Sam", administrator=False, guild=ctx.guild)
    ctx.guild.members.append(target)
    ctx.message.mentions = [target]

    run(call(Teams.team_group, Teams(FakeBot()), ctx, "add", args=f"{target.mention} A"))
    assert db.one("team_players", discord_id=200)["team_id"] == 1

    ctx.sent.clear()
    run(call(Teams.team_group, Teams(FakeBot()), ctx, "add", args=f"{target.mention} B"))
    assert any("Staff only" in text for text in ctx.texts)
    assert db.one("team_players", discord_id=200)["team_id"] == 1


def test_per_team_war_settings_override_the_server_defaults(clean_db):
    from cogs.war import get_settings

    db = clean_db
    db.seed("war_settings", {"guild_id": GUILD, "attacks_required": 6, "exempt_absent": True})
    seed_team(db, attacks_required=4, exempt_absent=False)

    team_settings = run(get_settings(GUILD, CHANNEL))
    default_settings = run(get_settings(GUILD, CHANNEL + 99))

    assert team_settings["attacks_required"] == 4
    assert team_settings["exempt_absent"] is False
    assert team_settings["team"]["name"] == "A"
    assert default_settings["attacks_required"] == 6
    assert default_settings["exempt_absent"] is True
    assert default_settings["team"] is None


def test_war_missing_add_requires_a_rostered_player(clean_db):
    db = clean_db
    seed_team(db)
    seed_team_player(db, 1, 900)
    seed_alias(db, 200, "sam")
    seed_war(db, missing_list=[])
    ctx = make_ctx(channel_id=CHANNEL)

    run(WarTracker.war_missing(war_cog(), ctx, "add", "sam"))
    assert any("roster" in text.lower() for text in ctx.texts)
    assert db.one("wars", channel_id=CHANNEL)["missing_list"] == []

    seed_team_player(db, 1, 200)
    run(WarTracker.war_missing(war_cog(), ctx, "add", "sam"))
    missing = db.one("wars", channel_id=CHANNEL)["missing_list"]
    assert [entry["name"] for entry in missing] == ["sam"]


def test_war_board_marks_a_player_who_left_the_team(clean_db):
    db = clean_db
    ctx = make_ctx(channel_id=CHANNEL)
    ctx.guild.members.append(FakeMember(200, "Sam", guild=ctx.guild))
    start = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    war = {
        "war_start": start,
        "missing_list": [{"name": "sam", "id": 200}],
        "absent_list": [],
        "sent_pings": [],
        "team_roster": {900},
    }

    embed = war_cog().build_embed(war, channel=ctx.channel)

    values = {field.name: field.value for field in embed.fields}
    assert "(left team)" in values["⚠️ Missing (1)"]


def test_team_captain_can_set_the_team_exemption_rule(clean_db):
    db = clean_db
    seed_team(db, 1, name="A", war_channel_id=CHANNEL)
    seed_captain(db, 1, 900)
    ctx = make_ctx(channel_id=CHANNEL, author_id=900, administrator=False)

    run(call(WarTracker.war_group, war_cog(), ctx, "set", "exempt", args="off"))

    assert db.one("teams", id=1)["exempt_absent"] is False
    assert not any("Staff only" in text for text in ctx.texts)


# --------------------------------------------- warnings DM the warned player

def _warning_ctx(db):
    seed_alias(db, 200, "sam")
    ctx = make_ctx()
    member = FakeMember(200, "Sam", guild=ctx.guild)
    ctx.guild.members.append(member)
    ctx.message.mentions = [member]
    return ctx, member


def test_warning_add_dms_the_warned_player(clean_db):
    db = clean_db
    ctx, member = _warning_ctx(db)

    run(call(WarTracker.warning_group, war_cog(), ctx, "add",
             member.mention, reason="missed 4 attacks"))

    assert db.rows("warnings"), "the warning should still be stored"
    assert member.dms, "the warned player should receive a DM"
    _content, embed = member.dms[-1]
    assert embed is not None
    assert "missed 4 attacks" in (embed.description or "")
    assert "Test Guild" in (embed.footer.text or "")


def test_warning_is_recorded_when_the_dm_cannot_be_delivered(clean_db, monkeypatch):
    import discord

    db = clean_db
    ctx, member = _warning_ctx(db)

    async def closed_dms(**kwargs):
        raise discord.Forbidden(types.SimpleNamespace(status=403, reason="Forbidden"),
                                "Cannot send messages to this user")

    monkeypatch.setattr(member, "send", closed_dms)

    run(call(WarTracker.warning_group, war_cog(), ctx, "add",
             member.mention, reason="late again"))

    assert db.rows("warnings")
    assert any("dm" in text.lower() and "couldn't" in text.lower()
               for text in ctx.texts), "staff should be told the DM failed"
