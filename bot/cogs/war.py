import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
import asyncio
from collections import defaultdict
from database import supabase, check_premium_status, is_staff_member

DEFENCE = ("defence", "defense")
PHASE = timedelta(hours=24)
WAR = timedelta(hours=48)
DONE_RE = re.compile(r"\battacks?\s+done(?:\s+(\d+))?", re.I)

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
    return {"attacks_required": 6, "exempt_absent": True, **(res.data[0] if res.data else {})}

async def check_team_limit(guild_id):
    res = await asyncio.to_thread(supabase.table("guilds").select("max_teams").eq("guild_id", guild_id).execute)
    max_teams = res.data[0].get("max_teams", 1) if res.data else 1
    active = await asyncio.to_thread(supabase.table("wars").select("channel_id").eq("guild_id", guild_id).eq("is_active", True).execute)
    return len(active.data) < max_teams

class WarTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.status_tasks = {}
        self.ping_tasks = {}
        self.done_replies = {}  
        self.locks = defaultdict(asyncio.Lock)

    async def cog_load(self):
        self.bot.loop.create_task(self.restore_events())

    def cog_unload(self):
        for t in [*self.status_tasks.values(), *self.ping_tasks.values()]:
            t.cancel()

    async def restore_events(self):
        await self.bot.wait_until_ready()
        try:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("is_active", True).execute)
            for war in res.data:
                if not war.get("war_start") or war.get("phase") == "ended": continue
                guild = self.bot.get_guild(war["guild_id"])
                channel = self.bot.get_channel(war.get("channel_id"))
                if not guild or not channel: continue
                
                start = to_utc(war["war_start"])
                now = datetime.now(timezone.utc)
                end = start + timedelta(hours=24 if war["phase"] in DEFENCE else 48)
                
                if end > now:
                    self.status_tasks[war["channel_id"]] = asyncio.create_task(self.status_updater(war["channel_id"], channel))
                elif war["phase"] in DEFENCE:
                    await asyncio.to_thread(supabase.table("wars").update({"phase": "attack"}).eq("channel_id", war["channel_id"]).execute)
                    attack_end = start + timedelta(hours=48)
                    if attack_end > now:
                        self.status_tasks[war["channel_id"]] = asyncio.create_task(self.status_updater(war["channel_id"], channel))
                    else:
                        await self.finish_war(war["channel_id"], channel)
                else:
                    await self.finish_war(war["channel_id"], channel)
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
        if action == "attacks": return await self.war_attacks(ctx, args)
        if action == "check": return await self.war_check(ctx)
        if action == "set":
            if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
            if subaction == "attacks" and args and args.isdigit():
                await asyncio.to_thread(supabase.table("war_settings").upsert({"guild_id": ctx.guild.id, "attacks_required": int(args)}, on_conflict="guild_id").execute)
                return await ctx.send(f"✅ Required attacks updated to **{args}**.")
            return await ctx.send("Usage: `!war set attacks <number>`")
            
        if action in ("defence", "defense", "attack"):
            if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
            if subaction != "ends" or not args: return await ctx.send(f"Usage: `!war {action} ends <time>`")
            await self.start_timer(ctx, action, args)

    async def start_timer(self, ctx, phase, time_str):
        td = parse_time(time_str)
        if not td: return await ctx.send("❌ Invalid time. Use `24h`.")
        if td > timedelta(hours=24): return await ctx.send("❌ Phase cannot exceed 24 hours.")

        existing_war = await get_war(ctx.channel.id)
        if not existing_war or not existing_war.get("is_active"):
            if not await check_team_limit(ctx.guild.id):
                return await ctx.send("❌ **Team limit reached!** Your server's plan only allows a certain number of active teams. Upgrade on the dashboard to add more.")

        now = ctx.message.created_at 
        end_time = now + td
        war_start = end_time - timedelta(hours=24 if phase in DEFENCE else 48)

        try:
            war_data = {
                "guild_id": ctx.guild.id,
                "channel_id": ctx.channel.id, 
                "war_start": war_start.isoformat(),
                "phase": phase,
                "is_active": True,
                "status_message_id": None,
            }
            if not existing_war or not existing_war.get("is_active"):
                war_data["missing_list"] = []
                war_data["absent_list"] = []
                war_data["attack_counts"] = {}

            await asyncio.to_thread(supabase.table("wars").upsert(war_data, on_conflict="channel_id").execute)
            
            if ctx.channel.id in self.status_tasks: self.status_tasks[ctx.channel.id].cancel()
            
            self.status_tasks[ctx.channel.id] = asyncio.create_task(
                self.status_updater(ctx.channel.id, ctx.channel)
            )
            await ctx.send(f"✅ War timer started for this channel. Check the live status embed below.")
        except Exception as e:
            await ctx.send(f"❌ Error: {e}")

    async def status_updater(self, channel_id, channel):
        try:
            while True:
                war = await get_war(channel_id)
                if not war or not war.get("is_active"): return
                start = to_utc(war["war_start"])
                if datetime.now(timezone.utc) >= start + WAR:
                    await self.finish_war(channel_id, channel)
                    return
                # Just purely loop for now, the actual embed is sent on demand via !war status
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            pass

    async def finish_war(self, channel_id, channel):
        task = self.status_tasks.pop(channel_id, None)
        if task: task.cancel()
        try:
            await asyncio.to_thread(supabase.table("wars").update({"is_active": False, "phase": "ended"}).eq("channel_id", channel_id).execute)
            await channel.send(embed=discord.Embed(title="🏁 The War Has Ended!", description="Use `!war report` to view final stats.", color=discord.Color.red()))
        except Exception: pass

    async def build_status_embed(self, channel_id):
        war = await get_war(channel_id)
        if not war or not war.get("is_active"): return discord.Embed(title="No Active War", color=discord.Color.light_grey())
        
        start = to_utc(war["war_start"])
        now = datetime.now(timezone.utc)
        missing, absent = war.get("missing_list") or [], war.get("absent_list") or []
        
        if war["phase"] in DEFENCE:
            end = start + timedelta(hours=24)
            bar = progress_bar((now - start).total_seconds(), 86400)
            embed = discord.Embed(title="🛡️ DEFENCE PHASE", color=discord.Color.blue(), description=f"{bar}\n**Time left:** {fmt_td(end - now)}\n**Ends:** <t:{int(end.timestamp())}:R>")
        else:
            end = start + timedelta(hours=48)
            bar = progress_bar((now - (start + timedelta(hours=24))).total_seconds(), 86400)
            embed = discord.Embed(title="⚔️ ATTACK PHASE", color=discord.Color.red(), description=f"{bar}\n**Time left:** {fmt_td(end - now)}\n**Ends:** <t:{int(end.timestamp())}:R>")
            
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

    async def war_missing(self, ctx, subaction, args):
        sub = (subaction or "list").lower()
        if sub != "list" and not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            missing, absent = war.get("missing_list") or [], war.get("absent_list") or []
            if sub == "list":
                if not missing: return await ctx.send("✅ The missing list is empty.")
                return await ctx.send("⚠️ **Missing:** " + join_names(missing))
            if not args: return await ctx.send("❌ Provide a name.")
            name = args.strip().lower()
            if sub == "add":
                if any(a["name"].lower() == name for a in absent): return await ctx.send(f"🏖️ `{name}` is excused.")
                if not any(m["name"].lower() == name for m in missing):
                    missing.append({"name": name})
                    await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
                await ctx.send(f"✅ Added `{name}` to missing.")
            else:
                missing = [m for m in missing if m["name"].lower() != name]
                await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
                await ctx.send(f"✅ Removed `{name}` from missing.")

    async def war_absent(self, ctx, subaction, args):
        sub = (subaction or "list").lower()
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        args = (args or "").strip()
        async with self.locks[ctx.channel.id]:
            war = await get_war(ctx.channel.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            absent, missing = war.get("absent_list") or [], war.get("missing_list") or []
            if sub == "list":
                if not absent: return await ctx.send("✅ The excused list is empty.")
                return await ctx.send("🏖️ **Excused:** " + join_names(absent))
            if not args: return await ctx.send("❌ Provide a name.")
            name = args.lower()
            if sub == "add":
                if not any(a["name"].lower() == name for a in absent):
                    absent.append({"name": name})
                    missing = [m for m in missing if m["name"].lower() != name]
                    await asyncio.to_thread(supabase.table("wars").update({"absent_list": absent, "missing_list": missing}).eq("channel_id", ctx.channel.id).execute)
                await ctx.send(f"🏖️ Added `{name}` to excused.")
            else:
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
        counts = {k.lower(): int(v) for k, v in (war.get("attack_counts") or {}).items()}
        absent = {a["name"].lower() for a in war.get("absent_list") or []}
        missing = {m["name"].lower() for m in war.get("missing_list") or []}
        names = set(counts) | missing 
        short = sorted(((n, counts.get(n, 0)) for n in names if not (cfg["exempt_absent"] and n in absent) and counts.get(n, 0) < required), key=lambda x: (x[1], x[0]))
        embed = discord.Embed(title=f"📋 Below {required} attacks", color=discord.Color.orange())
        if short: embed.description = "\n".join(f"• {n} — {c}/{required}" for n, c in short)
        else: embed.description = "✅ Everyone met the requirement."
        await ctx.send(embed=embed)

    async def warning_dispatch(self, ctx, action, target, reason):
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        action = (action or "").lower()
        if action not in ("add", "list", "remove") or not target: return await ctx.send("Usage: `!warning add|list|remove`")
        try:
            if action == "remove":
                res = await asyncio.to_thread(supabase.table("warnings").delete().eq("id", int(target)).eq("guild_id", ctx.guild.id).execute)
                return await ctx.send("✅ Warning removed." if res.data else "❌ Not found.")
            member = await commands.MemberConverter().convert(ctx, target)
            if action == "add":
                await asyncio.to_thread(supabase.table("warnings").insert({"guild_id": ctx.guild.id, "discord_id": member.id, "reason": reason or "No reason", "issued_by": ctx.author.id}).execute)
                await ctx.send(f"📌 **{member.display_name}** has been warned.")
            else:
                res = await asyncio.to_thread(supabase.table("warnings").select("*").eq("guild_id", ctx.guild.id).eq("discord_id", member.id).order("created_at", desc=True).limit(10).execute)
                if not res.data: return await ctx.send(f"✅ **{member.display_name}** has no warnings.")
                embed = discord.Embed(title=f"Warnings for {member.display_name}", color=discord.Color.red())
                for w in res.data: embed.add_field(name=f"ID {w['id']}", value=w['reason'], inline=False)
                await ctx.send(embed=embed)
        except Exception as e: await ctx.send(f"❌ Error: {e}")

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
            done = int(m.group(1)) if m.group(1) else required
            key = found["name"].lower() if found else message.author.display_name.lower()
            
            counts[key] = done
            if done >= required and found: missing.remove(found)
                
            await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing, "attack_counts": counts}).eq("channel_id", message.channel.id).execute)

        reply = await message.reply(f"✅ **{message.author.display_name}**: {done}/{required} attacks recorded." + (" Staff: react ❌ to undo." if found and done >= required else ""), mention_author=False)
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
        embed.add_field(name="Public", value="`!war status`\n`!war missing list`\n`attacks done`", inline=False)
        if is_staff: embed.add_field(name="Staff", value="`!war defence ends <time>`\n`!war attack ends <time>`\n`!war cancel`\n`!war missing add|remove <name>`\n`!war absent add|remove <name>`\n`!war attacks <name> | <count>`\n`!war check`\n`!war warning`", inline=False)
        await ctx.send(embed=embed)

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
