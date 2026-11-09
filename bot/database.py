import os
import time
from datetime import datetime, timezone
from supabase import create_client, Client
from dotenv import load_dotenv

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(root_dir, '.env')
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment variables.")

supabase: Client = create_client(SUPABASE_URL.strip().rstrip('/'), SUPABASE_KEY.strip())


def _parse_timestamp(value) -> datetime:
    """Parse a Supabase timestamptz into an aware UTC datetime (None if invalid)."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def ensure_user(discord_id: int) -> None:
    """Create the users row a player needs before aliases/warnings can reference them.

    ``aliases.discord_id`` and ``warnings.discord_id`` are foreign keys into
    ``users``; without this row those inserts fail with a constraint error.
    """
    supabase.table("users").upsert(
        {"discord_id": discord_id},
        on_conflict="discord_id",
        ignore_duplicates=True,
    ).execute()


def get_or_create_guild(guild_id: int) -> dict:
    res = supabase.table("guilds").select("*").eq("guild_id", guild_id).execute()
    if res.data:
        return res.data[0]
    
    supabase.table("guilds").upsert(
        {"guild_id": guild_id, "premium_status": "trial"},
        on_conflict="guild_id",
        ignore_duplicates=True,
    ).execute()
    
    return supabase.table("guilds").select("*").eq("guild_id", guild_id).execute().data[0]

def check_premium_status(guild_id: int) -> bool:
    guild = get_or_create_guild(guild_id)
    if guild.get("is_blacklisted"):
        return False

    status = guild.get("premium_status")
    now = datetime.now(timezone.utc)

    if status == "premium":
        ends = guild.get("premium_ends_at")
        if not ends:
            return True  # Manual premium with no expiry
        end_date = _parse_timestamp(ends)
        return bool(end_date and end_date > now)

    if status == "trial":
        end_date = _parse_timestamp(guild.get("trial_ends_at"))
        return bool(end_date and end_date > now)

    return False

_role_cache = {}

def get_staff_role_ids(guild_id: int) -> set:
    now = time.time()
    cached = _role_cache.get(guild_id)
    if cached and now - cached[0] < 60:
        return cached[1]
    ids = set()
    try:
        res = supabase.table("guilds").select("staff_role_id,leader_role_id,colead_role_id").eq("guild_id", guild_id).limit(1).execute()
        if res.data:
            for v in res.data[0].values():
                if v:
                    ids.add(int(v))
    except Exception as e:
        print(f"Role lookup failed: {e}")
    _role_cache[guild_id] = (now, ids)
    return ids

def is_staff_member(m) -> bool:
    p = m.guild_permissions
    if p.administrator or p.manage_guild:
        return True
    role_ids = get_staff_role_ids(m.guild.id)
    return any(r.id in role_ids for r in m.roles)

