import discord
from discord.ext import commands
from database import supabase
import asyncio

class Admin(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="alias")
    @commands.guild_only()
    async def alias_group(self, ctx, action: str = None, *, args: str = None):
        """Manage player aliases. Usage: !alias add @user Sam or !alias remove Sam"""
        if not ctx.author.guild_permissions.administrator:
            return await ctx.send("❌ Only Admins can manage aliases.")

        if not action or not args:
            return await ctx.send("Usage: `!alias add @user <alias>` or `!alias remove <alias>`")

        if action.lower() == "add":
            if not ctx.message.mentions:
                return await ctx.send("❌ You must mention the user. Usage: `!alias add @user <alias>`")
            
            member = ctx.message.mentions[0]
            alias_name = args.replace(member.mention, "").replace(f"<@!{member.id}>", "").strip().lower()
            
            if not alias_name:
                return await ctx.send("❌ Please provide an alias name.")

            try:
                await asyncio.to_thread(
                    supabase.table("aliases").upsert(
                        {
                            "guild_id": ctx.guild.id,
                            "discord_id": member.id,
                            "alias_name": alias_name
                        },
                        on_conflict="guild_id,alias_name"
                    ).execute
                )
                await ctx.send(f"✅ Mapped alias `{alias_name}` to **{member.display_name}**.")
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")

        elif action.lower() == "remove":
            alias_name = args.strip().lower()
            try:
                await asyncio.to_thread(
                    supabase.table("aliases").delete()
                    .eq("guild_id", ctx.guild.id)
                    .eq("alias_name", alias_name)
                    .execute
                )
                await ctx.send(f"✅ Removed alias `{alias_name}`.")
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")
        else:
            await ctx.send("Usage: `!alias add @user <alias>` or `!alias remove <alias>`")

async def setup(bot):
    await bot.add_cog(Admin(bot))
