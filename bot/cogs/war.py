import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
import time
import asyncio
from collections import defaultdict
from database import supabase, is_staff_member, ensure_user, get_staff_role_ids

DEFENCE = ("defence", "defense")
PHASE = timedelta(hours=24)
WAR = timedelta(hours=48)
DONE_RE = re.compile(r"\b(?:(\d+)\s+)?attacks?\s+done(?:\s+(\d+))?\b", re.I)

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


def _initial_sent(war_end, now, grace=3600):
    """Mark reminders already missed by more than the grace window so tracking
    a war midway through doesn't spam old reminders."""
    return [
        key for key, offset, _label in PING_SCHEDULE
        if (now - _ping_due(war_end, offset)).total_seconds() > grace
    ]


def _ping_phase_label(offset):
    return "defence" if offset >= 24 * 3600 else "attack"

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

def join_names(items, limit=1000):
    text = ", ".join(i["name"] for i in items)
    return text if len(text) <= limit else text[:limit - 3] + "..."

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
    return res.data[0] if res.data else None

async def get_settings(guild_id):
    res = await asyncio.to_thread(supabase.table("war_settings").select("*").eq("guild_id", guild_id).limit(1).execute)
    settings = {"attacks_required": 6, "exempt_absent": True}
    if res.data:
        row = res.data[0]
        if row.get("attacks_required") is not None:
            settings["attacks_required"] = int(row["attacks_required"])
        if row.get("exempt_absent") is not None:
            settings["exempt_absent"] = bool(row["exempt_absent"])
    return settings

async def check_team_limit(guild_id):
    res = await asyncio.to_thread(supabase.table("guilds").select("max_teams").eq("guild_id", guild_id).execute)
    max_teams = (res.data[0].get("max_teams") if res.data else None) or 1
    active = await asyncio.to_thread(supabase.table("wars").select("channel_id").eq("guild_id", guild_id).eq("is_active", True).execute)
    return len(active.data) < max_teams

class WarTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.status_tasks = {}
        self.ping_tasks = {}
        self.done_replies = {}  
        self.locks = defaultdict(asyncio.Lock)
        self.board_updated = {}

    async def cog_load(self):
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
            if not await is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
            if subaction == "attacks" and args and args.strip().isdigit():
                await asyncio.to_thread(supabase.table("war_settings").upsert({"guild_id": ctx.guild.id, "attacks_required": int(args)}, on_conflict="guild_id").execute)
                return await ctx.send(f"✅ Required attacks updated to **{args.strip()}**.")
            return await ctx.send("Usage: `!war set attacks <number>`")
            
        if action in ("defence", "defense", "attack"):
            if not await is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
            if subaction != "ends" or not args: return await ctx.send(f"Usage: `!war {action} ends <time>`")
            return await self.start_timer(ctx, action, args)

        await ctx.send("❌ Unknown war action. Use `!war help`.")

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
            if not existing_war or not existing_war.get("is_active"):
                war_data["missing_list"] = []
                war_data["absent_list"] = []
                war_data["attack_counts"] = {}
                war_data["status_message_id"] = None
                # Starting mid-war: don't fire reminders whose window already
                # passed by more than the grace period.
                initial = _initial_sent(war_end, now)
                if current_phase == "attack" and "attack_started" not in initial:
                    initial.append("attack_started")
                war_data["sent_pings"] = initial
            else:
                war_data["sent_pings"] = sorted(_sent_keys(existing_war))
                war_data["status_message_id"] = existing_war.get("status_message_id")

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
        if not await is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
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

    async def _notify_missing(self, channel, entry):
        """Ping a player the moment they are added to the missing list."""
        name = entry.get("name") or ""
        discord_id = entry.get("id")
        member = channel.guild.get_member(int(discord_id)) if discord_id else None
        text = "you're on the **missing attacks** list for the current war — use `attacks done` after you attack."
        if member is not None:
            try:
                await member.send(f"⚠️ You're on the missing attacks list in {channel.guild.name} — use `attacks done` after you attack.")
            except (discord.HTTPException, AttributeError):
                pass
            try:
                await channel.send(
                    content=f"⚠️ {member.mention} {text}",
                    allowed_mentions=discord.AllowedMentions(users=True),
                )
                return
            except (discord.HTTPException, AttributeError, TypeError):
                pass
        try:
            await channel.send(f"⚠️ **{name}** {text}")
        except (discord.HTTPException, AttributeError, TypeError) as e:
            print(f"Missing-list ping failed: {e}")

    async def _send_ping(self, channel, content, embed=None):
        try:
            # channel.guild.me is None when the bot member is not cached (for
            # example right after a reconnect); don't crash the updater then.
            me = getattr(getattr(channel, "guild", None), "me", None)
            can_mention = bool(me and channel.permissions_for(me).mention_everyone)
            if can_mention:
                await channel.send(
                    content="@everyone " + content,
                    embed=embed,
                    allowed_mentions=discord.AllowedMentions(everyone=True),
                )
            else:
                await channel.send(content=content, embed=embed)
        except (discord.HTTPException, AttributeError, TypeError) as e:
            print(f"War announcement failed in {getattr(channel, 'id', '?')}: {e}")

    async def status_updater(self, channel_id, channel):
        """Watches one war: phase switches, scheduled reminders and the live board."""
        while True:
            try:
                war = await get_war(channel_id)
                if not war or not war.get("is_active"):
                    return

                start = to_utc(war.get("war_start"))
                if not start:
                    return

                now = datetime.now(timezone.utc)
                current = phase_at(start, now)
                if current == "ended":
                    await self.finish_war(channel_id, channel)
                    return

                war_end = start + WAR
                sent = _sent_keys(war)
                changed = False

                stored = (war.get("phase") or "").lower()
                if current == "attack" and stored in DEFENCE:
                    await asyncio.to_thread(
                        supabase.table("wars").update({"phase": "attack"})
                        .eq("channel_id", channel_id).execute
                    )
                    await self.announce_attack(channel, start, war)
                    if "attack_started" not in sent:
                        sent.add("attack_started")
                        changed = True

                for key, label, _due_at in _due_pings(war_end, sent, now):
                    await self.send_reminder(channel, war, start, key, label)
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
        await self._send_ping(
            channel,
            "⚔️ **Attack phase started!** Use `attacks done` after attacking.",
            self.build_embed(war, channel=channel, title_prefix="⚔️ **Attack phase started!**"),
        )

    async def send_reminder(self, channel, war, start, key, label):
        war_end = start + WAR
        missing = war.get("missing_list") or []
        war_ts = int(war_end.timestamp())
        if key == "hours_12":
            # The 12h reminder points at the players who still owe attacks
            # instead of pinging everyone.
            mentions = await self._missing_mentions(war)
            content = "⏱️ **12 hours left!** "
            if mentions:
                content += "Missing attacks: " + ", ".join(mentions) + " — use `attacks done` after you attack."
                allowed = discord.AllowedMentions(users=True)
            else:
                content += "Use `attacks done` after you attack."
                allowed = discord.AllowedMentions.none()
            embed = discord.Embed(
                title="⏱️ 12 hours left in the war",
                description=(
                    f"**War ends:** <t:{war_ts}:R>\n"
                    f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}"
                ),
                color=discord.Color.orange(),
            )
            try:
                await channel.send(content=content, embed=embed, allowed_mentions=allowed)
            except (discord.HTTPException, AttributeError, TypeError) as e:
                print(f"War 12h reminder failed: {e}")
            return

        embed = self.build_embed(war, channel=channel)
        embed.title = f"⏰ {label}"
        embed.description = (
            f"**War ends:** <t:{war_ts}:R>\n"
            f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}\n"
            "Use `attacks done` after attacking."
        )
        await self._send_ping(channel, f"⏰ **{label}**", embed)

    async def _missing_mentions(self, war):
        missing = war.get("missing_list") or []
        ids = [str(m["id"]) for m in missing if m.get("id")]
        names = [m.get("name") or "" for m in missing if not m.get("id")]
        if names and war.get("guild_id"):
            try:
                res = await asyncio.to_thread(
                    supabase.table("aliases").select("alias_name, discord_id")
                    .eq("guild_id", war["guild_id"]).execute
                )
                wanted = {n.lower() for n in names if n}
                for row in res.data:
                    if (row.get("alias_name") or "").lower() in wanted:
                        ids.append(str(row["discord_id"]))
            except Exception as e:
                print(f"Missing alias lookup failed: {e}")
        seen, mentions = set(), []
        for discord_id in ids:
            if discord_id not in seen:
                seen.add(discord_id)
                mentions.append(f"<@{discord_id}>")
        return mentions[:50]

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

        if current == "ended":
            return discord.Embed(
                title=f"🏁 WAR ENDED{team}",
                color=discord.Color.red(),
                description=(
                    f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}\n"
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
        embed.add_field(name=f"⚠️ Missing ({len(missing)})", value=join_names(missing) or "None", inline=False)
        embed.add_field(
            name=f"🏖️ Excused (absence channel) — {len(absent)}",
            value=join_names(absent) or "None",
            inline=False,
        )

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
                await message.edit(embed=embed)
                return
            except (discord.NotFound, discord.Forbidden, discord.HTTPException,
                    AttributeError, TypeError):
                pass  # message deleted or bot lacks access -> post a fresh one

        try:
            message = await channel.send(embed=embed)
        except (discord.HTTPException, AttributeError, TypeError) as e:
            print(f"War board could not be posted in {channel_id}: {e}")
            return
        await asyncio.to_thread(
            supabase.table("wars").update({"status_message_id": message.id})
            .eq("channel_id", channel_id).execute
        )

    async def finish_war(self, channel_id, channel):
        task = self.status_tasks.pop(channel_id, None)
        if task and task is not asyncio.current_task():
            task.cancel()
        self.board_updated.pop(channel_id, None)

        try:
            war = await get_war(channel_id) or {}
            missing = war.get("missing_list") or []
            sent = _sent_keys(war)
            sent.add(WAR_END_KEY)
            await asyncio.to_thread(
                supabase.table("wars").update({
                    "is_active": False, "phase": "ended", "sent_pings": sorted(sent),
                }).eq("channel_id", channel_id).execute
            )
            war.update({"is_active": False, "phase": "ended", "sent_pings": sorted(sent)})
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
            await self._send_staff_ping(channel, embed)
        except Exception as e:
            print(f"Could not finish war in {channel_id}: {e}")

    async def _send_staff_ping(self, channel, embed):
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
        await self._send_ping(
            channel,
            "🏁 **The war has ended!** Staff: start the next war with `!war defence ends <time>`.",
            embed,
        )

    async def show_status(self, ctx):
        war = await get_war(ctx.channel.id)
        await ctx.send(embed=self.build_embed(war, channel=ctx.channel))

    async def cancel_war(self, ctx):
        if not await is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        war = await get_war(ctx.channel.id)
        if not war or not war.get("is_active"): return await ctx.send("ℹ️ No active war here.")
        await self.finish_war(ctx.channel.id, ctx.channel)

    async def war_report(self, ctx):
        war = await get_war(ctx.channel.id)
        if not war: return await ctx.send("ℹ️ No war data found.")
        missing, absent = war.get("missing_list") or [], war.get("absent_list") or []
        embed = discord.Embed(title="🏁 Final War Report", color=discord.Color.red())
        embed.add_field(name=f"❌ Missed Attacks ({len(missing)})", value=join_names(missing) or "Everyone completed attacks!", inline=False)
        if absent: embed.add_field(name=f"🏖️ Excused ({len(absent)})", value=join_names(absent), inline=False)
        await ctx.send(embed=embed)

    def _resolve_name(self, ctx, raw):
        """Turn an ``@mention`` into a display name, otherwise lower-case the text."""
        raw = (raw or "").strip()
        if not raw:
            return None
        if ctx.message.mentions:
            member = ctx.message.mentions[0]
            return (member.display_name or member.name).strip().lower()
        return raw.lower()

    async def war_missing(self, ctx, subaction, args):
        sub = (subaction or "list").lower()
        if sub not in ("list", "add", "remove"):
            return await ctx.send("Usage: `!war missing list`, `!war missing add <name>` or `!war missing remove <name>`")
        if sub != "list" and not await is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            missing, absent = war.get("missing_list") or [], war.get("absent_list") or []
            if sub == "list":
                if not missing: return await ctx.send("✅ The missing list is empty.")
                return await ctx.send("⚠️ **Missing:** " + join_names(missing))
            name = self._resolve_name(ctx, args)
            if not name: return await ctx.send("❌ Provide a name or mention a user.")
            if sub == "add":
                if any((a.get("name") or "").lower() == name for a in absent):
                    return await ctx.send(f"🏖️ `{name}` is excused.")
                entry = {"name": name}
                member = ctx.message.mentions[0] if ctx.message.mentions else None
                if member is not None:
                    entry["id"] = member.id
                else:
                    try:
                        res = await asyncio.to_thread(
                            supabase.table("aliases").select("discord_id")
                            .eq("guild_id", ctx.guild.id).eq("alias_name", name).limit(1).execute
                        )
                        if res.data:
                            entry["id"] = res.data[0]["discord_id"]
                    except Exception as e:
                        print(f"Missing-list alias lookup failed: {e}")
                added = not any((m.get("name") or "").lower() == name for m in missing)
                if added:
                    missing.append(entry)
                    await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
                await ctx.send(f"✅ Added `{name}` to missing.")
                if added:
                    await self._notify_missing(ctx.channel, entry)
            else:
                if not any(m["name"].lower() == name for m in missing):
                    return await ctx.send(f"❌ `{name}` is not on the missing list.")
                missing = [m for m in missing if m["name"].lower() != name]
                await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
                await ctx.send(f"✅ Removed `{name}` from missing.")

    async def war_absent(self, ctx, subaction, args):
        sub = (subaction or "list").lower()
        if sub not in ("list", "add", "remove"):
            return await ctx.send("Usage: `!war absent list`, `!war absent add <name>` or `!war absent remove <name>`")
        if sub != "list" and not await is_staff_member(ctx.author):
            return await ctx.send("❌ Staff only.")
        args = (args or "").strip()
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            absent, missing = war.get("absent_list") or [], war.get("missing_list") or []
            if sub == "list":
                if not absent: return await ctx.send("✅ The excused list is empty.")
                return await ctx.send("🏖️ **Excused:** " + join_names(absent))
            name = self._resolve_name(ctx, args)
            if not name: return await ctx.send("❌ Provide a name or mention a user.")
            if sub == "add":
                if not any(a["name"].lower() == name for a in absent):
                    absent.append({"name": name})
                    missing = [m for m in missing if m["name"].lower() != name]
                    await asyncio.to_thread(supabase.table("wars").update({"absent_list": absent, "missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
                await ctx.send(f"🏖️ Added `{name}` to excused.")
            else:
                if not any(a["name"].lower() == name for a in absent):
                    return await ctx.send(f"❌ `{name}` is not on the excused list.")
                absent = [a for a in absent if a["name"].lower() != name]
                await asyncio.to_thread(supabase.table("wars").update({"absent_list": absent}).eq("channel_id", ctx.channel.id).execute)
                await ctx.send(f"✅ Removed `{name}` from excused.")

    async def war_attacks(self, ctx, args):
        if not await is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        args = (args or "").strip()
        if not args: return await ctx.send("Usage: `!war attacks <name> <count>`")
        if "|" in args:
            name_part, count_part = args.split("|", 1)
            raw_name, count = name_part.strip(), count_part.strip()
        else:
            parts = args.rsplit(maxsplit=1)
            if len(parts) != 2: return await ctx.send("Usage: `!war attacks <name> <count>` (or `name | count`)")
            raw_name, count = parts[0].strip(), parts[1].strip()
        if not raw_name: return await ctx.send("Usage: `!war attacks <name> <count>` (or `name | count`)")
        if not count.isdigit(): return await ctx.send("❌ Count must be a number.")

        # Accept "@user", "<@id>" and plain names (stored lower-case like elsewhere).
        member = ctx.message.mentions[0] if ctx.message.mentions else None
        if member is None:
            mention = re.fullmatch(r"<@!?(\d+)>", raw_name)
            if mention and ctx.guild:
                member = ctx.guild.get_member(int(mention.group(1)))
        name = (member.display_name if member else raw_name).strip().lower()

        cfg = await get_settings(ctx.guild.id)
        required = cfg["attacks_required"]
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            counts = war.get("attack_counts") or {}
            missing = war.get("missing_list") or []
            counts[name] = int(count)
            if int(count) >= required:
                missing = [m for m in missing if (m.get("name") or "").lower() != name]
            else:
                absent = {(a.get("name") or "").lower() for a in war.get("absent_list") or []}
                if name not in absent and not any((m.get("name") or "").lower() == name for m in missing):
                    missing.append({"name": name})
            await asyncio.to_thread(supabase.table("wars").update({"attack_counts": counts, "missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
        await ctx.send(f"✅ `{name}`: {count}/{required} attacks.")

    async def war_check(self, ctx):
        if not await is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        war = await get_war(ctx.channel.id)
        if not war: return await ctx.send("ℹ️ No war data found.")
        cfg = await get_settings(ctx.guild.id)
        required = cfg["attacks_required"]
        counts = {k.lower(): int(v or 0) for k, v in (war.get("attack_counts") or {}).items()}
        absent = {a["name"].lower() for a in war.get("absent_list") or []}
        missing = {m["name"].lower() for m in war.get("missing_list") or []}
        names = set(counts) | missing 
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
        if ctx.message.mentions:
            return ctx.message.mentions[0]
        match = re.fullmatch(r"<@!?(\d+)>", raw)
        if match:
            member = ctx.guild.get_member(int(match.group(1)))
            if member:
                return member
        member = ctx.guild.get_member_named(raw)
        if member:
            return member
        try:
            results = await ctx.guild.query_members(query=raw, limit=5)
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
                                    value=w.get("reason") or "No reason", inline=False)
                return await ctx.send(embed=embed)

            if not target:
                return await ctx.send(usage)

            member = await self._resolve_member(ctx, target)
            if member is None:
                return await ctx.send(f"❌ Couldn't find a member called `{target}`. Try mentioning them.")
            if action == "add":
                # warnings.discord_id is a foreign key into users.
                await asyncio.to_thread(ensure_user, member.id)
                await asyncio.to_thread(
                    supabase.table("warnings").insert({
                        "guild_id": ctx.guild.id, "discord_id": member.id,
                        "reason": reason or "No reason", "issued_by": ctx.author.id,
                    }).execute
                )
                await ctx.send(f"📌 **{member.display_name}** has been warned.")
            else:
                res = await asyncio.to_thread(
                    supabase.table("warnings").select("*")
                    .eq("guild_id", ctx.guild.id).eq("discord_id", member.id)
                    .order("created_at", desc=True).limit(10).execute
                )
                if not res.data: return await ctx.send(f"✅ **{member.display_name}** has no warnings.")
                embed = discord.Embed(title=f"Warnings for {member.display_name}", color=discord.Color.red())
                for w in res.data: embed.add_field(name=f"ID {w['id']}", value=w['reason'] or "No reason", inline=False)
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

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot or not message.guild: return
        if not DONE_RE.search(message.content): return

        async with self.locks[message.channel.id]:
            war = await get_war(message.channel.id)
            if not war or not war.get("is_active"): return

            cfg = await get_settings(message.guild.id)
            required = cfg["attacks_required"]
            counts = war.get("attack_counts") or {}
            missing = war.get("missing_list") or []
            
            aliases = await asyncio.to_thread(supabase.table("aliases").select("alias_name, discord_id").eq("guild_id", message.guild.id).execute)
            alias_map = {row["alias_name"]: row["discord_id"] for row in aliases.data}
            names = {message.author.display_name.lower(), message.author.name.lower(), *[k.lower() for k, v in alias_map.items() if v == message.author.id]}
            found = next((m for m in missing if m["name"].lower() in names), None)

            m = DONE_RE.search(message.content)
            done = int(m.group(1) or m.group(2) or required)
            key = found["name"].lower() if found else message.author.display_name.lower()
            
            counts[key] = done
            if done >= required and found: missing.remove(found)
                
            await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing, "attack_counts": counts}).eq("channel_id", message.channel.id).execute)

        try:
            reply = await message.reply(
                f"✅ **{message.author.display_name}**: {done}/{required} attacks recorded."
                + (" Staff: react ❌ to undo." if found and done >= required else ""),
                mention_author=False,
            )
        except discord.HTTPException as e:
            print(f"Could not reply to attack log in {message.channel.id}: {e}")
            return
        if found and done >= required:
            if len(self.done_replies) > 500: self.done_replies.pop(next(iter(self.done_replies)), None)
            self.done_replies[reply.id] = found["name"]
            try:
                await reply.add_reaction("❌")
            except discord.HTTPException as e:
                print(f"Could not add undo reaction in {message.channel.id}: {e}")

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        if payload.user_id == self.bot.user.id or str(payload.emoji) != "❌": return
        name = self.done_replies.get(payload.message_id)
        if not name: return
        guild = self.bot.get_guild(payload.guild_id)
        reactor = guild.get_member(payload.user_id) if guild else None
        if not reactor or not await is_staff_member(reactor): return

        async with self.locks[payload.channel_id]:
            war = await get_war(payload.channel_id)
            if not war or not war.get("is_active"): return
            missing = war.get("missing_list") or []
            counts = war.get("attack_counts") or {}
            if not any(m["name"].lower() == name.lower() for m in missing):
                missing.append({"name": name})
                counts[name.lower()] = 0
                await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing, "attack_counts": counts}).eq("channel_id", payload.channel_id).execute)
            
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
        embed.add_field(name="Public", value="`!war status` — live-style board with countdowns + ping schedule\n`!war missing list`\n`attacks done`", inline=False)
        if is_staff: embed.add_field(name="Staff", value="`!war defence ends <time>`\n`!war attack ends <time>`\n`!war cancel`\n`!war missing add|remove <name>`\n`!war absent add|remove <name>`\n`!war attacks <name> <count>`\n`!war check`\n`!war board` — live updating board\n`!war warning add @user <reason>`", inline=False)
        await ctx.send(embed=embed)

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
