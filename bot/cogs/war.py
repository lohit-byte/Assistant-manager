import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
import time
import asyncio
from collections import defaultdict
from database import (
    supabase,
    check_premium_status,
    is_staff_member,
    is_team_staff,
    ensure_user,
    get_staff_role_ids,
    get_team_by_channel,
    get_team_players,
    get_team_role_id,
    get_team_roster,
)

DEFENCE = ("defence", "defense")
PHASE = timedelta(hours=24)
WAR = timedelta(hours=48)
# A report counts only when it is the whole plain message. Anything longer is chat: the
# bot asks for a clean message instead of logging an attack nobody can verify.
DONE_PLAIN_RE = re.compile(
    r"(?:(\d+)\s+)?attacks?\s+done(?:\s*(\d+)(?:\s*/\s*(\d+))?)?", re.I)
DONE_ANY_RE = re.compile(r"\b(?:(\d+)\s+)?attacks?\s+done\b", re.I)
# Trailing punctuation and a reaction emoji still feel like a plain message to a player.
DONE_DECORATION = " \t\r\n.!?,;:~✅✔👍💪🔥🎯🚀❤\ufe0f"


def parse_done_report(content):
    """``(is_plain, count)`` for a message that might report attacks.

    Plain means the report is the whole message: ``attacks done``, ``attacks done
    5``, ``attacks done 4/6`` or ``4 attacks done`` (with trailing punctuation or a
    reaction emoji allowed). ``count`` is None for a bare ``attacks done`` so the
    caller can use the required number, and a hand-typed 0 is treated as the bare
    form too.
    """
    text = (content or "").strip().strip(DONE_DECORATION).strip()
    match = DONE_PLAIN_RE.fullmatch(text)
    if not match:
        return False, None
    count = int(match.group(1) or match.group(2) or 0)
    return True, (count if count > 0 else None)

# Channel reminders for the fixed 48h war timeline, expressed as seconds before
# the war ends (offset, key, human label). "attack_started" is sent by the phase
# switch itself; "war_ended" is sent by finish_war to the staff roles.
PING_SCHEDULE = [
    ("defence_30m", 24 * 3600 + 30 * 60, "Defence ends 30m warning"),
    ("attack_started", 24 * 3600, "Attack started"),
    ("hours_12", 12 * 3600, "12h warning"),
    ("hours_6", 6 * 3600, "6h warning"),
    ("hours_3", 3 * 3600, "3h warning"),
    ("minutes_30", 30 * 60, "30m warning"),
]
PING_OFFSETS = {key: offset for key, offset, _label in PING_SCHEDULE}
WAR_END_KEY = "war_ended"


def _sent_keys(war):
    raw = war.get("sent_pings") if war else None
    return set(raw) if isinstance(raw, list) else set()


def _ping_due(war_end, offset):
    return war_end - timedelta(seconds=offset)


def _due_pings(war_end, sent, now, grace=3600):
    """Reminders that are due and not too stale to send (after downtime)."""
    due = []
    for key, offset, label in PING_SCHEDULE:
        if key in sent:
            continue
        due_at = _ping_due(war_end, offset)
        if due_at <= now and (now - due_at).total_seconds() <= grace:
            due.append((key, label, due_at))
    return due


def _expired_pings(war_end, sent, now, grace=3600):
    """Reminder keys too stale to send; record them so the sent counter finishes."""
    expired = []
    for key, offset, _label in PING_SCHEDULE:
        if key in sent:
            continue
        due_at = _ping_due(war_end, offset)
        if due_at <= now and (now - due_at).total_seconds() > grace:
            expired.append(key)
    return expired


def _initial_sent(war_end, now, grace=3600):
    """Mark reminders already missed by more than the grace window so tracking
    a war midway through doesn't spam old reminders."""
    return [
        key for key, offset, _label in PING_SCHEDULE
        if (now - _ping_due(war_end, offset)).total_seconds() > grace
    ]


def _ping_phase_label(offset):
    # The attack-started ping sits exactly at 24h, which is already attack time.
    return "defence" if offset > 24 * 3600 else "attack"

def parse_time(time_str):
    regex = re.compile(r'((?P<hours>\d+?)h)?((?P<minutes>\d+?)m)?')
    parts = regex.fullmatch(time_str.lower().replace(" ", ""))
    if not parts: return None
    time_params = {name: int(param) for name, param in parts.groupdict().items() if param}
    if not time_params: return None
    td = timedelta(**time_params)
    return td if td > timedelta(0) else None

def to_utc(s: str) -> datetime:
    if not s: return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

def phase_at(start: datetime, now: datetime) -> str:
    """Fixed war timeline: defence for the first 24h, attack for the last 24h."""
    if not start: return "unknown"
    if now >= start + WAR: return "ended"
    return "attack" if now >= start + PHASE else "defence"


def phase_bounds(start: datetime, phase: str):
    """(start, end) of the phase that is running at ``phase``."""
    if phase == "defence": return start, start + PHASE
    return start + PHASE, start + WAR

def _entry_name(entry):
    """Name of a missing/absent list entry (dict ``{"name": ...}`` or legacy str)."""
    if isinstance(entry, dict):
        return (entry.get("name") or "").strip().lower()
    return str(entry or "").strip().lower()


def _entry_label(entry):
    """Display name of a missing/absent list entry (dict or legacy plain string)."""
    if isinstance(entry, dict):
        return (entry.get("name") or "").strip()
    return str(entry or "").strip()


def _normalise_entries(entries):
    """Upgrade legacy plain-string list entries to ``{"name": ...}`` dicts."""
    return [entry if isinstance(entry, dict) else {"name": _entry_name(entry)}
            for entry in entries or []]


def join_names(items, limit=1000):
    text = ", ".join(_entry_label(i) for i in items)
    return text if len(text) <= limit else text[:limit - 3] + "..."


def _short(text, limit):
    """Clip user-provided text to an embed-field-safe length."""
    text = str(text or "").strip() or "No reason"
    return text if len(text) <= limit else text[:limit - 1] + "…"


MENTION_RE = re.compile(r"<@!?(\d+)>")


def split_targets(raw):
    """Split one staff argument into the players it names.

    ``!war missing add @a @b @c`` arrives as a single argument. Treating the
    whole string as one alias is what produced "No alias <@1> <@2>" even though
    every alias existed. Alias names themselves may contain spaces, so only
    split on boundaries we can be sure of: each @mention, and
    comma/semicolon/newline-separated names.
    """
    text = (raw or "").strip()
    if not text:
        return []
    mentions = [f"<@{mid}>" for mid in MENTION_RE.findall(text)]
    rest = MENTION_RE.sub(" ", text)
    names = [part.strip() for part in re.split(r"[,;\n]+", rest) if part.strip()]
    if not mentions:
        targets = names if len(names) > 1 else [text]
    else:
        targets = mentions + names
    return list(dict.fromkeys(targets))


def _players_text(names):
    return f"{len(names)} {'player' if len(names) == 1 else 'players'}"


def _name_list(names):
    return ", ".join(f"`{name}`" for name in names)


def _reply_lines(lines, limit=1900):
    """One reply for several players, inside Discord's 2000-char message cap."""
    return "\n".join(line for line in lines if line)[:limit]

def progress_bar(current, total, length=20):
    if total == 0: return "░" * length
    fraction = max(0.0, min(1.0, current / total)) 
    filled = int(length * fraction)
    return "█" * filled + "░" * (length - filled)

def fmt_td(td):
    total_seconds = int(td.total_seconds())
    if total_seconds < 0: total_seconds = 0
    hours, remainder = divmod(total_seconds, 3600)
    minutes, _ = divmod(remainder, 60)
    return f"{hours}h {minutes}m"

async def get_war(channel_id):
    res = await asyncio.to_thread(supabase.table("wars").select("*").eq("channel_id", channel_id).limit(1).execute)
    war = res.data[0] if res.data else None
    if war:
        # Rows written by older versions store plain alias strings in these
        # lists; every command below assumes the {"name": ...} shape.
        war["missing_list"] = _normalise_entries(war.get("missing_list"))
        war["absent_list"] = _normalise_entries(war.get("absent_list"))
    return war

async def get_settings(guild_id, channel_id=None):
    """War rules for a channel: the team's settings win over the server defaults."""
    res = await asyncio.to_thread(supabase.table("war_settings").select("*").eq("guild_id", guild_id).limit(1).execute)
    settings = {"attacks_required": 6, "exempt_absent": True, "team": None}
    if res.data:
        row = res.data[0]
        if row.get("attacks_required") is not None:
            settings["attacks_required"] = int(row["attacks_required"])
        if row.get("exempt_absent") is not None:
            settings["exempt_absent"] = bool(row["exempt_absent"])
    if channel_id is not None:
        try:
            team = await asyncio.to_thread(get_team_by_channel, guild_id, channel_id)
        except Exception:
            team = None
        if team:
            settings["team"] = team
            if team.get("attacks_required") is not None:
                settings["attacks_required"] = max(1, int(team["attacks_required"]))
            if team.get("exempt_absent") is not None:
                settings["exempt_absent"] = bool(team["exempt_absent"])
    return settings

