import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
import asyncio
from collections import defaultdict
from database import supabase, is_staff_member, ensure_user

DEFENCE = ("defence", "defense")
PHASE = timedelta(hours=24)
WAR = timedelta(hours=48)
DONE_RE = re.compile(r"\b(?:(\d+)\s+)?attacks?\s+done(?:\s+(\d+))?\b", re.I)

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
        self.end_reminded = set()

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
        if action in ("warning", "warn"): return await self.war_warning(ctx, subaction, args)
        if action == "attacks":
            # ``subaction`` swallows the first word (the player name); re-join it
            # with the rest so both "!war attacks Sam 6" and
            # "!war attacks Sam | 6" reach the parser intact.
            parts = [p for p in (subaction, args) if p]
            return await self.war_attacks(ctx, " ".join(parts))
        if action == "check": return await self.war_check(ctx)
        if action == "set":
            if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
            if subaction == "attacks" and args and args.strip().isdigit():
                await asyncio.to_thread(supabase.table("war_settings").upsert({"guild_id": ctx.guild.id, "attacks_required": int(args)}, on_conflict="guild_id").execute)
                return await ctx.send(f"✅ Required attacks updated to **{args.strip()}**.")
            return await ctx.send("Usage: `!war set attacks <number>`")
            
        if action in ("defence", "defense", "attack"):
            if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
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
                "status_message_id": None,
            }
            if not existing_war or not existing_war.get("is_active"):
                war_data["missing_list"] = []
                war_data["absent_list"] = []
                war_data["attack_counts"] = {}

            await asyncio.to_thread(supabase.table("wars").upsert(war_data, on_conflict="channel_id").execute)

            if ctx.channel.id in self.status_tasks: self.status_tasks[ctx.channel.id].cancel()
            self.end_reminded.discard(ctx.channel.id)
            self.status_tasks[ctx.channel.id] = asyncio.create_task(
                self.status_updater(ctx.channel.id, ctx.channel)
            )

            phase_end = war_start + PHASE if current_phase == "defence" else war_end
            embed = discord.Embed(title="✅ War tracking started", color=discord.Color.blue())
            embed.add_field(name="War clock", value=f"{fmt_td(war_end - now)} left (48h → 0h)", inline=True)
            embed.add_field(name=current_phase.title(), value=f"{fmt_td(phase_end - now)} left", inline=True)
            embed.add_field(name="Phase ends", value=f"<t:{int(phase_end.timestamp())}:R>", inline=True)
            embed.add_field(name="War ends", value=f"<t:{int(war_end.timestamp())}:R>", inline=True)
            embed.set_footer(text="Defence = 48h → 24h left · Attack = 24h → 0h left.")
            await ctx.send(embed=embed)
        except Exception as e:
            await ctx.send(f"❌ Error: {e}")

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
        """Watches one war and drives the defence -> attack -> ended timeline."""
        try:
            while True:
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

                stored = (war.get("phase") or "").lower()
                if current == "attack" and stored in DEFENCE:
                    await asyncio.to_thread(
                        supabase.table("wars").update({"phase": "attack"})
                        .eq("channel_id", channel_id).execute
                    )
                    await self.announce_attack(channel, start, war)

                war_end = start + WAR
                if channel_id not in self.end_reminded and 0 < (war_end - now).total_seconds() <= 3600:
                    self.end_reminded.add(channel_id)
                    await self.announce_war_ending(channel, war_end, war)

                await asyncio.sleep(30)
        except asyncio.CancelledError:
            pass

    async def announce_attack(self, channel, start, war):
        missing = war.get("missing_list") or []
        embed = discord.Embed(
            title="⚔️ Attack phase has begun!",
            color=discord.Color.red(),
            description=(
                f"Defence is over — the war clock is now {fmt_td(start + WAR - datetime.now(timezone.utc))} from 0h. "
                f"War ends <t:{int((start + WAR).timestamp())}:R>.\n"
                f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}\n\n"
                "Use `attacks done` after attacking, and `!war status` for the live board."
            ),
        )
        await self._send_ping(channel, "⚔️ **Attack phase started!**", embed)

    async def announce_war_ending(self, channel, war_end, war):
        missing = war.get("missing_list") or []
        embed = discord.Embed(
            title="⏰ 1 hour left in the war!",
            color=discord.Color.orange(),
            description=(
                f"War ends <t:{int(war_end.timestamp())}:R>.\n"
                f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}"
            ),
        )
        await self._send_ping(channel, "⏰ **One hour left in the war!**", embed)

    async def finish_war(self, channel_id, channel):
        task = self.status_tasks.pop(channel_id, None)
        if task and task is not asyncio.current_task():
            task.cancel()
        self.end_reminded.discard(channel_id)

        missing = []
        try:
            war = await get_war(channel_id)
            missing = war.get("missing_list") or [] if war else []
            await asyncio.to_thread(
                supabase.table("wars").update({"is_active": False, "phase": "ended"})
                .eq("channel_id", channel_id).execute
            )
            embed = discord.Embed(
                title="🏁 The War Has Ended!",
                description=(
                    f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}\n"
                    "Use `!war report` to view the final stats."
                ),
                color=discord.Color.red(),
            )
            await self._send_ping(channel, "🏁 **The war has ended!**", embed)
        except Exception as e:
            print(f"Could not finish war in {channel_id}: {e}")

    async def build_status_embed(self, channel_id):
        war = await get_war(channel_id)
        if not war or not war.get("is_active"):
            return discord.Embed(title="No Active War", color=discord.Color.light_grey())

        start = to_utc(war.get("war_start"))
        now = datetime.now(timezone.utc)
        missing, absent = war.get("missing_list") or [], war.get("absent_list") or []

        current = phase_at(start, now)
        if current == "unknown":
            return discord.Embed(title="No Active War", color=discord.Color.light_grey())

        if current == "ended":
            return discord.Embed(
                title="🏁 War finished",
                description=f"**Missing attacks ({len(missing)})**: {join_names(missing) or 'None'}",
                color=discord.Color.red(),
            )

        phase_start, phase_end = phase_bounds(start, current)
        elapsed = (now - phase_start).total_seconds()
        bar = progress_bar(elapsed, 86400)
        war_end = start + WAR

        # The in-game war clock runs 48h -> 0h: defence covers 48h -> 24h left,
        # attack covers 24h -> 0h left, and the war ends at 0h.
        war_left = fmt_td(war_end - now)
        phase_left = fmt_td(phase_end - now)
        label = "Defence" if current == "defence" else "Attack"
        color = discord.Color.blue() if current == "defence" else discord.Color.red()
        title = "🛡️ DEFENCE PHASE" if current == "defence" else "⚔️ ATTACK PHASE"

        embed = discord.Embed(
            title=title,
            color=color,
            description=(
                f"{bar}\n"
                f"**War clock:** {war_left} left (48h → 0h)\n"
                f"**{label}:** {phase_left} left\n"
                f"**Phase ends:** <t:{int(phase_end.timestamp())}:R> · "
                f"**War ends:** <t:{int(war_end.timestamp())}:R>"
            ),
        )

        embed.add_field(name=f"⚠️ Missing ({len(missing)})", value=join_names(missing) or "None", inline=False)
        embed.add_field(name=f"🏖️ Excused ({len(absent)})", value=join_names(absent) or "None", inline=False)
        return embed

    async def show_status(self, ctx):
        await ctx.send(embed=await self.build_status_embed(ctx.channel.id))

    async def cancel_war(self, ctx):
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
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
        if sub != "list" and not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
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
                if any(a["name"].lower() == name for a in absent): return await ctx.send(f"🏖️ `{name}` is excused.")
                if not any(m["name"].lower() == name for m in missing):
                    missing.append({"name": name})
                    await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
                await ctx.send(f"✅ Added `{name}` to missing.")
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
        if sub != "list" and not is_staff_member(ctx.author):
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
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        args = (args or "").strip()
        if not args: return await ctx.send("Usage: `!war attacks <name> <count>`")
        if "|" in args:
            name_part, count_part = args.split("|", 1)
            name, count = name_part.strip().lower(), count_part.strip()
        else:
            parts = args.rsplit(maxsplit=1)
            if len(parts) != 2: return await ctx.send("Usage: `!war attacks <name> <count>` (or `name | count`)")
            name, count = parts[0].strip().lower(), parts[1].strip()
        if not name: return await ctx.send("Usage: `!war attacks <name> <count>` (or `name | count`)")
        if not count.isdigit(): return await ctx.send("❌ Count must be a number.")
        cfg = await get_settings(ctx.guild.id)
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            counts = war.get("attack_counts") or {}
            counts[name] = int(count)
            missing = war.get("missing_list") or []
            if int(count) >= cfg["attacks_required"]:
                missing = [m for m in missing if m["name"].lower() != name]
            await asyncio.to_thread(supabase.table("wars").update({"attack_counts": counts, "missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
        await ctx.send(f"✅ `{name}`: {count}/{cfg['attacks_required']} attacks.")

    async def war_check(self, ctx):
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
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
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
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
            await reply.add_reaction("❌")

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        if payload.user_id == self.bot.user.id or str(payload.emoji) != "❌": return
        name = self.done_replies.get(payload.message_id)
        if not name: return
        guild = self.bot.get_guild(payload.guild_id)
        reactor = guild.get_member(payload.user_id) if guild else None
        if not reactor or not is_staff_member(reactor): return

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
        is_staff = is_staff_member(ctx.author)
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
        embed.add_field(name="Public", value="`!war status`\n`!war missing list`\n`attacks done`", inline=False)
        if is_staff: embed.add_field(name="Staff", value="`!war defence ends <time>`\n`!war attack ends <time>`\n`!war cancel`\n`!war missing add|remove <name>`\n`!war absent add|remove <name>`\n`!war attacks <name> <count>`\n`!war check`\n`!war warning add @user <reason>`", inline=False)
        await ctx.send(embed=embed)

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
