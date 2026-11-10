import shlex

import discord
from discord.ext import commands
from database import (supabase, is_staff_member, ensure_user, prune_departed_aliases,
                      rename_alias)
import asyncio


def _alias_words(text):
    """Normalise a (possibly quoted) alias argument the way rename already does."""
    try:
        return " ".join(shlex.split(text or "")).strip().lower()
    except ValueError:
        return (text or "").strip().lower()

class Admin(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="alias")
    @commands.guild_only()
    async def alias_group(self, ctx, action: str = None, *, args: str = None):
        """Manage player aliases. Usage: !alias add @user Sam | !alias remove Sam | !alias rename <old> <new> | !alias list | !alias prune"""
        if not await is_staff_member(ctx.author):
            return await ctx.send("❌ Only Admins can manage aliases.")

        action = (action or "").lower()

        if action in ("list", "show"):
            try:
                res = await asyncio.to_thread(
                    lambda: supabase.table("aliases")
                    .select("alias_name, discord_id")
                    .eq("guild_id", ctx.guild.id)
                    .order("alias_name")
                    .execute()
                )
            except Exception as e:
                return await ctx.send(f"❌ Database error: {e}")

            if not res.data:
                return await ctx.send("ℹ️ No aliases configured for this server yet.")

            lines, departed = [], 0
            for row in res.data:
                member = (
                    ctx.guild.get_member(int(row["discord_id"]))
                    if row.get("discord_id") is not None else None
                )
                suffix = ""
                if member is None:
                    departed += 1
                    suffix = " ⚠️ left the server"
                lines.append(f"• `{row['alias_name']}` → <@{row['discord_id']}>{suffix}")
            text = "\n".join(lines)
            if departed:
                text += f"\n\n⚠️ {departed} alias(es) belong to members who left — `!alias prune` cleans them."
            embed = discord.Embed(
                title=f"🏷️ Aliases ({len(lines)})",
                description=text if len(text) <= 4000 else text[:3990] + "\n…",
                color=discord.Color.blurple(),
            )
            return await ctx.send(embed=embed)

        if action in ("prune", "clean"):
            present = {member.id for member in ctx.guild.members}
            try:
                removed = await asyncio.to_thread(
                    prune_departed_aliases, ctx.guild.id, present)
            except Exception as e:
                return await ctx.send(f"❌ Database error: {e}")
            if not removed:
                return await ctx.send("✅ Every alias belongs to a current member — nothing to prune.")
            names = ", ".join(f"`{name}`" for name in removed[:20])
            more = " …" if len(removed) > 20 else ""
            return await ctx.send(
                f"🧹 Removed {len(removed)} alias(es) for members who left: {names}{more}\n"
                "They were also cleared from active war missing/excused lists."
            )

        if not action or not args:
            return await ctx.send(
                "Usage: `!alias add @user <alias>`, `!alias remove <alias>`, `!alias rename <old> <new>`, `!alias list` or `!alias prune`"
            )

        if action == "add":
            if not ctx.message.mentions:
                return await ctx.send("❌ You must mention the user. Usage: `!alias add @user <alias>`")
            
            member = ctx.message.mentions[0]
            alias_name = _alias_words(
                args.replace(member.mention, "").replace(f"<@!{member.id}>", "")
            )
            
            if not alias_name:
                return await ctx.send("❌ Please provide an alias name.")

            try:
                # aliases.discord_id is a foreign key into users, so the parent
                # row has to exist before the alias can be inserted.
                await asyncio.to_thread(ensure_user, member.id)
                await asyncio.to_thread(
                    lambda: supabase.table("aliases").upsert(
                        {
                            "guild_id": ctx.guild.id,
                            "discord_id": member.id,
                            "alias_name": alias_name
                        },
                        on_conflict="guild_id,alias_name"
                    ).execute()
                )
                await ctx.send(f"✅ Mapped alias `{alias_name}` to **{member.display_name}**.")
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")

        elif action == "remove":
            alias_name = _alias_words(args)
            try:
                res = await asyncio.to_thread(
                    lambda: supabase.table("aliases").delete()
                    .eq("guild_id", ctx.guild.id)
                    .eq("alias_name", alias_name)
                    .execute()
                )
                if not res.data:
                    return await ctx.send(f"❌ No alias named `{alias_name}` in this server.")
                await ctx.send(f"✅ Removed alias `{alias_name}`.")
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")

        elif action == "rename":
            # shlex keeps quoted aliases with spaces working; the plain
            # two-token form `!alias rename old new` is unchanged.
            try:
                parts = shlex.split(args)
            except ValueError as e:
                return await ctx.send(
                    f"❌ Could not read the alias names ({e}). "
                    "Usage: `!alias rename <old> <new>`"
                )
            if len(parts) != 2:
                return await ctx.send("Usage: `!alias rename <old> <new>`")
            try:
                error = await asyncio.to_thread(
                    rename_alias, ctx.guild.id, parts[0], parts[1]
                )
            except Exception as e:
                return await ctx.send(f"❌ Database error: {e}")
            if error:
                return await ctx.send(error)
            old_name, new_name = parts[0].strip().lower(), parts[1].strip().lower()
            await ctx.send(
                f"✅ Renamed `{old_name}` to `{new_name}` — current war counts and lists moved too."
            )
        else:
            await ctx.send(
                "Usage: `!alias add @user <alias>`, `!alias remove <alias>`, `!alias rename <old> <new>`, `!alias list` or `!alias prune`"
            )

    @commands.command(name="ids")
    @commands.guild_only()
    async def ids_command(self, ctx, *, query: str = None):
        """Staff: show IDs. Usage: !ids | !ids roles | !ids members [search] | !ids @user"""
        if not await is_staff_member(ctx.author):
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

    @commands.command(name="roles")
    @commands.guild_only()
    async def roles_command(self, ctx, *, query: str = None):
        """Staff: list roles with IDs/member counts, or the members holding one role."""
        if not await is_staff_member(ctx.author):
            return await ctx.send("❌ Staff only.")

        guild = ctx.guild
        roles = [r for r in reversed(guild.roles) if r != guild.default_role]
        if not roles:
            return await ctx.send("ℹ️ This server has no roles yet.")

        role = None
        if ctx.message.role_mentions:
            role = ctx.message.role_mentions[0]
        else:
            q = (query or "").strip().lower()
            if q:
                matches = [r for r in roles if r.name.lower() == q]
                if not matches:
                    matches = [r for r in roles if q in r.name.lower()]
                if not matches:
                    return await ctx.send(f"❌ No role matching `{query.strip()}`.")
                if len(matches) > 1 and matches[0].name.lower() != q:
                    names = ", ".join(f"`{r.name}`" for r in matches[:10])
                    return await ctx.send(f"❌ Several roles match: {names}. Use the exact name or @mention the role.")
                role = matches[0]

        if role is not None:
            members = [m for m in guild.members if not m.bot and self._holds_role(m, role)]
            members.sort(key=lambda m: m.display_name.lower())
            lines = [f"{m.display_name} — `{m.id}`" for m in members]
            return await self._send_pages(ctx, f"🎭 Members with {role.name}", lines,
                                          hint="Use `!roles` to see every role.")

        lines = []
        for r in roles:
            count = sum(1 for m in guild.members if self._holds_role(m, r))
            lines.append(f"**{r.name}** — `{r.id}` — {count} member{'s' if count != 1 else ''}")
        await self._send_pages(ctx, "🎭 Role IDs", lines,
                               hint="Use `!roles <name>` to see one role's members.")

    @staticmethod
    def _holds_role(member, role):
        return any(getattr(r, "id", None) == role.id for r in getattr(member, "roles", []))

    async def _send_pages(self, ctx, title, lines, hint=None):
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
            await ctx.send(f"…list truncated. {hint or 'Use a narrower search.'}")

async def setup(bot):
    await bot.add_cog(Admin(bot))
