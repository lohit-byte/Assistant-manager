import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
import asyncio
from collections import defaultdict
from database import supabase, check_premium_status

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

def is_staff_member(m):
    p = m.guild_permissions
    return p.administrator or p.manage_guild

async def get_war(channel_id):
    res = await asyncio.to_thread(supabase.table("wars").select("*").eq("channel_id", channel_id).limit(1).execute)
    return res.data[0] if res.data else None

async def get_settings(guild_id):
    res = await asyncio.to_thread(supabase.table("war_settings").select("*").eq("guild_id", guild_id).limit(1).execute)
    return {"attacks_required": 6, "exempt_absent": True, **(res.data[0] if res.data else {})}

async def check_team_limit(guild_id):
    # Returns True if they can start a new team, False if they hit their limit
    res = await asyncio.to_thread(supabase.table("guilds").select("max_teams").eq("guild_id", guild_id).execute)
    max_teams = res.data[0].get("max_teams", 1) if res.data else 1
    
    # Count how many distinct channels are currently tracking a war
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
                    self.status_tasks[war["channel_id"]] = asyncio.create_task(
                        self.status_updater(war["channel_id"], channel)
                    )
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

        # Check Team Limits (Multi-Team Architecture)
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
                "channel_id": ctx.channel.id, # Now using channel ID
                "war_start": war_start.isoformat(),
                "phase": phase,
                "is_active": True,
                "status_message_id": None,
            }
            
            # Reset lists if starting a fresh war
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

    # ... [The rest of the file: show_help, build_status_embed, war_missing, etc. all need to replace `guild_id` with `channel_id` in DB queries, but keep `guild_id` for aliases/warnings]

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
