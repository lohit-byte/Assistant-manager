import discord
from discord.ext import commands
from database import supabase, is_staff_member
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

    @commands.command(name="ids")
    @commands.guild_only()
    async def ids_command(self, ctx, *, query: str = None):
        """Staff: show IDs. Usage: !ids | !ids roles | !ids members [search] | !ids @user"""
        if not is_staff_member(ctx.author):
            return await ctx.send("❌ Staff only.")

        q = (query or "").strip()
        guild = ctx.guild

        # !ids @user
        if ctx.message.mentions:
            m = ctx.message.mentions[0]
            roles = ", ".join(f"{r.name} (`{r.id}`)" for r in reversed(m.roles) if r != guild.default_role) or "None"
            e = discord.Embed(title=f"🪪 {m.display_name}", color=discord.Color.teal())
            e.add_field(name="User ID", value=f"`{m.id}`", inline=False)
            e.add_field(name="Roles", value=roles[:1024], inline=False)
            return await ctx.send(embed=e)

        # !ids roles
        if q.lower() == "roles":
            lines = [f"{r.name} — `{r.id}`" for r in reversed(guild.roles) if r != guild.default_role]
            return await self._send_pages(ctx, "🎭 Role IDs", lines)

        # !ids members [search]
        if q.lower().startswith("members"):
            search = q[7:].strip().lower()
            members = [m for m in guild.members if not m.bot and (not search or search in m.display_name.lower() or search in m.name.lower())]
            members.sort(key=lambda m: m.display_name.lower())
            lines = [f"{m.display_name} — `{m.id}`" for m in members]
            return await self._send_pages(ctx, f"👥 Member IDs ({len(lines)})", lines)

        # !ids  (overview)
        e = discord.Embed(title="🪪 IDs", color=discord.Color.teal())
        e.add_field(name="Server", value=f"`{guild.id}`", inline=False)
        e.add_field(name="This channel", value=f"`{ctx.channel.id}`", inline=False)
        e.add_field(name="You", value=f"`{ctx.author.id}`", inline=False)
        e.add_field(name="Cached members", value=f"{len(guild.members)} / {guild.member_count}", inline=False)
        e.set_footer(text="Try: !ids roles | !ids members <name> | !ids @user")
        await ctx.send(embed=e)

    async def _send_pages(self, ctx, title, lines):
        if not lines:
            return await ctx.send("Nothing found.")
        page, size = [], 0
        pages = []
        for line in lines:
            if size + len(line) + 1 > 3800:
                pages.append(page); page, size = [], 0
            page.append(line); size += len(line) + 1
        pages.append(page)
        for i, p in enumerate(pages[:5], 1):
            e = discord.Embed(title=f"{title} — {i}/{min(len(pages), 5)}", description="\n".join(p), color=discord.Color.teal())
            await ctx.send(embed=e)
        if len(pages) > 5:
            await ctx.send("…list truncated. Use `!ids members <name>` to narrow it down.")

async def setup(bot):
    await bot.add_cog(Admin(bot))
