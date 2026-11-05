import discord
from discord.ext import commands
import re
import asyncio
from datetime import datetime, timedelta, timezone
from database import supabase

# --- ML GUIDES DISCOUNT SCHEDULES ---
SCHEDULE_7D = [
    (6 * 24 + 22, 0, "20%"), (5 * 24 + 19, 0, "10%"), (5 * 24 + 0, 0, "30%"),
    (4 * 24 + 17, 0, "10%"), (4 * 24 + 1, 0, "10%"), (3 * 24 + 6, 0, "10%"),
    (1 * 24 + 9, 0, "10%"), (0 * 24 + 1, 0, "20%"),
]
SCHEDULE_3D = [
    (2 * 24 + 23, 0, "30%"), (1 * 24 + 23, 0, "20%"),
    (1 * 24 + 11, 0, "10%"), (0 * 24 + 11, 0, "10%"),
]

def to_utc(s: str) -> datetime:
    if not s: return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

class MazeTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.timers = {}

    async def cog_load(self):
        self.bot.loop.create_task(self.restore_schedules())

    def cog_unload(self):
        for tasks in self.timers.values():
            for t in tasks: t.cancel()

    async def restore_schedules(self):
        await self.bot.wait_until_ready()
        try:
            res = await asyncio.to_thread(supabase.table("maze_schedules").select("*").execute)
            now = datetime.now(timezone.utc)
            
            for row in res.data:
                try:
                    channel = self.bot.get_channel(row.get("channel_id"))
                    end_time = to_utc(row.get("event_end"))
                    start_time = to_utc(row.get("event_start"))
                    
                    if not channel or not end_time or end_time <= now:
                        continue
                        
                    self.schedule_pings(row["guild_id"], channel, row.get("maze_type", "7d"), end_time, start_time)
                except Exception as e:
                    print(f"Error restoring maze schedule for {row.get('guild_id')}: {e}")
        except Exception as e:
            print(f"Failed to fetch maze schedules: {e}")

    def schedule_pings(self, guild_id, channel, maze_type, end_time, start_time):
        if guild_id in self.timers:
            for t in self.timers[guild_id]: t.cancel()
        
        self.timers[guild_id] = []
        schedule = SCHEDULE_7D if maze_type == "7d" else SCHEDULE_3D
        now = datetime.now(timezone.utc)
        
        for hours, minutes, pct in schedule:
            discount_time = end_time - timedelta(hours=hours, minutes=minutes)
            delay = (discount_time - now).total_seconds()
            
            # If delay is positive, schedule it in the future.
            # If delay is negative, but happened in the last 5 mins, send it now (grace period).
            if delay > 0:
                self.timers[guild_id].append(
                    asyncio.create_task(self.ping_discount_at_time(guild_id, channel, pct, delay))
                )
            elif -300 < delay <= 0:
                self.timers[guild_id].append(
                    asyncio.create_task(self.ping_discount_at_time(guild_id, channel, pct, 0))
                )

    async def ping_discount_at_time(self, guild_id, channel, pct, delay):
        if delay > 0: 
            await asyncio.sleep(delay)
            
        # Check if pings are enabled globally for this server
        try:
            res = await asyncio.to_thread(supabase.table("maze_schedules").select("ping_enabled_global").eq("guild_id", guild_id).execute)
            if not res.data or not res.data[0].get("ping_enabled_global", True):
                return
        except Exception as e:
            print(f"Failed to check ping_enabled_global: {e}")
            return

        embed = discord.Embed(
            title="🗺️ Maze Island Discount!",
            description=f"🚨 **{pct} Discount is live right now!**\n\nSpend your Maze Coins!",
            color=discord.Color.purple()
        )
        
        try:
            if channel.permissions_for(channel.guild.me).mention_everyone:
                await channel.send(content="@everyone", embed=embed, allowed_mentions=discord.AllowedMentions(everyone=True))
            else:
                await channel.send(embed=embed)
        except discord.HTTPException as e:
            print(f"Maze ping failed in {guild_id}: {e}")

    @commands.command(name="maze")
    @commands.guild_only()
    async def maze_group(self, ctx, action: str = None, arg1: str = None, *, arg2: str = None):
        action = (action or "").lower()
        if not action:
            return await ctx.send("Usage: `!maze help`, `!maze start`, `!maze status`, or `!maze ping 20%`")

        perms = ctx.author.guild_permissions
        if not (perms.administrator or perms.manage_guild):
            return await ctx.send("❌ You must be an Admin or Staff to use Maze commands.")

        # --- STATUS ---
        if action == "status":
            try:
                res = await asyncio.to_thread(supabase.table("maze_schedules").select("*").eq("guild_id", ctx.guild.id).execute)
                if not res.data: return await ctx.send("ℹ️ No Maze event scheduled.")
                
                row = res.data[0]
                start = to_utc(row["event_start"])
                end = to_utc(row["event_end"])
                
                embed = discord.Embed(title="🗺️ Maze Event Status", color=discord.Color.purple())
                embed.add_field(name="Type", value=row.get("maze_type", "7d").upper(), inline=True)
                embed.add_field(name="Starts", value=f"<t:{int(start.timestamp())}:F>", inline=True)
                embed.add_field(name="Ends", value=f"<t:{int(end.timestamp())}:F>", inline=True)
                embed.add_field(name="Pings Enabled", value=str(row.get("ping_enabled_global", True)), inline=True)
                await ctx.send(embed=embed)
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")

        # --- STOP ---
        elif action in ("stop", "cancel", "clear"):
            try:
                await asyncio.to_thread(supabase.table("maze_schedules").delete().eq("guild_id", ctx.guild.id).execute)
                if ctx.guild.id in self.timers:
                    for t in self.timers[ctx.guild.id]: t.cancel()
                    del self.timers[ctx.guild.id]
                await ctx.send("🛑 Maze schedule and all pending discount pings have been cancelled.")
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")

        # --- START ---
        elif action == "start":
            duration = (arg1 or "").lower()
            time_input = (arg2 or "").strip()

            if duration not in ("3d", "7d") or not time_input:
                return await ctx.send("❌ Usage: `!maze start <3d|7d> <time>`\n*Time can be remaining time (`6d12h`) or a date (`05/11`).*")

            now = datetime.now(timezone.utc)
            
            if "d" in time_input or "h" in time_input:
                # REMAINING TIME
                regex = re.compile(r'((?P<days>\d+?)d)?((?P<hours>\d+?)h)?')
                parts = regex.fullmatch(time_input.lower().replace(" ", ""))
                if not parts: return await ctx.send("❌ Invalid time format. Use `6d12h`.")
                
                td_args = {k: int(v) for k, v in parts.groupdict().items() if v}
                end_time = now + timedelta(**td_args)
                days = 3 if duration == "3d" else 7
                start_time = end_time - timedelta(days=days)
            else:
                # ABSOLUTE DATE (11:00 UTC)
                try:
                    start_time = datetime.strptime(f"{time_input}/{now.year}", "%d/%m/%Y").replace(hour=11, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
                    if start_time + timedelta(days=(3 if duration == "3d" else 7)) < now:
                        start_time = start_time.replace(year=now.year + 1)
                    days = 3 if duration == "3d" else 7
                    end_time = start_time + timedelta(days=days)
                except ValueError:
                    return await ctx.send("❌ Invalid date format. Use `DD/MM` (e.g., `05/11`).")

            try:
                await asyncio.to_thread(
                    supabase.table("maze_schedules").upsert({
                        "guild_id": ctx.guild.id,
                        "event_start": start_time.isoformat(),
                        "event_end": end_time.isoformat(),
                        "maze_type": duration,
                        "channel_id": ctx.channel.id,
                        "ping_enabled_global": True
                    }, on_conflict="guild_id").execute
                )
            except Exception as e:
                return await ctx.send(f"❌ Database error: {e}")

            self.schedule_pings(ctx.guild.id, ctx.channel, duration, end_time, start_time)

            embed = discord.Embed(title="🗺️ Maze Event Scheduled", color=discord.Color.purple())
            embed.add_field(name="Duration", value=f"{duration.upper()}", inline=True)
            embed.add_field(name="Starts", value=f"<t:{int(start_time.timestamp())}:F>", inline=True)
            embed.add_field(name="Ends", value=f"<t:{int(end_time.timestamp())}:F>", inline=True)
            await ctx.send(embed=embed)

        # --- PING ---
        elif action == "ping":
            raw = (arg1 or "") + (arg2 or "")
            m = re.fullmatch(r"(\d{1,3})%", raw)
            
            if not m or not (1 <= int(m.group(1)) <= 100):
                return await ctx.send("❌ Use a percentage from 1–100, e.g. `!maze ping 20%`")

            embed = discord.Embed(
                title="🗺️ Maze Island Discount!",
                description=f"🚨 **{m.group(1)}% Discount is live right now!**\n\nSpend your Maze Coins!",
                color=discord.Color.purple()
            )
            await ctx.send(content="@everyone", embed=embed, allowed_mentions=discord.AllowedMentions(everyone=True))
            
        else:
            await ctx.send("❌ Unknown action. Use `start`, `status`, `stop`, or `ping`.")

async def setup(bot):
    await bot.add_cog(MazeTracker(bot))
