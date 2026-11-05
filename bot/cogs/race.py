import discord
from discord.ext import commands
from database import supabase

class RaceTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="race")
    async def race_group(self, ctx, action: str = None, *, args: str = None):
        """Main command for Race. Usage: !race status or !race target 20"""
        if not action:
            return await ctx.send("Usage: `!race status` or `!race target <laps>`")

        action = action.lower()

        if action == "status":
            # Fetch race data from Supabase
            response = supabase.table("race_state").select("*").eq("guild_id", ctx.guild.id).execute()
            
            if not response.data:
                return await ctx.send("ℹ️ No active race data. Setup targets via the Dashboard.")
                
            race = response.data[0]
            embed = discord.Embed(title="🏁 Race Status", color=discord.Color.green())
            embed.add_field(name="Target Laps", value=str(race.get('target_laps', 0)), inline=True)
            embed.add_field(name="Current Lap", value=str(race.get('current_lap', 0)), inline=True)
            embed.add_field(name="Current Node", value=str(race.get('current_node', 0)), inline=True)
            embed.add_field(name="Task Description", value=race.get('task_description', 'None'), inline=False)
            
            await ctx.send(embed=embed)

        elif action == "target":
            if not ctx.author.guild_permissions.administrator:
                return await ctx.send("❌ Only Admins can set race targets.")
            
            if not args or not args.isdigit():
                return await ctx.send("❌ Please provide a number. (e.g., `!race target 20`)")
                
            # Upsert target into database
            supabase.table("race_state").upsert({
                "guild_id": ctx.guild.id,
                "target_laps": int(args)
            }).execute()
            
            await ctx.send(f"✅ Race target updated to **{args}** laps!")

async def setup(bot):
    await bot.add_cog(RaceTracker(bot))
