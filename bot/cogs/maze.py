import discord
from discord.ext import commands
import re

class MazeTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="maze")
    @commands.guild_only()
    async def maze_group(self, ctx, action: str = None, *, args: str = None):
        if not action:
            return await ctx.send("Usage: `!maze ping <percentage>`")

        action = action.lower()

        if action == "ping":
            if not ctx.author.guild_permissions.administrator:
                return await ctx.send("❌ Only Admins can trigger maze pings.")
                
            if not args or not re.fullmatch(r"\d{1,3}\s?%", args.strip()):
                return await ctx.send("❌ Use a percentage, e.g. `!maze ping 20%`")

            embed = discord.Embed(
                title="🗺️ Maze Island Discount!",
                description=f"🚨 **{args.strip()} Discount is live right now!**\n\nSpend your Maze Coins!",
                color=discord.Color.purple()
            )
            
            await ctx.send(
                content="@everyone",
                embed=embed,
                allowed_mentions=discord.AllowedMentions(everyone=True)
            )

async def setup(bot):
    await bot.add_cog(MazeTracker(bot))
