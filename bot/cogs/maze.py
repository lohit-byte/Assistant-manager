import discord
from discord.ext import commands
import re
from datetime import datetime, timedelta, timezone
from database import supabase
import asyncio

def parse_start_date(date_str: str, days: int) -> datetime:
    now = datetime.now(timezone.utc)
    for year in range(now.year, now.year + 5):
        try:
            start = datetime.strptime(f"{date_str}/{year}", "%d/%m/%Y").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if start + timedelta(days=days) >= now:
            return start
    raise ValueError("Invalid date. Use DD/MM (e.g., 05/11).")

def to_utc(s: str) -> datetime:
    """Helper to ensure Supabase dates are timezone-aware, even if they lack a 'Z'."""
    if not s:
        return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

class MazeTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.last_ping = {} # Tracks cooldowns per guild

    @commands.command(name="maze")
    @commands.guild_only()
    async def maze_group(self, ctx, action: str = None, arg1: str = None, arg2: str = None):
        if not action:
            return await ctx.send("Usage: `!maze start 7d 05/11` or `!maze ping 20%`")

        # --- CONSISTENT PERMISSIONS (Admin OR Manage Server) ---
        perms = ctx.author.guild_permissions
        if not (perms.administrator or perms.manage_guild):
            return await ctx.send("❌ You must be an Admin or Staff to use Maze commands.")

        action = action.lower()

        # --- START EVENT COMMAND ---
        if action == "start":
            duration, date_str = arg1, arg2
                
            if not duration or not date_str:
                return await ctx.send("❌ Usage: `!maze start 7d 05/11` (Format: <duration> <DD/MM>)")
                
            duration = duration.lower()
            if duration not in ["3d", "7d"]:
                return await ctx.send("❌ Duration must be `3d` or `7d`.")

            days = 3 if duration == "3d" else 7

            try:
                start_date = parse_start_date(date_str, days)
            except ValueError as e:
                return await ctx.send(f"❌ {e}")
                
            end_date = start_date + timedelta(days=days)

            maze_data = {
                "guild_id": ctx.guild.id,
                "event_start": start_date.isoformat(),
                "event_end": end_date.isoformat(),
            }
            
            try:
                await asyncio.to_thread(
                    supabase.table("maze_schedules").upsert(maze_data, on_conflict="guild_id").execute
                )
            except Exception as e:
                return await ctx.send(f"❌ Database error: {e}")

            embed = discord.Embed(title="🗺️ Maze Event Scheduled", color=discord.Color.purple())
            embed.add_field(name="Duration", value=f"{duration.upper()}", inline=True)
            embed.add_field(name="Starts", value=f"<t:{int(start_date.timestamp())}:F>", inline=True)
            embed.add_field(name="Ends", value=f"<t:{int(end_date.timestamp())}:F>", inline=True)
            embed.set_footer(text="Rendered in your local time. Based on 00:00 UTC.")
            
            await ctx.send(embed=embed)

        # --- PING COMMAND ---
        elif action == "ping":
            # 1. Rate Limit Check (5 minutes)
            now = datetime.now(timezone.utc)
            last = self.last_ping.get(ctx.guild.id)
            if last and (now - last).total_seconds() < 300:
                return await ctx.send("⏳ A ping was already sent in the last 5 minutes.")

            # 2. Parse Percentage
            raw = (arg1 or "") + (arg2 or "") 
            m = re.fullmatch(r"(\d{1,3})%", raw)
            
            if not m or not (1 <= int(m.group(1)) <= 100):
                return await ctx.send("❌ Use a percentage from 1–100, e.g. `!maze ping 20%`")
                
            pct = f"{int(m.group(1))}%"

            # 3. Event Validation
            try:
                res = await asyncio.to_thread(
                    supabase.table("maze_schedules")
                    .select("event_start,event_end,ping_enabled_global")
                    .eq("guild_id", ctx.guild.id).execute
                )
                
                if not res.data:
                    return await ctx.send("❌ No Maze event scheduled. Use `!maze start` first.")
                    
                row = res.data[0]
                start = to_utc(row.get("event_start"))
                end = to_utc(row.get("event_end"))
                
                if not row.get("ping_enabled_global", True):
                    return await ctx.send("❌ Maze pings are disabled globally via the dashboard.")
                    
                if not (start and end and start <= now <= end):
                    return await ctx.send("❌ No active Maze event right now. The scheduled event has not started or has already ended.")

            except Exception as e:
                return await ctx.send(f"❌ Database error: {e}")

            # 4. Check @everyone Permission
            if not ctx.channel.permissions_for(ctx.guild.me).mention_everyone:
                await ctx.send("⚠️ **Warning:** I lack the 'Mention @everyone' permission in this channel. The message will send, but nobody will be notified.")

            # 5. Send the ping and update cooldown
            embed = discord.Embed(
                title="🗺️ Maze Island Discount!",
                description=f"🚨 **{pct} Discount is live right now!**\n\nSpend your Maze Coins!",
                color=discord.Color.purple()
            )
            
            await ctx.send(
                content="@everyone",
                embed=embed,
                allowed_mentions=discord.AllowedMentions(everyone=True)
            )
            
            self.last_ping[ctx.guild.id] = now

        else:
            await ctx.send("❌ Unknown action. Use `!maze start` or `!maze ping`.")

async def setup(bot):
    await bot.add_cog(MazeTracker(bot))
