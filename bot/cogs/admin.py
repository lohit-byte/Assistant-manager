import discord
from discord.ext import commands
from database import supabase

class Admin(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="alias")
    async def alias_group(self, ctx, action: str = None, member: discord.Member = None, *, alias: str = None):
        """Usage: !alias add @user Sam"""
        if not ctx.author.guild_permissions.administrator:
            return await ctx.send("❌ Only Admins can manage aliases.")

        if action == "add":
            if not member or not alias:
                return await ctx.send("Usage: `!alias add @user <alias>`")
            
            # Save to Supabase
            supabase.table("aliases").upsert({
                "guild_id": ctx.guild.id,
                "discord_id": member.id,
                "alias_name": alias.lower()
            }).execute()
            
            await ctx.send(f"✅ Mapped alias `{alias}` to **{member.display_name}**.")

        elif action == "remove":
            if not alias:
                return await ctx.send("Usage: `!alias remove <alias>`")
                
            supabase.table("aliases").delete().eq("guild_id", ctx.guild.id).eq("alias_name", alias.lower()).execute()
            await ctx.send(f"✅ Removed alias `{alias}`.")
            
        else:
            await ctx.send("Usage: `!alias add @user <alias>` or `!alias remove <alias>`")

async def setup(bot):
    await bot.add_cog(Admin(bot))
