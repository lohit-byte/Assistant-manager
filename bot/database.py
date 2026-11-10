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
        if not res.data:
            # A brand-new guild may not have its row yet; do not cache "no staff
            # roles" for a minute or the first configured staff member is denied.
            return set()
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


_roster_cache = {}


def get_team_by_channel(guild_id: int, channel_id: int):
    """The team that owns this war/race channel, if any."""
    if channel_id is None:
        return None
    try:
        res = supabase.table("teams").select("*").eq("guild_id", guild_id).execute()
    except Exception as e:
        print(f"Team channel lookup failed: {e}")
        return None
    for team in res.data or []:
        owned = {
            str(value) for value in
            (team.get("war_channel_id"), team.get("race_channel_id"))
            if value is not None
        }
        if str(channel_id) in owned:
            return team
    return None


def get_team_by_name(guild_id: int, name: str):
    """Resolve a team by (case-insensitive) exact name, then unique partial match."""
    wanted = (name or "").strip().lower()
    if not wanted:
        return None
    try:
        res = supabase.table("teams").select("*").eq("guild_id", guild_id).execute()
    except Exception as e:
        print(f"Team name lookup failed: {e}")
        return None
    teams = res.data or []
    for team in teams:
        if (team.get("name") or "").strip().lower() == wanted:
            return team
    partial = [team for team in teams if wanted in (team.get("name") or "").strip().lower()]
    return partial[0] if len(partial) == 1 else None


def get_team_players(guild_id: int, team_id) -> set:
    """Discord ids currently on one team's roster."""
    if team_id is None:
        return set()
    try:
        res = supabase.table("team_players").select("discord_id").eq("team_id", team_id).execute()
    except Exception as e:
        print(f"Team roster lookup failed: {e}")
        return set()
    return {
        int(row["discord_id"]) for row in (res.data or [])
        if row.get("discord_id") is not None
    }


def get_team_players_map(guild_id: int) -> dict:
    """Map team id -> set of roster Discord ids (cached for 60s)."""
    now = time.time()
    cached = _roster_cache.get(guild_id)
    if cached and now - cached[0] < 60:
        return cached[1]
    mapping = {}
    try:
        teams = supabase.table("teams").select("id").eq("guild_id", guild_id).execute()
        team_ids = [team["id"] for team in teams.data or [] if team.get("id") is not None]
        if team_ids:
            rows = supabase.table("team_players").select(
                "team_id, discord_id").in_("team_id", team_ids).execute()
            for row in rows.data or []:
                if row.get("discord_id") is None:
                    continue
                mapping.setdefault(row.get("team_id"), set()).add(int(row["discord_id"]))
    except Exception as e:
        print(f"Team roster map lookup failed: {e}")
        return {}
    _roster_cache[guild_id] = (now, mapping)
    return mapping


def clear_team_cache(guild_id: int = None) -> None:
    if guild_id is None:
        _team_cache.clear()
        _roster_cache.clear()
    else:
        _team_cache.pop(guild_id, None)
        _roster_cache.pop(guild_id, None)


def _roster_names(guild_id: int, discord_id: int) -> set:
    try:
        res = supabase.table("aliases").select("alias_name").eq(
            "guild_id", guild_id).eq("discord_id", discord_id).execute()
    except Exception:
        return set()
    return {
        (row.get("alias_name") or "").strip().lower()
        for row in (res.data or []) if row.get("alias_name")
    }


def _team_player_name(entry) -> str:
    if isinstance(entry, dict):
        return (entry.get("name") or "").strip().lower()
    return str(entry or "").strip().lower()


def scrub_war_player(guild_id: int, channel_id, discord_id: int, names=None) -> None:
    """Remove one player from a team war channel's active missing/excused lists."""
    if channel_id is None:
        return
    names = names if names is not None else _roster_names(guild_id, discord_id)
    try:
        res = supabase.table("wars").select(
            "channel_id, missing_list, absent_list").eq(
            "channel_id", channel_id).eq("is_active", True).execute()
    except Exception as e:
        print(f"Team leave war cleanup lookup failed: {e}")
        return
    for war in res.data or []:
        def gone(entry):
            if isinstance(entry, dict) and entry.get("id") is not None:
                try:
                    if int(entry["id"]) == int(discord_id):
                        return True
                except (TypeError, ValueError):
                    pass
            return _team_player_name(entry) in names

        missing = [entry for entry in war.get("missing_list") or [] if not gone(entry)]
        absent = [entry for entry in war.get("absent_list") or [] if not gone(entry)]
        if len(missing) == len(war.get("missing_list") or []) and len(absent) == len(war.get("absent_list") or []):
            continue
        supabase.table("wars").update({
            "missing_list": missing, "absent_list": absent,
        }).eq("channel_id", war["channel_id"]).execute()


