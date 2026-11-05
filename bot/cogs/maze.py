import discord
from discord.ext import commands

class MazeTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="maze")
    async def maze_group(self, ctx, action: str = None, args: str = None):
        """Usage: !maze ping 20%"""
        if not action:
            return await ctx.send("Usage: `!maze ping <percentage>`")

        action = action.lower()

        if action == "ping":
            if not ctx.author.guild_permissions.administrator:
                return await ctx.send("❌ Only Admins can trigger maze pings.")
                
            if not args:
                return await ctx.send("❌ Please provide a discount amount. (e.g., `!maze ping 20%`)")

            embed = discord.Embed(
                title="🗺️ Maze Island Discount!",
                description=f"🚨 **{args} Discount is live right now!**\n\nSpend your Maze Coins!",
                color=discord.Color.purple()
            )
            # Ping the role or everyone
            await ctx.send(content="@everyone", embed=embed)

async def setup(bot):
    await bot.add_cog(MazeTracker(bot))
