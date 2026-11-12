"""Smoke-test the maze cog's database calls without Discord or Supabase.

The 12 Nov 2026 deployment failed every maze tick with
`AttributeError: 'function' object has no attribute 'data'`: the queries were written as
`lambda: ... .execute` (which returns the bound method) instead of calling it.  These tests
build the real cog over a fake Supabase client and call every query path, so that class of
mistake fails here instead of in production.

Run from `bot/`:  python3 -m unittest discover -s tests -v
"""

import ast
import asyncio
import os
import pathlib
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone

try:
    import discord  # noqa: F401  (the cog needs it)
except ImportError:  # pragma: no cover - only when discord.py is missing
    raise unittest.SkipTest("discord.py is not installed")

BOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BOT_DIR)


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    """Chainable stand-in for a supabase-py query builder."""

    def __init__(self, rows):
        self._rows = rows
        self.executions = 0

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name == "execute":
            raise AssertionError("query.execute was read as an attribute instead of called()")
        return lambda *args, **kwargs: self

    def execute(self):
        self.executions += 1
        return FakeResult(self._rows)


class FakeSupabase:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.queries = []

    def table(self, name):
        query = FakeQuery(self.rows.get(name, []))
        self.queries.append((name, query))
        return query


# The cog imports `database` once, so install the stub before importing it and reuse the same
# fake client for every test (a fresh one would be invisible to the already-imported module).
FAKE_SUPABASE = FakeSupabase()
_fake_database = types.ModuleType("database")
_fake_database.supabase = FAKE_SUPABASE
_fake_database.check_premium_status = lambda guild_id: True
_fake_database.ensure_user = lambda discord_id: None


async def _is_staff_member(_member):
    return True


_fake_database.is_staff_member = _is_staff_member
sys.modules["database"] = _fake_database

from cogs import maze as maze_cog  # noqa: E402  (needs the stub in place first)


def make_cog():
    return maze_cog.MazeTracker(bot=object())


class QueryExecutionTest(unittest.TestCase):
    """Every database helper must actually run its query."""

    def setUp(self):
        FAKE_SUPABASE.queries.clear()
        self.cog = make_cog()

    def test_event_lookup(self):
        self.assertIsNone(asyncio.run(self.cog._fetch_event()))
        self.assertEqual(FAKE_SUPABASE.queries[0][0], "maze_events")

    def test_calendar_lookup(self):
        self.assertEqual(asyncio.run(self.cog._fetch_events(limit=5)), [])

    def test_edited_ladder_lookup(self):
        self.assertIsNone(asyncio.run(self.cog._fetch_windows()))

    def test_subscription_lookup(self):
        self.assertEqual(asyncio.run(self.cog._fetch_subscriptions()), [])

    def test_manual_ping_queue_drain(self):
        asyncio.run(self.cog._drain_manual_pings())
        self.assertEqual(FAKE_SUPABASE.queries[0][0], "maze_pings")

    def test_queries_were_executed(self):
        asyncio.run(self.cog._fetch_event())
        _, query = FAKE_SUPABASE.queries[0]
        self.assertEqual(query.executions, 1)


class EmbedTest(unittest.TestCase):
    def test_discount_embed_shows_percent_and_end(self):
        cog = make_cog()
        ends_at = datetime.now(timezone.utc) + timedelta(hours=4)
        embed = cog._discount_embed("20%", ends_at)
        self.assertIn("20%", embed.description)
        self.assertIn("Maze Island", embed.title)

    def test_manual_embed_without_event(self):
        cog = make_cog()
        embed = cog._discount_embed("10%", None)
        self.assertIn("right now", embed.description)


class QueryShapeTest(unittest.TestCase):
    """Static guard: a lambda that returns `.execute` instead of calling it is always wrong."""

    def test_no_lambda_returns_an_uncalled_execute(self):
        source = pathlib.Path(BOT_DIR, "cogs", "maze.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        offenders = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.Lambda)
            and isinstance(node.body, ast.Attribute)
            and node.body.attr == "execute"
        ]
        self.assertEqual(
            offenders,
            [],
            "these lambdas return query.execute instead of query.execute() "
            f"and would fail with 'function has no attribute data': lines {offenders}",
        )

    def test_no_query_is_executed_before_the_thread_wrapper(self):
        """`to_thread(query.execute())` runs the blocking query on the event loop."""
        source = pathlib.Path(BOT_DIR, "cogs", "maze.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        offenders = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "attr", getattr(node.func, "id", ""))
            if name != "to_thread" or not node.args:
                continue
            argument = node.args[0]
            if (
                isinstance(argument, ast.Call)
                and isinstance(argument.func, ast.Attribute)
                and argument.func.attr == "execute"
            ):
                offenders.append(node.lineno)
        self.assertEqual(
            offenders,
            [],
            "pass the bound method (`to_thread(query.execute)`) or a lambda, not "
            f"an already-run query: lines {offenders}",
        )


if __name__ == "__main__":
    unittest.main()