def set_team_player(guild_id: int, team_id, discord_id: int) -> list:
    """Put a player on a team, moving them off any other team in this guild.

    Removes the player from the previous team's active war missing/excused
    lists (they are no longer waiting on that team) and returns the previous
    team names. Attack-count history is never rewritten.
    """
    ensure_user(discord_id)
    teams = supabase.table("teams").select(
        "id, name, war_channel_id").eq("guild_id", guild_id).execute()
    by_id = {team["id"]: team for team in teams.data or [] if team.get("id") is not None}
    moved_from = []
    if by_id:
        old = supabase.table("team_players").select("team_id").in_(
            "team_id", list(by_id)).eq("discord_id", discord_id).execute()
        if any(row.get("team_id") == team_id for row in old.data or []):
            return []  # already on this team
        names = _roster_names(guild_id, discord_id)
        for row in old.data or []:
            old_team = by_id.get(row.get("team_id"))
            if old_team is None:
                continue
            supabase.table("team_players").delete().eq(
                "team_id", row.get("team_id")).eq("discord_id", discord_id).execute()
            scrub_war_player(guild_id, old_team.get("war_channel_id"), discord_id, names)
            moved_from.append(old_team.get("name") or "?")
        if old.data:
            # Remove a duplicate row when the player is already on the target team.
            supabase.table("team_players").delete().eq(
                "team_id", team_id).eq("discord_id", discord_id).execute()
    supabase.table("team_players").insert({
        "team_id": team_id, "discord_id": discord_id,
    }).execute()
    clear_team_cache(guild_id)
    return moved_from


def remove_team_player(guild_id: int, team_id, discord_id: int) -> bool:
    """Remove a player from one team and clean that team's active war lists."""
    team = supabase.table("teams").select("war_channel_id").eq(
        "id", team_id).limit(1).execute()
    names = _roster_names(guild_id, discord_id)
    res = supabase.table("team_players").delete().eq(
        "team_id", team_id).eq("discord_id", discord_id).execute()
    if res.data:
        team_row = (team.data or [{}])[0]
        scrub_war_player(guild_id, team_row.get("war_channel_id"), discord_id, names)
        clear_team_cache(guild_id)
        return True
    return False


def get_player_team(guild_id: int, discord_id: int):
    """The team a player is rostered on in this guild, if any."""
    mapping = get_team_players_map(guild_id)
    for team_id, player_ids in mapping.items():
        if int(discord_id) in player_ids:
            try:
                res = supabase.table("teams").select("*").eq(
                    "guild_id", guild_id).eq("id", team_id).limit(1).execute()
            except Exception as e:
                print(f"Player team lookup failed: {e}")
                return None
            return res.data[0] if res.data else None
    return None


def get_player_alias(guild_id: int, discord_id: int):
    """First alias for a player (aliases are the identity used by war/race)."""
    try:
        res = supabase.table("aliases").select("alias_name").eq(
            "guild_id", guild_id).eq("discord_id", discord_id).order(
            "alias_name").limit(1).execute()
    except Exception as e:
        print(f"Player alias lookup failed: {e}")
        return None
    return res.data[0].get("alias_name") if res.data else None


def get_team_roster(guild_id: int, team: dict) -> list:
    """Roster rows for one team: {discord_id, aliases: [...]} sorted by alias."""
    ids = get_team_players(guild_id, team.get("id"))
    if not ids:
        return []
    try:
        res = supabase.table("aliases").select("alias_name, discord_id").eq(
            "guild_id", guild_id).in_("discord_id", sorted(ids)).execute()
    except Exception as e:
        print(f"Team roster alias lookup failed: {e}")
        res = None
    aliases = {}
    for row in (res.data or []) if res else []:
        if row.get("discord_id") is None:
            continue
        aliases.setdefault(int(row["discord_id"]), []).append(
            (row.get("alias_name") or "").strip())
    rows = [
        {"discord_id": discord_id,
         "aliases": sorted(name for name in aliases.get(discord_id, []) if name)}
        for discord_id in ids
    ]
    rows.sort(key=lambda row: (row["aliases"][0] if row["aliases"] else "￿", row["discord_id"]))
    return rows


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


def _entry_alias_name(entry) -> str:
    if isinstance(entry, dict):
        return (entry.get("name") or "").strip().lower()
    return str(entry or "").strip().lower()


def prune_departed_aliases(guild_id: int, present_ids) -> list:
    """Delete aliases whose Discord user left the guild.

    Also removes those players from the guild's active war missing/absent lists
    so reminders and boards stop waiting on someone who is gone. Attack counts
    are history and are left untouched. Returns the removed alias names.
    """
    present = {int(member_id) for member_id in present_ids}
    res = supabase.table("aliases").select("alias_name, discord_id").eq("guild_id", guild_id).execute()
    gone = [
        row for row in (res.data or [])
        if row.get("discord_id") is None or int(row["discord_id"]) not in present
    ]
    if not gone:
        return []
    gone_ids = {int(row["discord_id"]) for row in gone if row.get("discord_id") is not None}
    gone_names = {(row.get("alias_name") or "").strip().lower() for row in gone if row.get("alias_name")}
    if gone_ids:
        supabase.table("aliases").delete().eq("guild_id", guild_id).in_(
            "discord_id", sorted(gone_ids)).execute()
    try:
        wars = supabase.table("wars").select(
            "channel_id, missing_list, absent_list").eq("guild_id", guild_id).eq(
            "is_active", True).execute()
    except Exception as e:
        print(f"Departed-alias war cleanup lookup failed: {e}")
        wars = None
    def _departed(entry):
        if isinstance(entry, dict) and entry.get("id") is not None:
            try:
                return int(entry["id"]) in gone_ids
            except (TypeError, ValueError):
                pass
        return _entry_alias_name(entry) in gone_names
    for war in (wars.data or []) if wars else []:
        missing = [entry for entry in war.get("missing_list") or [] if not _departed(entry)]
        absent = [entry for entry in war.get("absent_list") or [] if not _departed(entry)]
        if len(missing) == len(war.get("missing_list") or []) and len(absent) == len(war.get("absent_list") or []):
            continue
        supabase.table("wars").update({
            "missing_list": missing, "absent_list": absent,
        }).eq("channel_id", war["channel_id"]).execute()
    return sorted(gone_names)


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

