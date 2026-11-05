import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
from database import supabase

def parse_time(time_str):
    """Parses strings like '24h', '1h30m' into a timedelta object."""
    regex = re.compile(r'((?P<hours>\d+?)h)?((?P<minutes>\d+?)m)?')
    parts = regex.match(time_str.lower())
    if not parts:
        return None
    parts = parts.groupdict()
    time_params = {}
    for name, param in parts.items():
        if param:
            time_params[name] = int(param)
    return timedelta(**time_params)

def is_staff():
    """Check if the user has the staff role set in the DB."""
    async def predicate(ctx):
        # For now, just checking if they have admin or manage server
        # Later, we will check their specific Staff Role from Supabase
        if ctx.author.guild_permissions.administrator or ctx.author.guild_permissions.manage_guild:
            return True
        await ctx.send("❌ You must be an Admin or Staff to use this command.")
        return False
    return commands.check(predicate)

class WarTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="war")
    async def war_group(self, ctx, action: str = None, *, args: str = None):
        """Main command for War. Usage: !war defence ends 24h"""
        if not action:
            return await ctx.send("Usage: `!war defence ends 24h` or `!war attack ends 12h` or `!war status`")

        action = action.lower()

        if action == "status":
            return await self.show_status(ctx)

        if action in ["defence", "defense", "attack"]:
            await self.start_timer(ctx, action, args)
        else:
            await ctx.send("Unknown action. Try `!war status`, `!war defence ends`, or `!war attack ends`.")

    @is_staff()
    async def start_timer(self, ctx, phase, args):
        if not args or not args.lower().startswith("ends"):
            return await ctx.send(f"Usage: `!war {phase} ends <time>` (e.g., `!war {phase} ends 24h`)")

        time_str = args.lower().replace("ends", "").strip()
        td = parse_time(time_str)

        if not td:
            return await ctx.send("❌ Invalid time format. Use `24h`, `12h30m`, etc.")

        if td > timedelta(hours=24):
            return await ctx.send("❌ A single phase cannot exceed 24 hours.")

        # Calculate timestamps
        now = datetime.now(timezone.utc)
        end_time = now + td

        # Save to Supabase (upsert means insert or update if exists)
        war_data = {
            "guild_id": ctx.guild.id,
            "war_start": now.isoformat(),
            "phase": phase,
            "is_active": True,
            "missing_list": []
        }
        
        try:
            supabase.table("wars").upsert(war_data).execute()
            
            embed = discord.Embed(
                title=f"⚔️ War {phase.capitalize()} Phase Started",
                description=f"The bot is now tracking the timer.\n**Ends:** <t:{int(end_time.timestamp())}:R>",
                color=discord.Color.blue()
            )
            await ctx.send(embed=embed)
            
            # Start the background countdown
            self.bot.loop.create_task(self.timer_countdown(ctx.channel, phase, end_time))

        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    async def timer_countdown(self, channel, phase, end_time):
        """Waits for the timer to finish, then alerts the channel."""
        import asyncio
        delay = (end_time - datetime.now(timezone.utc)).total_seconds()
        
        if delay > 0:
            await asyncio.sleep(delay)
            
        if phase in ["defence", "defense"]:
            await channel.send("⚠️ **Defence Phase has ended!** Attack phase has begun. (Use `!war attack ends 24h`)")
        else:
            await channel.send("🏁 **War has ended!** Use `!war report` to see who missed attacks.")

    async def show_status(self, ctx):
        # Fetch current war from Supabase
        response = supabase.table("wars").select("*").eq("guild_id", ctx.guild.id).eq("is_active", True).execute()
        
        if not response.data:
            return await ctx.send("ℹ️ No active war is being tracked right now.")
            
        war = response.data[0]
        embed = discord.Embed(title="🛡️ Active War Status", color=discord.Color.gold())
        embed.add_field(name="Current Phase", value=war['phase'].capitalize(), inline=True)
        
        # Parse the missing list (stored as JSON in DB)
        missing = war.get("missing_list", [])
        embed.add_field(name="Missing Attacks", value=str(len(missing)) if missing else "0", inline=True)
        
        await ctx.send(embed=embed)

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
