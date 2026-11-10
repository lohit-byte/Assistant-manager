import asyncio
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
        # Do not cache a failed lookup as "no staff roles" for the next minute.
        print(f"Role lookup failed: {e}")
        return set()
    _role_cache[guild_id] = (now, ids)
    return ids

async def is_staff_member(m) -> bool:
    p = m.guild_permissions
    if p.administrator or p.manage_guild:
        return True
    # Role lookup hits Supabase (cached for 60s): keep it off the event loop.
    role_ids = await asyncio.to_thread(get_staff_role_ids, m.guild.id)
    return any(r.id in role_ids for r in m.roles)


_team_cache = {}


def get_team_captain_map(guild_id: int) -> dict:
    """Map each team channel of a guild to the Discord ids of its captains.

    A team has a war channel and/or a race channel; both resolve to the same
    captain set. Failures (table missing before the migration, network) log and
    return an empty map so the caller treats everyone as "not a captain" and the
    global staff path keeps working.
    """
    now = time.time()
    cached = _team_cache.get(guild_id)
    if cached and now - cached[0] < 60:
        return cached[1]
    mapping = {}
    try:
        res = supabase.table("teams").select(
            "id, war_channel_id, race_channel_id").eq("guild_id", guild_id).execute()
        teams = res.data or []
        team_ids = [team["id"] for team in teams if team.get("id") is not None]
        captains_by_team = {}
        if team_ids:
            cres = supabase.table("team_captains").select(
                "team_id, discord_id").in_("team_id", team_ids).execute()
            for row in cres.data or []:
                if row.get("discord_id") is None:
                    continue
                captains_by_team.setdefault(row.get("team_id"), set()).add(int(row["discord_id"]))
        for team in teams:
            captains = captains_by_team.get(team.get("id"))
            if not captains:
                continue
            for key in ("war_channel_id", "race_channel_id"):
                channel_id = team.get(key)
                if channel_id is not None:
                    mapping.setdefault(int(channel_id), set()).update(captains)
    except Exception as e:
        # Do not cache a failed lookup as "no captains" for the next minute.
        print(f"Team captain lookup failed: {e}")
        return {}
    _team_cache[guild_id] = (now, mapping)
    return mapping


async def is_team_staff(m, channel_id: int) -> bool:
    """Staff for one team channel: global staff, or a captain of that team."""
    if await is_staff_member(m):
        return True
    if m.guild is None or channel_id is None:
        return False
    captains = await asyncio.to_thread(get_team_captain_map, m.guild.id)
    try:
        ids = captains.get(int(channel_id), set())
    except (TypeError, ValueError):
        return False
    return m.id in ids


def get_team_role_id(guild_id: int, channel_id: int):
    """The role configured on the team that owns this war/race channel, if any."""
    try:
        res = supabase.table("teams").select(
            "war_channel_id, race_channel_id, team_role_id"
        ).eq("guild_id", guild_id).execute()
        for team in res.data or []:
            owns_channel = (
                str(team.get("war_channel_id")) == str(channel_id)
                or str(team.get("race_channel_id")) == str(channel_id)
            )
            if owns_channel:
                role_id = team.get("team_role_id")
                return int(role_id) if role_id else None
    except Exception as e:
        # A missing teams table (pre-migration) must not block starting a war.
        print(f"Team role lookup failed: {e}")
    return None


def _rename_entries(items, old: str, new: str):
    """Rewrite ``{"name": ...}`` entries (or legacy plain strings) in a JSONB list."""
    changed = False
    out = []
    for item in items or []:
        if isinstance(item, dict) and (item.get("name") or "").strip().lower() == old:
            item = {**item, "name": new}
            changed = True
        elif isinstance(item, str) and item.strip().lower() == old:
            item = new
            changed = True
        out.append(item)
    return out, changed


def _migrate_war_names(guild_id: int, old: str, new: str) -> None:
    """Move a renamed alias's live war data to the new name for every war row."""
    try:
        res = supabase.table("wars").select(
            "channel_id, attack_counts, missing_list, absent_list"
        ).eq("guild_id", guild_id).execute()
    except Exception as e:
        print(f"Alias war-data migration lookup failed: {e}")
        return
    for war in res.data or []:
        counts = war.get("attack_counts") or {}
        new_counts, counts_changed = {}, False
        for key, value in counts.items():
            if (key or "").lower() == old:
                new_counts[new] = value
                counts_changed = True
            else:
                new_counts[key] = value
        missing, missing_changed = _rename_entries(war.get("missing_list"), old, new)
        absent, absent_changed = _rename_entries(war.get("absent_list"), old, new)
        if not (counts_changed or missing_changed or absent_changed):
            continue
        try:
            supabase.table("wars").update({
                "attack_counts": new_counts,
                "missing_list": missing,
                "absent_list": absent,
            }).eq("channel_id", war["channel_id"]).execute()
        except Exception as e:
            print(f"Alias war-data migration failed for channel {war.get('channel_id')}: {e}")


def rename_alias(guild_id: int, old_name: str, new_name: str):
    """Rename an alias in place, keeping its current war counts/lists attached.

    Returns a user-facing error message, or ``None`` on success.
    """
    old = (old_name or "").strip().lower()
    new = (new_name or "").strip().lower()
    if not old or not new:
        return "❌ Usage: `!alias rename <old> <new>`"
    existing = supabase.table("aliases").select("alias_name").eq(
        "guild_id", guild_id).eq("alias_name", old).limit(1).execute()
    if not existing.data:
        return f"❌ No alias named `{old}` in this server."
    duplicate = supabase.table("aliases").select("alias_name").eq(
        "guild_id", guild_id).eq("alias_name", new).limit(1).execute()
    if duplicate.data:
        return f"❌ `{new}` already exists in this server."
    supabase.table("aliases").update({"alias_name": new}).eq(
        "guild_id", guild_id).eq("alias_name", old).execute()
    _migrate_war_names(guild_id, old, new)
    return None