async def check_team_limit(guild_id):
    res = await asyncio.to_thread(supabase.table("guilds").select("max_teams").eq("guild_id", guild_id).execute)
    max_teams = (res.data[0].get("max_teams") if res.data else None) or 1
    active = await asyncio.to_thread(supabase.table("wars").select("channel_id").eq("guild_id", guild_id).eq("is_active", True).execute)
    return len(active.data) < max_teams


def apply_attack(war, alias, delta, required):
    """Apply one attack report to a war row.

    Pure: returns ``(attack_counts, missing_list)``. The total is capped at
    ``required`` and floored at 0, and the alias is dropped from the missing
    list once it reaches the requirement. Missing entries are never re-added
    here (that is the staff undo path); adding twice therefore removes once.
    """
    name = (alias or "").strip().lower()
    counts = dict(war.get("attack_counts") or {})
    missing = [dict(m) if isinstance(m, dict) else m for m in (war.get("missing_list") or [])]
    if not name:
        return counts, missing
    try:
        cap = max(0, int(required or 0))
    except (TypeError, ValueError):
        cap = 0
    current = int(counts.get(name) or 0)
    new_total = max(0, current + int(delta))
    if cap:
        new_total = min(new_total, cap)
    counts[name] = new_total
    if cap and new_total >= cap:
        missing = [entry for entry in missing if _entry_name(entry) != name]
    return counts, missing


def log_attack(guild_id, channel_id, war_start, discord_id, alias, delta, source="self"):
    """Insert one signed attack report into ``war_logs`` (never raises)."""
    try:
        supabase.table("war_logs").insert({
            "guild_id": guild_id,
            "channel_id": channel_id,
            "war_start": war_start,
            "discord_id": discord_id,
            "player_name": (alias or "").strip().lower(),
            "attacks": int(delta),
            "source": source,
        }).execute()
    except Exception as e:
        print(f"Failed to log war attack: {e}")


async def _log_attack_safely(*args, **kwargs):
    """Write a war-log row; a logging failure must never break the attack path."""
    try:
        await asyncio.to_thread(log_attack, *args, **kwargs)
    except Exception as e:
        print(f"Failed to log war attack: {e}")


class AttackView(discord.ui.View):
    """The persistent "I attacked" button.

    ``timeout=None`` plus the fixed ``custom_id`` let Discord re-attach presses
    to a button on a board/reminder that was posted before a bot restart, as
    long as the view is registered again on startup (see cog_load).
    """

    def __init__(self, cog=None):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="✅ I attacked", style=discord.ButtonStyle.success,
                       custom_id="war:i_attacked")
    async def i_attacked(self, interaction, button):
        if self.cog is not None:
            await self.cog._handle_attack_press(interaction)


class WarTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.status_tasks = {}
        self.ping_tasks = {}
        self.done_replies = {}  
        self.locks = defaultdict(asyncio.Lock)
        self.board_updated = {}
        # discord.py >= 2.6 needs a running event loop to build a ui.View, so
        # the persistent view is created lazily from the async command paths
        # (cog __init__ runs on the event loop in production, but tests build
        # the cog synchronously).
        self._attack_view = None

    @property
    def attack_view(self):
        if self._attack_view is None:
            self._attack_view = AttackView(self)
        return self._attack_view

    def register_persistent_views(self):
        """Register the fixed-custom_id views so messages survive a restart."""
        self.bot.add_view(self.attack_view)

    async def cog_load(self):
        self.register_persistent_views()
        self.bot.loop.create_task(self.restore_events())

    def cog_unload(self):
        for t in [*self.status_tasks.values(), *self.ping_tasks.values()]:
            t.cancel()

    async def restore_events(self):
        await self.bot.wait_until_ready()
        try:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("is_active", True).execute)
            now = datetime.now(timezone.utc)
            for war in res.data:
                start = to_utc(war.get("war_start"))
                channel = self.bot.get_channel(war.get("channel_id"))
                if not start or not channel:
                    continue

                current = phase_at(start, now)
                if current == "ended":
                    await self.finish_war(war["channel_id"], channel)
                    continue

                # Do not advance the stored phase here: status_updater detects the
                # defence -> attack switch, records it and announces it, so the
                # announcement is not lost when the bot was offline at the switch.

                self.status_tasks[war["channel_id"]] = asyncio.create_task(
                    self.status_updater(war["channel_id"], channel)
                )
        except Exception as e:
            print(f"Error restoring wars: {e}")

    @commands.command(name="war")
    @commands.guild_only()
    async def war_group(self, ctx, action: str = None, subaction: str = None, *, args: str = None):
        action = (action or "").lower()
        # Aliases are stored lower-case anyway; lower-casing subcommands keeps
        # "!war set ROLE @Role" working like every other subcommand.
        subaction = subaction.lower() if subaction else subaction
        if not action: return await ctx.send("Usage: `!war help`")
        if action == "help": return await self.show_help(ctx)
        if action == "status": return await self.show_status(ctx)
        if action == "missing": return await self.war_missing(ctx, subaction, args)
        if action in ("absent", "absence"): return await self.war_absent(ctx, subaction, args)
        if action == "report": return await self.war_report(ctx)
        if action in ("cancel", "reset"): return await self.cancel_war(ctx)
        if action in ("board", "live"): return await self.war_board(ctx, subaction)
        if action in ("warning", "warn"): return await self.war_warning(ctx, subaction, args)
        if action == "attacks":
            # ``subaction`` swallows the first word (the player name); re-join it
            # with the rest so both "!war attacks Sam 6" and
            # "!war attacks Sam | 6" reach the parser intact.
            parts = [p for p in (subaction, args) if p]
            return await self.war_attacks(ctx, " ".join(parts))
        if action == "check": return await self.war_check(ctx)
        if action == "set":
            if subaction in ("role", "teamrole", "team-role"):
                if not await is_team_staff(ctx.author, ctx.channel.id):
                    return await ctx.send("❌ Staff only.")
                return await self.set_team_role(ctx, args)
            team = await asyncio.to_thread(get_team_by_channel, ctx.guild.id, ctx.channel.id)
            usage = "Usage: `!war set attacks <number>`, `!war set exempt on|off` or `!war set role @Role`"
            if subaction == "attacks":
                if not args or not args.strip().isdigit() or int(args.strip()) < 1:
                    return await ctx.send(usage)
                value = int(args.strip())
                if team:
                    if not await is_team_staff(ctx.author, ctx.channel.id):
                        return await ctx.send("❌ Team staff only.")
                    await asyncio.to_thread(
                        supabase.table("teams").update({"attacks_required": value})
                        .eq("id", team["id"]).execute)
                    return await ctx.send(
                        f"✅ Required attacks for **{team.get('name')}** updated to **{value}**.")
                if not await is_staff_member(ctx.author):
                    return await ctx.send("❌ Staff only.")
                await asyncio.to_thread(
                    supabase.table("war_settings").upsert(
                        {"guild_id": ctx.guild.id, "attacks_required": value},
                        on_conflict="guild_id").execute)
                return await ctx.send(
                    f"✅ Server default required attacks updated to **{value}**.")
            if subaction in ("exempt", "absence", "absent"):
                raw = (args or "").strip().lower()
                if raw not in ("on", "off", "true", "false", "yes", "no"):
                    return await ctx.send(usage)
                enabled = raw in ("on", "true", "yes")
                if team:
                    if not await is_team_staff(ctx.author, ctx.channel.id):
                        return await ctx.send("❌ Team staff only.")
                    await asyncio.to_thread(
                        supabase.table("teams").update({"exempt_absent": enabled})
                        .eq("id", team["id"]).execute)
                    state = "exempt" if enabled else "counted as missing"
                    return await ctx.send(
                        f"✅ Absent players for **{team.get('name')}** are now **{state}**.")
                if not await is_staff_member(ctx.author):
                    return await ctx.send("❌ Staff only.")
                await asyncio.to_thread(
                    supabase.table("war_settings").upsert(
                        {"guild_id": ctx.guild.id, "exempt_absent": enabled},
                        on_conflict="guild_id").execute)
                state = "exempt" if enabled else "counted as missing"
                return await ctx.send(
                    f"✅ Server default: absent players are now **{state}**.")
            if not await is_staff_member(ctx.author):
                return await ctx.send("❌ Staff only.")
            return await ctx.send(usage)
            
        if action in ("defence", "defense", "attack"):
            if not await is_team_staff(ctx.author, ctx.channel.id):
                return await ctx.send("❌ Staff only.")
            if subaction != "ends" or not args: return await ctx.send(f"Usage: `!war {action} ends <time>`")
            return await self.start_timer(ctx, action, args)

        await ctx.send("❌ Unknown war action. Use `!war help`.")

    async def _seed_missing(self, guild_id, channel_id):
        """Start everyone on the team roster as missing: reporting is compulsory.

        The bot cannot see in-game attacks, so each rostered player with an alias
        starts on the missing list and clears themselves by sending
        ``attacks done``. Returns ``(entries, skipped)`` where ``skipped`` counts
        rostered players who have no alias yet (they cannot report, so staff add
        them by hand).
        """
        team = await asyncio.to_thread(get_team_by_channel, guild_id, channel_id)
        if not team:
            return [], 0, None
        roster = await asyncio.to_thread(get_team_roster, guild_id, team)
        entries, seen, skipped = [], set(), 0
        for row in roster or []:
            discord_id = row.get("discord_id")
            if discord_id is None or int(discord_id) in seen:
                continue
            seen.add(int(discord_id))
            aliases = row.get("aliases") or []
            if not aliases:
                skipped += 1
                continue
            entries.append({"name": aliases[0].lower(), "id": discord_id})
        entries.sort(key=lambda entry: entry["name"])
        return entries, skipped, team

    @staticmethod
    def _seed_missing_note(seeded, skipped, team):
        """What the war-start embed says about the auto-filled missing list."""
        if seeded:
            note = (f"{len(seeded)} roster player(s) start missing — each clears "
                    "by sending `attacks done`.")
            if skipped:
                note += f" {skipped} rostered player(s) skipped (no alias yet)."
            return note
        if skipped:
            return (f"{skipped} rostered player(s) have no alias yet, so nothing was "
                    "auto-added. Add aliases with `!alias add @user <alias>`.")
        if team:
            return (f"**{team.get('name')}** has no players on its roster yet — add them "
                    f"with `!team add @user {team.get('name')}`, then add names with "
                    "`!war missing add`.")
        return ("Not auto-filled: link this channel to a team in **Server setup** and "
                "add players with `!team add @user <team>`, or add names by hand with "
                "`!war missing add`.")

    async def start_timer(self, ctx, phase, time_str):
        td = parse_time(time_str)
        if not td: return await ctx.send("❌ Invalid time. Use `20h` or `1h30m`.")
        if td > PHASE: return await ctx.send("❌ Time left in a phase cannot exceed 24 hours.")

        existing_war = await get_war(ctx.channel.id)
        if not existing_war or not existing_war.get("is_active"):
            if not await check_team_limit(ctx.guild.id):
                return await ctx.send("❌ **Team limit reached!** Your server's plan only allows a certain number of active teams. Upgrade on the dashboard to add more.")

        # The war timeline is fixed: defence 24h -> attack 24h. The command argument
        # is the time left in the phase the staff member names, so the war start is
        # back-dated accordingly (works even if tracking begins mid-war).
        now = datetime.now(timezone.utc)
        if phase in DEFENCE:
            war_start = now + td - PHASE
        else:
            war_start = now + td - WAR

        current_phase = phase_at(war_start, now)
        war_end = war_start + WAR

        try:
            war_data = {
                "guild_id": ctx.guild.id,
                "channel_id": ctx.channel.id,
                "war_start": war_start.isoformat(),
                "phase": current_phase,
                "is_active": True,
            }
            fresh_war = not existing_war or not existing_war.get("is_active")
            seeded, skipped, team = [], 0, None
            if fresh_war:
                seeded, skipped, team = await self._seed_missing(ctx.guild.id, ctx.channel.id)
            if fresh_war:
                war_data["missing_list"] = seeded
                war_data["absent_list"] = []
                war_data["attack_counts"] = {}
                war_data["status_message_id"] = None
                # A team's channel keeps its role across wars: the staff member
                # configured it once for this channel, not for one war. An
                # existing wars.team_role_id still wins; a fresh channel falls
                # back to the team settings (configured from the dashboard).
                team_role_id = existing_war.get("team_role_id") if existing_war else None
                if not team_role_id:
                    team_role_id = await asyncio.to_thread(
                        get_team_role_id, ctx.guild.id, ctx.channel.id)
                war_data["team_role_id"] = team_role_id
                # Starting mid-war: don't fire reminders whose window already
                # passed by more than the grace period.
                initial = _initial_sent(war_end, now)
                if current_phase == "attack" and "attack_started" not in initial:
                    initial.append("attack_started")
                war_data["sent_pings"] = initial
            else:
                # The war start (and therefore every reminder time) is being
                # re-based, so the old sent_pings no longer apply. Recompute from
                # the new timeline instead of muting reminders that belong to it.
                initial = _initial_sent(war_end, now)
                if current_phase == "attack" and "attack_started" not in initial:
                    initial.append("attack_started")
                war_data["sent_pings"] = initial
                war_data["status_message_id"] = existing_war.get("status_message_id")
                war_data["team_role_id"] = existing_war.get("team_role_id")

            await asyncio.to_thread(supabase.table("wars").upsert(war_data, on_conflict="channel_id").execute)

            if ctx.channel.id in self.status_tasks: self.status_tasks[ctx.channel.id].cancel()
            self.board_updated.pop(ctx.channel.id, None)
            self.status_tasks[ctx.channel.id] = asyncio.create_task(
                self.status_updater(ctx.channel.id, ctx.channel)
            )

            phase_end = war_start + PHASE if current_phase == "defence" else war_end
            embed = discord.Embed(title="✅ War tracking started", color=discord.Color.blue())
            embed.add_field(name="War clock", value=f"{fmt_td(war_end - now)} left (48h → 0h)", inline=True)
            embed.add_field(name=current_phase.title(), value=f"{fmt_td(phase_end - now)} left", inline=True)
            embed.add_field(name="Phase ends", value=f"<t:{int(phase_end.timestamp())}:R>", inline=True)
            embed.add_field(name="War ends", value=f"<t:{int(war_end.timestamp())}:R>", inline=True)
            if fresh_war:
                embed.add_field(name="Missing list",
                                value=self._seed_missing_note(seeded, skipped, team),
                                inline=False)
            embed.set_footer(text="Defence = 48h → 24h left · Attack = 24h → 0h left. Live board updates every minute.")
            await ctx.send(embed=embed)
            war = await get_war(ctx.channel.id)
            if war:
                await self.upsert_board(ctx.channel.id, ctx.channel, war)
                self.board_updated[ctx.channel.id] = time.monotonic()
        except Exception as e:
            await ctx.send(f"❌ Error: {e}")

    async def war_board(self, ctx, subaction):
        """Create/refresh the live board, or stop it with `!war board stop`."""
        if not await is_team_staff(ctx.author, ctx.channel.id):
            return await ctx.send("❌ Staff only.")
        sub = (subaction or "").lower()
        war = await get_war(ctx.channel.id)
        if sub in ("stop", "off", "remove", "delete"):
            if war:
                await asyncio.to_thread(
                    supabase.table("wars").update({"status_message_id": -1})
                    .eq("channel_id", ctx.channel.id).execute
                )
                message_id = war.get("status_message_id")
                if message_id:
                    try:
                        message = await ctx.channel.fetch_message(int(message_id))
                        await message.edit(embed=discord.Embed(
                            title="🛑 Live war board stopped",
                            description="Use `!war board` to start a new live board.",
                            color=discord.Color.light_grey(),
                        ))
                    except Exception:
                        pass
            self.board_updated.pop(ctx.channel.id, None)
            return await ctx.send("🛑 Live war board stopped.")
        if not war or not war.get("is_active"):
            return await ctx.send("ℹ️ No active war here. Start one with `!war defence ends <time>`.")
        # Force a fresh board (the old one keeps its last state).
        await asyncio.to_thread(
            supabase.table("wars").update({"status_message_id": None})
            .eq("channel_id", ctx.channel.id).execute
        )
        war["status_message_id"] = None
        await self.upsert_board(ctx.channel.id, ctx.channel, war)
        self.board_updated[ctx.channel.id] = time.monotonic()
        await ctx.send("📌 Live war board started — it refreshes automatically every minute.")

    def _can_mention_here(self, channel):
        me = getattr(getattr(channel, "guild", None), "me", None)
        return bool(me and channel.permissions_for(me).mention_everyone)

    def _team_role(self, channel, war):
        role_id = war.get("team_role_id") if war else None
        guild = getattr(channel, "guild", None)
        if not role_id or guild is None:
            return None
        try:
            return guild.get_role(int(role_id))
        except (AttributeError, TypeError, ValueError):
            return None

    def _announcement_mentions(self, channel, war=None, allow_users=False, channel_ping=True):
        """Pings belong to announcements only.

        A configured team role is used first, so separate team channels ping
        their own role; otherwise @here is used when the bot may mention
        everyone. ``allow_users`` lets a caller put player mentions in the
        content (the 12h reminder) without also prefixing them here — that
        would notify each player twice. Command replies and board edits never
        ping.
        """
        parts = []
        role = self._team_role(channel, war)
        used_here = False
        if role is not None:
            parts.append(role.mention)
        elif channel_ping and self._can_mention_here(channel):
            parts.append("@here")
            used_here = True
        if not parts and not allow_users:
            return None, discord.AllowedMentions.none()
        allowed = discord.AllowedMentions(
            roles=role is not None, users=allow_users, everyone=used_here,
        )
        return (" ".join(parts) if parts else None), allowed

    async def _send_ping(self, channel, content, embed=None, war=None, allow_users=False, channel_ping=True, view=None):
        prefix, allowed = self._announcement_mentions(
            channel, war, allow_users=allow_users, channel_ping=channel_ping)
        if prefix:
            content = f"{prefix} {content}" if content else prefix
        try:
            await channel.send(content=content, embed=embed, allowed_mentions=allowed, view=view)
            return True
        except (discord.HTTPException, AttributeError, TypeError) as e:
            print(f"War announcement failed in {getattr(channel, 'id', '?')}: {e}")
            return False

    async def set_team_role(self, ctx, value):
        """Set the role pinged by war announcements in this channel."""
        value = (value or "").strip()
        role_id = None
        if value.lower() not in ("none", "off", "clear"):
            if ctx.message.role_mentions:
                role_id = ctx.message.role_mentions[0].id
            elif value.isdigit():
                role_id = int(value)
            else:
                return await ctx.send("Usage: `!war set role @Role`, `!war set role <role_id>` or `!war set role none`.")
            if ctx.guild.get_role(role_id) is None:
                return await ctx.send("❌ That role doesn't exist in this server.")
        war = await get_war(ctx.channel.id)
        if not war:
            return await ctx.send("ℹ️ No war in this channel yet. Start tracking first with `!war defence ends <time>`.")
        await asyncio.to_thread(
            supabase.table("wars").update({"team_role_id": role_id})
            .eq("channel_id", ctx.channel.id).execute
        )
        # teams.team_role_id is the Setup value and the fresh-war fallback, so
        # this action must write both rows or the two drift apart (and one
        # action could silently clear/restore the ping role). No team row for
        # this channel -> nothing to sync, keep the old behaviour.
        try:
            await asyncio.to_thread(
                supabase.table("teams").update({"team_role_id": role_id})
                .eq("guild_id", ctx.guild.id)
                .eq("war_channel_id", ctx.channel.id).execute
            )
        except Exception as e:
            print(f"Team role sync failed for channel {ctx.channel.id}: {e}")
        if role_id:
            role = ctx.guild.get_role(role_id)
            # Deliberately name the role instead of mentioning it: a live
            # mention here would ping the whole team from a command reply.
            return await ctx.send(f"✅ War announcements in this channel will ping **{role.name}**.")
        await ctx.send("✅ Team role cleared — announcements fall back to `@here` (or no mention if the bot lacks permission).")

    async def status_updater(self, channel_id, channel):
        """Watches one war: phase switches, scheduled reminders and the live board."""
        while True:
            try:
                war = await get_war(channel_id)
                if not war or not war.get("is_active"):
                    return
                await self._attach_roster(war, getattr(channel, "guild", None) and channel.guild.id, channel_id)

                start = to_utc(war.get("war_start"))
                if not start:
                    return

                now = datetime.now(timezone.utc)
                current = phase_at(start, now)
                if current == "ended":
                    if await self.finish_war(channel_id, channel):
                        return
                    await asyncio.sleep(60)
                    continue

                war_end = start + WAR
                sent = _sent_keys(war)
                changed = False

                stored = (war.get("phase") or "").lower()
                if current == "attack" and stored in DEFENCE:
                    await asyncio.to_thread(
                        supabase.table("wars").update({"phase": "attack"})
                        .eq("channel_id", channel_id).execute
                    )
                    if await self.announce_attack(channel, start, war):
                        if "attack_started" not in sent:
                            sent.add("attack_started")
                            changed = True

                for key, label, _due_at in _due_pings(war_end, sent, now):
                    if await self.send_reminder(channel, war, start, key, label):
                        sent.add(key)
                        changed = True

                # A reminder missed by more than the grace window is never sent;
                # still mark it so the board's "pings sent" counter can complete.
                for key in _expired_pings(war_end, sent, now):
                    sent.add(key)
                    changed = True

                if changed:
                    await asyncio.to_thread(
                        supabase.table("wars").update({"sent_pings": sorted(sent)})
                        .eq("channel_id", channel_id).execute
                    )
                    war["sent_pings"] = sorted(sent)

                # The embed uses Discord relative timestamps so countdowns tick
                # every second client-side; refresh it about once a minute to stay
                # well below Discord's edit rate limit.
                last = self.board_updated.get(channel_id, 0.0)
                board_disabled = war.get("status_message_id") == -1
                if not board_disabled and (changed or time.monotonic() - last >= 55):
                    await self.upsert_board(channel_id, channel, war)
                    self.board_updated[channel_id] = time.monotonic()

                await asyncio.sleep(20)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"War updater error in {channel_id}: {e}")
                await asyncio.sleep(60)

    async def announce_attack(self, channel, start, war):
        return await self._send_ping(
            channel,
            "⚔️ **Attack phase started!** Use `attacks done` or the **✅ I attacked** button after attacking.",
            self.build_embed(war, channel=channel, title_prefix="⚔️ **Attack phase started!**"),
            war=war,
            view=self.attack_view,
        )

    async def send_reminder(self, channel, war, start, key, label):
        war_end = start + WAR
        missing = war.get("missing_list") or []
        war_ts = int(war_end.timestamp())
        if key == "hours_12":
            # The 12h reminder points at the players who still owe attacks
            # instead of pinging everyone.
            mentions = await self._missing_mentions(
                war, getattr(channel, "guild", None), war.get("team_roster") or None)
            content = "⏱️ **12 hours left!** "
            if mentions:
                content += "Missing attacks: " + ", ".join(mentions) + " — use `attacks done` or the **✅ I attacked** button after you attack."
            else:
                content += "Use `attacks done` or the **✅ I attacked** button after you attack."
            embed = discord.Embed(
                title="⏱️ 12 hours left in the war",
                description=(
                    f"**War ends:** <t:{war_ts}:R>\n"
                    f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}"
                ),
                color=discord.Color.orange(),
            )
            return await self._send_ping(
                channel, content, embed, war=war,
                allow_users=bool(mentions), channel_ping=False,
                view=self.attack_view,
            )

        embed = self.build_embed(war, channel=channel)
        embed.title = f"⏰ {label}"
        embed.description = (
            f"**War ends:** <t:{war_ts}:R>\n"
            f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}\n"
            "Use `attacks done` or the **✅ I attacked** button after attacking."
        )
        return await self._send_ping(channel, f"⏰ **{label}**", embed, war=war,
                                     view=self.attack_view)

    async def _missing_mentions(self, war, guild=None, roster=None):
        def _present(discord_id):
            try:
                value = int(discord_id)
            except (TypeError, ValueError):
                return True
            if guild is not None and guild.get_member(value) is None:
                return False
            return not roster or value in roster

        missing = war.get("missing_list") or []
        ids = [str(m["id"]) for m in missing
               if isinstance(m, dict) and m.get("id") and _present(m["id"])]
        names = [_entry_name(m) for m in missing
                 if not (isinstance(m, dict) and m.get("id"))]
        if names and war.get("guild_id"):
            try:
                res = await asyncio.to_thread(
                    supabase.table("aliases").select("alias_name, discord_id")
                    .eq("guild_id", war["guild_id"]).execute
                )
                wanted = {n.lower() for n in names if n}
                for row in res.data:
                    if (row.get("alias_name") or "").lower() in wanted and _present(row.get("discord_id")):
                        ids.append(str(row["discord_id"]))
            except Exception as e:
                print(f"Missing alias lookup failed: {e}")
        seen, mentions = set(), []
        for discord_id in ids:
            if discord_id not in seen and _present(discord_id):
                seen.add(discord_id)
                mentions.append(f"<@{discord_id}>")
        return mentions[:50]

    async def _attach_roster(self, war, guild_id, channel_id):
        """Attach the channel's team and roster for membership-aware displays."""
        if not war:
            return war
        try:
            team = await asyncio.to_thread(get_team_by_channel, guild_id, channel_id)
            roster = (await asyncio.to_thread(
                get_team_players, guild_id, team["id"])) if team else set()
        except Exception as e:
            print(f"Team roster attach failed for channel {channel_id}: {e}")
            team, roster = None, set()
        war["team"] = team
        war["team_roster"] = roster
        return war

    def _display_entries(self, items, guild, roster=None):
        """Entry names, marking members who left the server or their team."""
        labels = []
        for entry in items:
            label = _entry_label(entry)
            entry_id = entry.get("id") if isinstance(entry, dict) else None
            if entry_id is not None:
                try:
                    entry_id = int(entry_id)
                except (TypeError, ValueError):
                    entry_id = None
            if entry_id is not None:
                if guild is not None and guild.get_member(entry_id) is None:
                    label = f"{label} (left)"
                elif roster and entry_id not in roster:
                    label = f"{label} (left team)"
            labels.append(label)
        text = ", ".join(labels)
        return text[:1000] if len(text) > 1000 else text

    def build_embed(self, war, channel=None, title_prefix=None):
        start = to_utc(war.get("war_start")) if war else None
        now = datetime.now(timezone.utc)
        if not start:
            return discord.Embed(title="No Active War", color=discord.Color.light_grey())

        current = phase_at(start, now)
        war_end = start + WAR
        missing = war.get("missing_list") or []
        absent = war.get("absent_list") or []
        sent = _sent_keys(war)
        total = len(PING_SCHEDULE) + 1  # + the war-end staff ping
        sent_count = sum(1 for key, _o, _l in PING_SCHEDULE if key in sent)
        team = f" — {channel.name}" if getattr(channel, "name", None) else ""

        guild = getattr(channel, "guild", None)
        roster = war.get("team_roster") or None
        if current == "ended":
            return discord.Embed(
                title=f"🏁 WAR ENDED{team}",
                color=discord.Color.red(),
                description=(
                    f"**Missing attacks ({len(missing)})**: {self._display_entries(missing, guild, roster) or 'None'}\n"
                    f"**Pings sent:** {sent_count + (1 if WAR_END_KEY in sent else 0)}/{total}"
                ),
            )

        phase_start, phase_end = phase_bounds(start, current)
        bar = progress_bar((now - phase_start).total_seconds(), 86400)
        if current == "defence":
            title = f"🛡️ DEFENCE PHASE{team}"
            color = discord.Color.blue()
            lines = [
                bar,
                f"Time left in defence: **{fmt_td(phase_end - now)}**",
                f"Defence ends: <t:{int(phase_end.timestamp())}:R>",
            ]
        else:
            title = f"⚔️ ATTACK PHASE{team}"
            color = discord.Color.red()
            lines = [
                bar,
                f"Defence phase ended: {fmt_td(now - phase_start)} ago",
                f"Time left in attack: **{fmt_td(war_end - now)}**",
                f"Attack ends: <t:{int(war_end.timestamp())}:R>",
            ]
        lines.append(f"War ends: <t:{int(war_end.timestamp())}:R>")
        lines.append(f"Last updated: <t:{int(now.timestamp())}:t>")
        if title_prefix:
            lines.insert(0, title_prefix)

        embed = discord.Embed(title=title, color=color, description="\n".join(lines))
        embed.add_field(name=f"⚠️ Missing ({len(missing)})",
                        value=self._display_entries(missing, guild, roster) or "None", inline=False)
        embed.add_field(
            name=f"🏖️ Excused (absence channel) — {len(absent)}",
            value=self._display_entries(absent, guild, roster) or "None",
            inline=False,
        )
        team_role = self._team_role(channel, war)
        if team_role is not None:
            embed.add_field(name="🔔 Team role", value=team_role.mention, inline=True)

        pending = [
            (key, label, _ping_due(war_end, PING_OFFSETS[key]))
            for key, _offset, label in PING_SCHEDULE if key not in sent
        ]
        remaining = sum(1 for _k, _l, at in pending if at >= now) + (0 if WAR_END_KEY in sent else 1)
        ping_lines = [f"**{remaining} ping(s) remaining**", f"Pings sent: {sent_count}/{total}"]
        for key, label, at in pending:
            if at < now:
                continue  # overdue; retried by the updater, not shown as pending
            ping_lines.append(f"▪ {label} ({_ping_phase_label(PING_OFFSETS[key])}) — <t:{int(at.timestamp())}:R>")
        if WAR_END_KEY not in sent:
            ping_lines.append(f"▪ War end (staff ping) — <t:{int(war_end.timestamp())}:R>")
        embed.add_field(name="🔔 Pings", value="\n".join(ping_lines), inline=False)
        embed.set_footer(text="Updates automatically every minute · countdowns tick every second")
        return embed

    async def upsert_board(self, channel_id, channel, war):
        """Create the live board once, then edit that same message in place."""
        embed = self.build_embed(war, channel=channel)
        message_id = war.get("status_message_id")
        if message_id:
            try:
                message = await channel.fetch_message(int(message_id))
                await message.edit(embed=embed, view=self.attack_view)
                return
            except (discord.NotFound, discord.Forbidden, discord.HTTPException,
                    AttributeError, TypeError):
                pass  # message deleted or bot lacks access -> post a fresh one

        try:
            message = await channel.send(embed=embed, view=self.attack_view)
        except (discord.HTTPException, AttributeError, TypeError) as e:
            print(f"War board could not be posted in {channel_id}: {e}")
            return
        await asyncio.to_thread(
            supabase.table("wars").update({"status_message_id": message.id})
            .eq("channel_id", channel_id).execute
        )

    async def finish_war(self, channel_id, channel):
        try:
            war = await get_war(channel_id)
            war = await self._attach_roster(
                war, getattr(getattr(channel, "guild", None), "id", None), channel_id)
        except Exception as e:
            # A transient read failure must not strand the war with no updater.
            print(f"Could not read war {channel_id} to finish it: {e}")
            return False
        if not war:
            # Nothing left to finish; this is not a transient failure.
            task = self.status_tasks.pop(channel_id, None)
            if task and task is not asyncio.current_task():
                task.cancel()
            self.board_updated.pop(channel_id, None)
            return True
        missing = war.get("missing_list") or []
        sent = _sent_keys(war)
        sent.add(WAR_END_KEY)
        try:
            res = await asyncio.to_thread(
                supabase.table("wars").update({
                    "is_active": False, "phase": "ended", "sent_pings": sorted(sent),
                }).eq("channel_id", channel_id).execute
            )
            if not res.data:
                # The row changed under us (e.g. a new war started): stop this
                # updater instead of retrying forever.
                self.status_tasks.pop(channel_id, None)
                self.board_updated.pop(channel_id, None)
                return True
        except Exception as e:
            print(f"Could not finish war in {channel_id}: {e}")
            return False

        # Only drop the updater once the row is actually closed; a transient DB
        # error above must leave it running so the war is not stranded active.
        task = self.status_tasks.pop(channel_id, None)
        if task and task is not asyncio.current_task():
            task.cancel()
        self.board_updated.pop(channel_id, None)
        war.update({"is_active": False, "phase": "ended", "sent_pings": sorted(sent)})
        try:
            message_id = war.get("status_message_id")
            if message_id:
                try:
                    message = await channel.fetch_message(int(message_id))
                    await message.edit(embed=self.build_embed(war, channel=channel))
                except (discord.NotFound, discord.Forbidden, discord.HTTPException,
                        AttributeError, TypeError):
                    pass

            embed = discord.Embed(
                title="🏁 The War Has Ended!",
                description=(
                    f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}\n"
                    "Staff: start the next war with `!war defence ends <time>`."
                ),
                color=discord.Color.red(),
            )
            await self._send_staff_ping(channel, embed, war)
        except Exception as e:
            print(f"War end notices failed in {channel_id}: {e}")
        return True

    async def _send_staff_ping(self, channel, embed, war=None):
        """Ping the configured staff roles to start the next war."""
        try:
            role_ids = await asyncio.to_thread(get_staff_role_ids, channel.guild.id)
        except Exception:
            role_ids = set()
        content = " ".join(f"<@&{role_id}>" for role_id in sorted(role_ids))
        if content:
            content += " The war has ended — start the next one with `!war defence ends <time>`."
            try:
                await channel.send(content=content, embed=embed,
                                   allowed_mentions=discord.AllowedMentions(roles=True))
                return
            except (discord.HTTPException, AttributeError, TypeError):
                pass
        # No staff role configured: still an announcement, so fall back to the
        # channel's team role (or @here when permitted) like other announcements.
        await self._send_ping(
            channel,
            "🏁 **The war has ended!** Staff: start the next war with `!war defence ends <time>`.",
            embed,
            war=war,
            channel_ping=True,
        )

    async def show_status(self, ctx):
        war = await get_war(ctx.channel.id)
        war = await self._attach_roster(war, ctx.guild.id, ctx.channel.id)
        await ctx.send(embed=self.build_embed(war, channel=ctx.channel))

    async def cancel_war(self, ctx):
        if not await is_team_staff(ctx.author, ctx.channel.id):
            return await ctx.send("❌ Staff only.")
        war = await get_war(ctx.channel.id)
        if not war or not war.get("is_active"): return await ctx.send("ℹ️ No active war here.")
        await self.finish_war(ctx.channel.id, ctx.channel)

    async def war_report(self, ctx):
        war = await get_war(ctx.channel.id)
        if not war: return await ctx.send("ℹ️ No war data found.")
        war = await self._attach_roster(war, ctx.guild.id, ctx.channel.id)
        missing, absent = war.get("missing_list") or [], war.get("absent_list") or []
        embed = discord.Embed(title="🏁 Final War Report", color=discord.Color.red())
        embed.add_field(name=f"❌ Missed Attacks ({len(missing)})", value=join_names(missing) or "Everyone completed attacks!", inline=False)
        if absent: embed.add_field(name=f"🏖️ Excused ({len(absent)})", value=join_names(absent), inline=False)
        await ctx.send(embed=embed)

    async def _lookup_alias(self, guild_id, name=None, discord_id=None):
        """Look a player up by alias name or Discord id (aliases are the identity)."""
        try:
            query = supabase.table("aliases").select("alias_name, discord_id").eq("guild_id", guild_id)
            if discord_id is not None:
                query = query.eq("discord_id", discord_id)
            else:
                query = query.eq("alias_name", (name or "").strip().lower())
            # One Discord user may have several aliases; order keeps the pick
            # deterministic so a mention can never resolve to a different row
            # from one command to the next.
            res = await asyncio.to_thread(query.order("alias_name").limit(1).execute)
            return res.data[0] if res.data else None
        except Exception as e:
            print(f"Alias lookup failed: {e}")
            return None

    async def _pick_alias(self, guild_id, user_id, missing, counts=None):
        """The alias used to log this user's attacks (same rule on text + button).

        A user may hold more than one alias; prefer the one this war's missing
        list (or its attack counts) already tracks so the log lands on one
        identity instead of splitting the total across aliases.
        """
        res = await asyncio.to_thread(
            supabase.table("aliases").select("alias_name, discord_id")
            .eq("guild_id", guild_id).execute
        )
        mine = [
            row for row in res.data
            if str(row.get("discord_id")) == str(user_id)
        ]
        if not mine:
            return None
        missing_names = {_entry_name(entry) for entry in missing or []}
        tracked_names = {
            str(name).lower() for name, total in (counts or {}).items() if total
        }
        mine.sort(key=lambda row: (row.get("alias_name") or "").lower())
        for wanted in (missing_names, tracked_names):
            match = next(
                (row.get("alias_name") for row in mine
                 if (row.get("alias_name") or "").lower() in wanted),
                None,
            )
            if match:
                return match
        return mine[0].get("alias_name")

    async def _reply_ephemeral(self, interaction, content):
        try:
            await interaction.response.send_message(content, ephemeral=True)
        except Exception as e:
            print(f"Could not answer attack button: {e}")

    async def _handle_attack_press(self, interaction):
        """One tap on "✅ I attacked": record exactly one attack for the presser."""
        try:
            guild = getattr(interaction, "guild", None)
            user = getattr(interaction, "user", None)
            channel_id = getattr(interaction, "channel_id", None)
            if channel_id is None:
                channel_id = getattr(getattr(interaction, "channel", None), "id", None)
            if guild is None or user is None or channel_id is None or getattr(user, "bot", False):
                return
            if not await asyncio.to_thread(check_premium_status, guild.id):
                return await self._reply_ephemeral(
                    interaction,
                    "❌ This server's trial has expired. Please upgrade via the dashboard.")

            async with self.locks[channel_id]:
                war = await get_war(channel_id)
                if not war or not war.get("is_active"):
                    return await self._reply_ephemeral(interaction, "ℹ️ No active war here.")
                cfg = await get_settings(guild.id, channel_id)
                required = cfg["attacks_required"]
                my_alias = await self._pick_alias(
                    guild.id, user.id, war.get("missing_list") or [],
                    war.get("attack_counts") or {})
                if not my_alias:
                    return await self._reply_ephemeral(
                        interaction,
                        "❌ You don't have an alias yet — ask staff to add you with "
                        "`!alias add @user <alias>` so your attacks can be tracked.",
                    )
                key = my_alias.lower()
                old_total = int((war.get("attack_counts") or {}).get(key) or 0)
                counts, missing = apply_attack(war, my_alias, 1, required)
                new_total = int(counts.get(key) or 0)
                await asyncio.to_thread(
                    supabase.table("wars").update(
                        {"attack_counts": counts, "missing_list": missing})
                    .eq("channel_id", channel_id).execute
                )
                if new_total > old_total:
                    await _log_attack_safely(
                        guild.id, channel_id, war.get("war_start"),
                        user.id, my_alias, new_total - old_total, "self",
                    )
            await self._reply_ephemeral(
                interaction, f"✅ **{my_alias}**: {new_total}/{required} attacks recorded.")
        except Exception as e:
            print(f"Attack button failed: {e}")
            await self._reply_ephemeral(
                interaction, "❌ Could not record that attack. Try `attacks done`.")

    async def _alias_target(self, ctx, raw):
        """Resolve an alias name or an @mention of an aliased member to its row."""
        raw = (raw or "").strip()
        mention = re.fullmatch(r"<@!?(\d+)>", raw)
        discord_id = int(mention.group(1)) if mention else None
        if discord_id is not None:
            row = await self._lookup_alias(ctx.guild.id, discord_id=discord_id)
            if not row:
                return None, "❌ That user has no alias yet. Add one with `!alias add @user <alias>`."
            return row, None
        if not raw:
            return None, "❌ Provide an alias name or @mention an aliased member."
        row = await self._lookup_alias(ctx.guild.id, name=raw)
        if not row:
            return None, f"❌ No alias `{raw.lower()}` in this server. Add it with `!alias add @user {raw.lower()}`."
        return row, None

    async def _removal_name(self, ctx, raw):
        """Name to drop from a JSONB list.

        Removal must still work after the alias itself was deleted or renamed,
        so unlike add it falls back to the raw lower-cased text.
        """
        raw = (raw or "").strip()
        if not raw:
            return None
        mention = re.fullmatch(r"<@!?(\d+)>", raw)
        if mention:
            row = await self._lookup_alias(ctx.guild.id, discord_id=int(mention.group(1)))
            return (row.get("alias_name") or "").lower() if row else None
        return raw.lower()

    async def _resolve_targets(self, ctx, args):
        """Resolve every player named in one argument; return (rows, error lines)."""
        targets = split_targets(args)
        if not targets:
            return [], []
        team = await asyncio.to_thread(get_team_by_channel, ctx.guild.id, ctx.channel.id)
        roster = (await asyncio.to_thread(get_team_players, ctx.guild.id, team["id"])
                  if team else None)
        rows, errors = [], []
        for target in targets:
            row, error = await self._alias_target(ctx, target)
            if error:
                errors.append(error)
                continue
            if roster and int(row.get("discord_id") or 0) not in roster:
                errors.append(
                    f"❌ `{(row.get('alias_name') or '').lower()}` isn't on "
                    f"**{team.get('name')}**'s roster. Add them with "
                    f"`!team add @user {team.get('name')}` first.")
                continue
            rows.append(row)
        return rows, errors

    async def war_missing(self, ctx, subaction, args):
        sub = (subaction or "list").lower()
        if sub not in ("list", "add", "remove"):
            return await ctx.send("Usage: `!war missing list`, `!war missing add <alias>` or `!war missing remove <alias>`")
        if sub != "list" and not await is_team_staff(ctx.author, ctx.channel.id):
            return await ctx.send("❌ Staff only.")
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war:
                return await ctx.send("ℹ️ No war data found.")
            war = await self._attach_roster(war, ctx.guild.id, ctx.channel.id)
            missing, absent = war.get("missing_list") or [], war.get("absent_list") or []
            if sub == "list":
                if not missing:
                    return await ctx.send("✅ The missing list is empty.")
                return await ctx.send("⚠️ **Missing:** " + (self._display_entries(missing, ctx.guild) or "None"))
            if sub == "remove":
                targets = split_targets(args)
                if not targets:
                    return await ctx.send("❌ Provide an alias name to remove.")
                removed, notes = [], []
                for target in targets:
                    name = await self._removal_name(ctx, target)
                    if name and any(_entry_name(entry) == name for entry in missing):
                        missing = [entry for entry in missing if _entry_name(entry) != name]
                        removed.append(name)
                    else:
                        notes.append(f"❌ `{name or target}` is not on the missing list.")
                if removed:
                    await asyncio.to_thread(
                        supabase.table("wars").update({"missing_list": missing})
                        .eq("channel_id", ctx.channel.id).execute
                    )
                    notes.insert(0, f"✅ Removed {_players_text(removed)} from missing: "
                                    f"{_name_list(removed)}.")
                return await ctx.send(_reply_lines(notes))

            rows, errors = await self._resolve_targets(ctx, args)
            if not rows and not errors:
                return await ctx.send("❌ Provide an alias name or @mention an aliased member.")
            cfg = await get_settings(ctx.guild.id, ctx.channel.id)
            required = cfg["attacks_required"]
            counts = {str(key).lower(): int(total or 0)
                      for key, total in (war.get("attack_counts") or {}).items()}
            added, notes = [], list(errors)
            for row in rows:
                name = (row.get("alias_name") or "").lower()
                entry = {"name": name}
                if row.get("discord_id") is not None:
                    entry["id"] = row["discord_id"]
                if required and counts.get(name, 0) >= required:
                    # Self-report is the source of truth: a player who already
                    # reported is never put back on the missing list.
                    notes.append(f"ℹ️ `{name}` already reported {counts[name]}/{required} "
                                 "— not added to missing.")
                elif any(_entry_name(item) == name for item in absent):
                    notes.append(f"🏖️ `{name}` is excused.")
                elif any(_entry_name(item) == name for item in missing):
                    notes.append(f"ℹ️ `{name}` is already on the missing list.")
                else:
                    missing.append(entry)
                    added.append(name)
            if added:
                await asyncio.to_thread(
                    supabase.table("wars").update({"missing_list": missing})
                    .eq("channel_id", ctx.channel.id).execute
                )
                notes.insert(0, f"✅ Added {_players_text(added)} to missing: "
                                f"{_name_list(added)}. War announcements will ping them.")
            return await ctx.send(_reply_lines(notes))

    async def war_absent(self, ctx, subaction, args):
        sub = (subaction or "list").lower()
        if sub not in ("list", "add", "remove"):
            return await ctx.send("Usage: `!war absent list`, `!war absent add <alias>` or `!war absent remove <alias>`")
        if sub != "list" and not await is_team_staff(ctx.author, ctx.channel.id):
            return await ctx.send("❌ Staff only.")
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war:
                return await ctx.send("ℹ️ No war data found.")
            war = await self._attach_roster(war, ctx.guild.id, ctx.channel.id)
            absent, missing = war.get("absent_list") or [], war.get("missing_list") or []
            if sub == "list":
                if not absent:
                    return await ctx.send("✅ The excused list is empty.")
                return await ctx.send("🏖️ **Excused:** " + (self._display_entries(absent, ctx.guild) or "None"))
            if sub == "remove":
                targets = split_targets(args)
                if not targets:
                    return await ctx.send("❌ Provide an alias name to remove.")
                removed, notes = [], []
                for target in targets:
                    name = await self._removal_name(ctx, target)
                    if name and any(_entry_name(entry) == name for entry in absent):
                        absent = [entry for entry in absent if _entry_name(entry) != name]
                        removed.append(name)
                    else:
                        notes.append(f"❌ `{name or target}` is not on the excused list.")
                if removed:
                    await asyncio.to_thread(
                        supabase.table("wars").update({"absent_list": absent})
                        .eq("channel_id", ctx.channel.id).execute
                    )
                    notes.insert(0, f"✅ Removed {_players_text(removed)} from excused: "
                                    f"{_name_list(removed)}.")
                return await ctx.send(_reply_lines(notes))

            rows, errors = await self._resolve_targets(ctx, args)
            if not rows and not errors:
                return await ctx.send("❌ Provide an alias name or @mention an aliased member.")
            added, notes = [], list(errors)
            for row in rows:
                name = (row.get("alias_name") or "").lower()
                entry = {"name": name}
                if row.get("discord_id") is not None:
                    entry["id"] = row["discord_id"]
                if any(_entry_name(item) == name for item in absent):
                    notes.append(f"ℹ️ `{name}` is already excused.")
                else:
                    absent.append(entry)
                    missing = [item for item in missing if _entry_name(item) != name]
                    added.append(name)
            if added:
                await asyncio.to_thread(
                    supabase.table("wars").update({"absent_list": absent, "missing_list": missing})
                    .eq("channel_id", ctx.channel.id).execute
                )
                notes.insert(0, f"🏖️ Added {_players_text(added)} to excused: "
                                f"{_name_list(added)}.")
            return await ctx.send(_reply_lines(notes))

    async def war_attacks(self, ctx, args):
        if not await is_team_staff(ctx.author, ctx.channel.id):
            return await ctx.send("❌ Staff only.")
        args = (args or "").strip()
        if not args:
            return await ctx.send("Usage: `!war attacks <alias> <count>`")
        if "|" in args:
            name_part, count_part = args.split("|", 1)
            raw_name, count = name_part.strip(), count_part.strip()
        else:
            parts = args.rsplit(maxsplit=1)
            if len(parts) != 2:
                return await ctx.send("Usage: `!war attacks <alias> <count>` (or `alias | count`)")
            raw_name, count = parts[0].strip(), parts[1].strip()
        if not count.isdigit():
            return await ctx.send("❌ Count must be a number.")

        row, error = await self._alias_target(ctx, raw_name)
        if error:
            return await ctx.send(error)
        name = (row.get("alias_name") or "").lower()
        discord_id = row.get("discord_id")

        cfg = await get_settings(ctx.guild.id, ctx.channel.id)
        required = cfg["attacks_required"]
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war:
                return await ctx.send("ℹ️ No war data found.")
            if not war.get("is_active"):
                return await ctx.send("ℹ️ No active war here.")
            counts = dict(war.get("attack_counts") or {})
            missing = list(war.get("missing_list") or [])
            old_count = int(counts.get(name) or 0)
            new_count = min(int(count), required)
            counts[name] = new_count
            if new_count >= required:
                missing = [m for m in missing if (m.get("name") or "").lower() != name]
            else:
                absent = {(a.get("name") or "").lower() for a in war.get("absent_list") or []}
                if name not in absent and not any((m.get("name") or "").lower() == name for m in missing):
                    entry = {"name": name}
                    if discord_id is not None:
                        entry["id"] = discord_id
                    missing.append(entry)
            await asyncio.to_thread(
                supabase.table("wars").update({"attack_counts": counts, "missing_list": missing})
                .eq("channel_id", ctx.channel.id).execute
            )
            if new_count != old_count:
                # war_logs.source='staff': audit trail for manual corrections.
                await _log_attack_safely(
                    ctx.guild.id, ctx.channel.id, war.get("war_start"),
                    discord_id, name, new_count - old_count, "staff",
                )
        await ctx.send(f"✅ `{name}`: {new_count}/{required} attacks.")

    async def war_check(self, ctx):
        if not await is_team_staff(ctx.author, ctx.channel.id):
            return await ctx.send("❌ Staff only.")
        war = await get_war(ctx.channel.id)
        if not war: return await ctx.send("ℹ️ No war data found.")
        cfg = await get_settings(ctx.guild.id, ctx.channel.id)
        required = cfg["attacks_required"]
        counts = {k.lower(): int(v or 0) for k, v in (war.get("attack_counts") or {}).items()}
        absent = {_entry_name(a) for a in war.get("absent_list") or []}
        missing = {_entry_name(m) for m in war.get("missing_list") or []}
        names = set(counts) | missing
        if not cfg["exempt_absent"]:
            names |= absent
        short = sorted(((n, counts.get(n, 0)) for n in names if not (cfg["exempt_absent"] and n in absent) and counts.get(n, 0) < required), key=lambda x: (x[1], x[0]))
        embed = discord.Embed(title=f"📋 Below {required} attacks", color=discord.Color.orange())
        if short: embed.description = "\n".join(f"• {n} — {c}/{required}" for n, c in short)
        else: embed.description = "✅ Everyone met the requirement."
        await ctx.send(embed=embed)

    async def _resolve_member(self, ctx, raw):
        """Resolve ``@mention`` / id / display name to a member without an API call when cached."""
        raw = (raw or "").strip()
        if not raw:
            return None
        match = re.fullmatch(r"<@!?(\d+)>", raw)
        if match:
            return ctx.guild.get_member(int(match.group(1)))
        name_query = raw[1:].strip() if raw.startswith("@") else raw
        member = ctx.guild.get_member_named(name_query)
        if member:
            return member
        # Only fall back to a mention when the raw argument actually names that
        # member; otherwise "!warning add sam reason @bob" would warn bob.
        for mentioned in getattr(ctx.message, "mentions", []) or []:
            if (raw in (mentioned.mention, str(mentioned.id))
                    or name_query.lower() in (
                        getattr(mentioned, "display_name", "").lower(),
                        getattr(mentioned, "name", "").lower())):
                return mentioned
        try:
            results = await ctx.guild.query_members(query=name_query, limit=5)
        except Exception:
            results = []
        return results[0] if results else None

    async def warning_dispatch(self, ctx, action, target, reason):
        if not await is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        action = (action or "").lower()
        usage = "Usage: `!warning add @user <reason>` · `!warning list [@user]` · `!warning remove <id>`"
        if action not in ("add", "list", "remove"):
            return await ctx.send(usage)

        try:
            if action == "remove":
                if not (target or "").isdigit():
                    return await ctx.send("❌ Usage: `!warning remove <id>` — get IDs from `!warning list`.")
                res = await asyncio.to_thread(
                    supabase.table("warnings").delete()
                    .eq("id", int(target)).eq("guild_id", ctx.guild.id).execute
                )
                return await ctx.send("✅ Warning removed." if res.data else "❌ Not found.")

            if action == "list" and not target:
                res = await asyncio.to_thread(
                    supabase.table("warnings").select("id, discord_id, reason")
                    .eq("guild_id", ctx.guild.id).order("created_at", desc=True).limit(15).execute
                )
                if not res.data:
                    return await ctx.send("✅ No warnings recorded for this server.")
                embed = discord.Embed(title=f"⚠️ Warnings ({len(res.data)})", color=discord.Color.red())
                for w in res.data:
                    embed.add_field(name=f"ID {w['id']} · <@{w['discord_id']}>",
                                    value=_short(w.get("reason"), 300), inline=False)
                return await ctx.send(embed=embed)

            if not target:
                return await ctx.send(usage)

            member = await self._resolve_member(ctx, target)
            if member is None:
                return await ctx.send(f"❌ Couldn't find a member called `{target}`. Try mentioning them.")
            if action == "add":
                alias_row = await self._lookup_alias(ctx.guild.id, discord_id=member.id)
                if not alias_row:
                    return await ctx.send("❌ That member has no alias yet. Add one with `!alias add @user <alias>` — warnings use aliases like the dashboard.")
                reason_text = (reason or "No reason provided").strip()
                # warnings.discord_id is a foreign key into users.
                await asyncio.to_thread(ensure_user, member.id)
                await asyncio.to_thread(
                    supabase.table("warnings").insert({
                        "guild_id": ctx.guild.id, "discord_id": member.id,
                        "reason": reason_text, "issued_by": ctx.author.id,
                    }).execute
                )
                await ctx.send(f"📌 **{alias_row['alias_name']}** has been warned.")
                # DM the warned player so the warning is not only visible to
                # staff. Closed DMs / a blocked bot must never break the command.
                dm = discord.Embed(
                    title="⚠️ Warning received",
                    description=_short(reason_text, 1500),
                    color=discord.Color.red(),
                )
                dm.set_footer(text=f"From {ctx.guild.name}")
                try:
                    await member.send(embed=dm)
                except discord.HTTPException:
                    await ctx.send("*(Couldn't DM them — their DMs may be closed.)*")
            else:
                res = await asyncio.to_thread(
                    supabase.table("warnings").select("*")
                    .eq("guild_id", ctx.guild.id).eq("discord_id", member.id)
                    .order("created_at", desc=True).limit(10).execute
                )
                if not res.data: return await ctx.send(f"✅ **{member.display_name}** has no warnings.")
                embed = discord.Embed(title=f"Warnings for {member.display_name}", color=discord.Color.red())
                for w in res.data:
                    embed.add_field(name=f"ID {w['id']}", value=_short(w.get("reason"), 500), inline=False)
                await ctx.send(embed=embed)
        except Exception as e:
            await ctx.send(f"❌ Error: {e}")

    @commands.command(name="warning")
    @commands.guild_only()
    async def warning_group(self, ctx, action: str = None, target: str = None, *, reason: str = None):
        await self.warning_dispatch(ctx, action, target, reason)

    async def war_warning(self, ctx, subaction, args):
        parts = (args or "").split(maxsplit=1)
        await self.warning_dispatch(ctx, subaction, parts[0] if parts else None, parts[1] if len(parts) > 1 else None)

    async def _owes_attacks(self, message, war):
        """True when this member still has attacks to report.

        Only then is a plain "attacks done" worth asking for, so finished players
        and ordinary chat are never nagged.
        """
        my_alias = await self._pick_alias(
            message.guild.id, message.author.id, war.get("missing_list") or [],
            war.get("attack_counts") or {})
        if not my_alias:
            return False
        cfg = await get_settings(message.guild.id, message.channel.id)
        required = cfg["attacks_required"]
        total = int((war.get("attack_counts") or {}).get(my_alias.lower()) or 0)
        return not required or total < required

    async def _ask_for_plain_report(self, message):
        """Tag the author and mark the message: only a plain report is recorded."""
        try:
            await message.add_reaction("❓")
        except discord.HTTPException as e:
            print(f"Could not mark an attack message in {message.channel.id}: {e}")
        try:
            await message.reply(
                f"{message.author.mention} — I only record a plain "
                "`attacks done` or `attacks done 4/6` message. Send that as the whole "
                "message and I'll log it; nothing was recorded from this one.",
                mention_author=False,
            )
        except discord.HTTPException as e:
            print(f"Could not ask for a plain attack report in {message.channel.id}: {e}")

    async def _record_text_report(self, message, war, reported):
        """Apply one plain "attacks done" report; return what the reply needs.

        Returns ``(alias, total, required, completed, was_missing)`` or None when
        the author has no alias (the player is told how to get one).
        """
        cfg = await get_settings(message.guild.id, message.channel.id)
        required = cfg["attacks_required"]

        # Aliases are the single player identity: without one, nothing is logged.
        my_alias = await self._pick_alias(
            message.guild.id, message.author.id, war.get("missing_list") or [],
            war.get("attack_counts") or {})
        if not my_alias:
            try:
                await message.reply(
                    "❌ You don't have an alias yet — ask staff to add you with "
                    "`!alias add @user <alias>` so your attacks can be tracked.",
                    mention_author=False,
                )
            except discord.HTTPException:
                pass
            return None

        key = my_alias.lower()
        was_missing = any(
            _entry_name(entry) == key for entry in war.get("missing_list") or [])
        done = reported or required
        old_total = int((war.get("attack_counts") or {}).get(key) or 0)

        # Absolute text count, capped at the requirement: pressing the button
        # as well can never push the total over the cap.
        counts, missing = apply_attack(war, my_alias, done - old_total, required)
        total = int(counts.get(key) or 0)
        # A downward text correction is not a new attack, but it drops the
        # player below the requirement: put them back on the missing list
        # (same as the !war attacks correction path).
        excused = {_entry_name(a) for a in war.get("absent_list") or []}
        if required and total < required and key not in excused and not any(
                _entry_name(entry) == key for entry in missing):
            missing = list(missing) + [{"name": my_alias, "id": message.author.id}]

        await asyncio.to_thread(
            supabase.table("wars").update({"missing_list": missing, "attack_counts": counts})
            .eq("channel_id", message.channel.id).execute
        )
        # A lower text count is a correction, not a new attack: never log a
        # negative delta from the text path (only the staff undo is negative).
        log_delta = max(0, total - old_total)
        if log_delta:
            await _log_attack_safely(
                message.guild.id, message.channel.id,
                war.get("war_start"), message.author.id, my_alias,
                log_delta, "self",
            )
        completed = required > 0 and total >= required
        return my_alias, total, required, completed, was_missing

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot or not message.guild: return
        text = (message.content or "").strip()
        if not DONE_ANY_RE.search(text): return
        # This path bypasses the command-level premium gate in main.py.
        if not await asyncio.to_thread(check_premium_status, message.guild.id):
            return

        plain, reported = parse_done_report(text)
        async with self.locks[message.channel.id]:
            war = await get_war(message.channel.id)
            if not war or not war.get("is_active"): return
            if not plain:
                # A chat line that mentions the phrase is not a report: prompt
                # only a member who still owes attacks, and record nothing.
                nudge = await self._owes_attacks(message, war)
                result = None
            else:
                nudge = False
                result = await self._record_text_report(message, war, reported)

        if nudge:
            return await self._ask_for_plain_report(message)
        if result is None:
            return
        my_alias, total, required, completed, was_missing = result

        try:
            reply = await message.reply(
                f"✅ **{my_alias}**: {total}/{required} attacks recorded."
                + (" Staff: react ❌ to undo." if completed and was_missing else ""),
                mention_author=False,
            )
        except discord.HTTPException as e:
            print(f"Could not reply to attack log in {message.channel.id}: {e}")
            return
        if completed and was_missing:
            if len(self.done_replies) > 500:
                self.done_replies.pop(next(iter(self.done_replies)), None)
            self.done_replies[reply.id] = {
                "name": my_alias,
                "id": message.author.id,
                "war_start": war.get("war_start"),
            }
            try:
                await reply.add_reaction("❌")
            except discord.HTTPException as e:
                print(f"Could not add undo reaction in {message.channel.id}: {e}")

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        if payload.user_id == self.bot.user.id or str(payload.emoji) != "❌": return
        entry = self.done_replies.get(payload.message_id)
        if not entry: return
        if isinstance(entry, str):
            # Entries from before the stored-shape change are plain names.
            entry = {"name": entry}
        name = (entry.get("name") or "").lower()
        if not name: return
        guild = self.bot.get_guild(payload.guild_id)
        reactor = guild.get_member(payload.user_id) if guild else None
        if not reactor or not await is_team_staff(reactor, payload.channel_id): return

        async with self.locks[payload.channel_id]:
            war = await get_war(payload.channel_id)
            if not war or not war.get("is_active"): return
            entry_war_start = entry.get("war_start")
            if entry_war_start is not None and entry_war_start != war.get("war_start"):
                # A new war owns this channel now; leave the old reply alone.
                self.done_replies.pop(payload.message_id, None)
                return
            missing = war.get("missing_list") or []
            counts = dict(war.get("attack_counts") or {})
            old_total = int(counts.get(name) or 0)
            if not any(_entry_name(m) == name for m in missing):
                # Keep the stored Discord id so the reminder mentions survive
                # an alias rename.
                missing = list(missing) + [dict(entry)]
                counts[name] = 0
                await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing, "attack_counts": counts}).eq("channel_id", payload.channel_id).execute)
                if old_total:
                    await _log_attack_safely(
                        payload.guild_id, payload.channel_id,
                        war.get("war_start"), entry.get("id") or reactor.id,
                        name, -old_total, "undo",
                    )

        self.done_replies.pop(payload.message_id, None)
        channel = self.bot.get_channel(payload.channel_id)
        if channel: await channel.send(f"↩️ **{name}** re-added to missing by {reactor.display_name}.")

    async def show_help(self, ctx):
        is_staff = await is_staff_member(ctx.author)
        embed = discord.Embed(title="🛡️ War Commands", color=discord.Color.blue())
        embed.add_field(
            name="Timeline",
            value=(
                "The in-game war clock runs **48h → 0h**: defence covers 48h → 24h left, "
                "attack covers 24h → 0h left, war ends at 0h. "
                "`<time>` is the time left in the phase you name — tracking can start at any point:\n"
                "`!war defence ends 20h` → 20h of defence left, war ends in 44h\n"
                "`!war attack ends 20h` → 20h of attack left, war ends in 20h"
            ),
            inline=False,
        )
        embed.add_field(name="Public", value="`!war status` — live-style board with countdowns + ping schedule\n`!war missing list`\n`attacks done` or the **✅ I attacked** button (uses your alias)", inline=False)
        if is_staff: embed.add_field(name="Staff", value="`!war defence ends <time>`\n`!war attack ends <time>`\n`!war cancel`\n`!war missing add|remove <alias>`\n`!war absent add|remove <alias>`\n`!war attacks <alias> <count>`\n`!war check`\n`!war board` — live updating board\n`!war set attacks <number>` · `!war set exempt on|off` — this team's war rules\n`!war set role @Role` — role pinged by this channel's announcements\n`!war warning add @user <reason>`", inline=False)
        await ctx.send(embed=embed)

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
