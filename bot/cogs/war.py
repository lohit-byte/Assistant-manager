import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
import asyncio
from database import supabase

def parse_time(time_str):
    regex = re.compile(r'((?P<hours>\d+?)h)?((?P<minutes>\d+?)m)?')
    parts = regex.fullmatch(time_str.lower().replace(" ", ""))
    if not parts:
        return None
    time_params = {name: int(param) for name, param in parts.groupdict().items() if param}
    if not time_params:
        return None
    td = timedelta(**time_params)
    return td if td > timedelta(0) else None

class WarTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.timers = {}

    async def cog_load(self):
        self.bot.loop.create_task(self.restore_timers())

    async def restore_timers(self):
        await self.bot.wait_until_ready()
        try:
            res = await asyncio.to_thread(
                supabase.table("wars").select("*").eq("is_active", True).execute
            )
            for war in res.data:
                channel = self.bot.get_channel(war.get("channel_id"))
                if not channel or not war.get("phase_end"):
                    continue
                
                end = datetime.fromisoformat(war["phase_end"].replace("Z", "+00:00"))
                
                if end <= datetime.now(timezone.utc):
                    await asyncio.to_thread(supabase.table("wars").update({"is_active": False}).eq("guild_id", war["guild_id"]).execute)
                    continue

                self.timers[war["guild_id"]] = asyncio.create_task(
                    self.timer_countdown(war["guild_id"], channel, war["phase"], end)
                )
                print(f"Restored timer for guild {war['guild_id']} ending at {end}")
        except Exception as e:
            print(f"Error restoring timers: {e}")

    async def timer_countdown(self, guild_id, channel, phase, end_time):
        delay = (end_time - datetime.now(timezone.utc)).total_seconds()
        if delay > 0:
            await asyncio.sleep(delay)
        
        if phase in ("defence", "defense"):
            await channel.send("⚠️ **Defence Phase has ended!** Use `!war attack ends 24h`")
        else:
            await asyncio.to_thread(
                supabase.table("wars").update({"is_active": False}).eq("guild_id", guild_id).execute
            )
            await channel.send("🏁 **War has ended!** Use `!war report` to see who missed attacks.")
        
        self.timers.pop(guild_id, None)

    @commands.command(name="war")
    @commands.guild_only()
    async def war_group(self, ctx, action: str = None, subaction: str = None, *, args: str = None):
        if not action:
            return await ctx.send("Usage: `!war defence ends 24h` | `!war status` | `!war missing add Sam` | `!war report`")

        action = action.lower()

        if action == "status":
            return await self.show_status(ctx)

        if action == "report":
            return await self.war_report(ctx)

        if action == "missing":
            return await self.war_missing(ctx, subaction, args)

        if action in ["defence", "defense", "attack"]:
            perms = ctx.author.guild_permissions
            if not (perms.administrator or perms.manage_guild):
                return await ctx.send("❌ You must be an Admin or Staff to use this command.")
            
            if subaction != "ends" or not args:
                return await ctx.send(f"Usage: `!war {action} ends <time>` (e.g., `!war {action} ends 24h`)")
                
            await self.start_timer(ctx, action, args)
        else:
            await ctx.send("Unknown action.")

    async def start_timer(self, ctx, phase, time_str):
        td = parse_time(time_str)
        if not td:
            return await ctx.send("❌ Invalid time format. Use `24h`, `12h30m`, etc.")
        if td > timedelta(hours=24):
            return await ctx.send("❌ A single phase cannot exceed 24 hours.")

        now = datetime.now(timezone.utc)
        end_time = now + td

        war_data = {
            "guild_id": ctx.guild.id,
            "war_start": now.isoformat(),
            "phase": phase,
            "phase_end": end_time.isoformat(),
            "is_active": True,
            "channel_id": ctx.channel.id
        }
        
        try:
            await asyncio.to_thread(
                supabase.table("wars").upsert(war_data, on_conflict="guild_id").execute
            )
            
            embed = discord.Embed(
                title=f"⚔️ War {phase.capitalize()} Phase Started",
                description=f"The bot is now tracking the timer.\n**Ends:** <t:{int(end_time.timestamp())}:R>",
                color=discord.Color.blue()
            )
            await ctx.send(embed=embed)
            
            old = self.timers.pop(ctx.guild.id, None)
            if old:
                old.cancel()
                
            self.timers[ctx.guild.id] = asyncio.create_task(
                self.timer_countdown(ctx.guild.id, ctx.channel, phase, end_time)
            )

        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    async def show_status(self, ctx):
        try:
            response = await asyncio.to_thread(
                supabase.table("wars").select("*").eq("guild_id", ctx.guild.id).eq("is_active", True).execute
            )
            if not response.data:
                return await ctx.send("ℹ️ No active war is being tracked right now.")
                
            war = response.data[0]
            embed = discord.Embed(title="🛡️ Active War Status", color=discord.Color.gold())
            embed.add_field(name="Current Phase", value=war['phase'].capitalize(), inline=True)
            
            missing = war.get("missing_list") or []
            embed.add_field(name="Missing Attacks", value=str(len(missing)), inline=True)
            
            await ctx.send(embed=embed)
        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    async def war_missing(self, ctx, subaction, args):
        perms = ctx.author.guild_permissions
        if not (perms.administrator or perms.manage_guild):
            return await ctx.send("❌ You must be an Admin or Staff to manage the missing list.")

        if not subaction or subaction not in ["add", "remove", "list"]:
            return await ctx.send("Usage: `!war missing add <name>` | `!war missing remove <name>` | `!war missing list`")

        try:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("guild_id", ctx.guild.id).eq("is_active", True).execute)
            if not res.data:
                return await ctx.send("ℹ️ No active war found.")
            
            war = res.data[0]
            missing = war.get("missing_list") or []

            if subaction == "list":
                if not missing:
                    return await ctx.send("✅ The missing list is empty.")
                names = ", ".join([m["name"] for m in missing])
                return await ctx.send(f"⚠️ **Missing Attacks:** {names}")

            if not args:
                return await ctx.send("❌ Please provide a name.")

            name = args.strip().lower()
            
            if subaction == "add":
                if not any(m["name"].lower() == name for m in missing):
                    missing.append({"name": name})
                    await asyncio.to_thread(
                        supabase.table("wars").update({"missing_list": missing}).eq("guild_id", ctx.guild.id).execute
                    )
                await ctx.send(f"✅ Added `{name}` to the missing list.")
                
            elif subaction == "remove":
                missing = [m for m in missing if m["name"].lower() != name]
                await asyncio.to_thread(
                    supabase.table("wars").update({"missing_list": missing}).eq("guild_id", ctx.guild.id).execute
                )
                await ctx.send(f"✅ Removed `{name}` from the missing list.")

        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    async def war_report(self):
        try:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("guild_id", ctx.guild.id).execute)
            if not res.data:
                return await ctx.send("ℹ️ No war data found.")
            
            war = res.data[0]
            missing = war.get("missing_list") or []
            
            embed = discord.Embed(title="🏁 Final War Report", color=discord.Color.red())
            if missing:
                names = "\n".join([f"• {m['name']}" for m in missing])
                embed.add_field(name="❌ Missed Attacks", value=names, inline=False)
            else:
                embed.description = "✅ **Everyone completed their attacks!**"
            
            await asyncio.to_thread(supabase.table("wars").update({"missing_list": []}).eq("guild_id", ctx.guild.id).execute)
            await ctx.send(embed=embed)

        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
