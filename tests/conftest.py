"""Test bootstrap: stub the third-party modules that are not needed offline.

The bot imports ``supabase`` (client), ``dotenv`` and ``PIL`` at module import
time.  None of those are exercised by the tests, so they are replaced with tiny
in-memory stubs before the bot modules are imported.
"""

import os
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bot"))
sys.path.insert(0, str(ROOT / "tests"))

os.environ.setdefault("DISCORD_TOKEN", "test-token")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SECRET_KEY", "test-key")
os.environ.setdefault("DASHBOARD_URL", "https://dashboard.test")

from fakes import FakeDB  # noqa: E402  (test helpers live next to this file)

DB = FakeDB()

_supabase = types.ModuleType("supabase")


class _Client:  # only used as a typing name in database.py
    pass


_supabase.Client = _Client
_supabase.create_client = lambda url, key: DB
sys.modules.setdefault("supabase", _supabase)

_dotenv = types.ModuleType("dotenv")
_dotenv.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", _dotenv)

_pil = types.ModuleType("PIL")


class _Image:
    @staticmethod
    def open(*args, **kwargs):
        raise RuntimeError("Pillow is not installed in the offline test environment")


_pil.Image = _Image
sys.modules.setdefault("PIL", _pil)


def seed_guild(guild_id=100, **overrides):
    row = {
        "guild_id": guild_id,
        "is_blacklisted": False,
        "premium_status": "premium",
        "premium_ends_at": None,
        "trial_ends_at": "2099-01-01T00:00:00+00:00",
        "max_teams": 10,
        "last_renewal_ping": 0,
    }
    row.update(overrides)
    DB.seed("guilds", row)
    return row


@pytest.fixture(autouse=True)
def clean_db():
    DB.reset()
    seed_guild()
    try:
        import database
        database._role_cache.clear()
        database._team_cache.clear()
    except Exception:
        pass
    yield DB
