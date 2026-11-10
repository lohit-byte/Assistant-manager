"""Per-team management: rosters and team-level settings helpers.

Monster Legends alliances run several teams (a main team plus feeder/recruiting
teams). The bot's aliases are guild-wide, so this cog maps players onto teams
and shows the team's war settings. War/race channels and roles are still edited
from the dashboard; the roster lives here because it changes with recruitment.
"""

import asyncio
import shlex

import discord
from discord.ext import commands

from database import (
    supabase,
    get_player_alias,
    get_player_team,
    get_team_by_name,
    get_team_players_map,
    get_team_roster,
    is_staff_member,
    is_team_staff,
    remove_team_player,
    set_team_player,
)

USAGE = ("`!team list` · `!team players <team>` · "
         "`!team add @user <team>` · `!team remove @user`")


def _words(raw):
    try:
        return " ".join(shlex.split(raw or "")).strip()
    except ValueError:
        return (raw or "").strip()


def _channel_id(team):
    return team.get("war_channel_id") or team.get("race_channel_id")


class Teams(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _can_manage(self, ctx, team):
        if await is_staff_member(ctx.author):
            return True
        channel_id = _channel_id(team)
        if channel_id is None:
            return False
        return await is_team_staff(ctx.author, channel_id)

    @commands.command(name="team")
    @commands.guild_only()
    async def team_group(self, ctx, action: str = None, *, args: str = None):
        """Teams and rosters. Usage: !team list | !team players <team> | !team add @user <team> | !team remove @user"""
        action = (action or "list").lower()
        if action in ("list", "show"):
            return await self.list_teams(ctx)
        if action in ("players", "roster"):
            return await self.show_players(ctx, _words(args))
        if action == "add":
            return await self.add_player(ctx, args)
        if action in ("remove", "kick"):
            return await self.remove_player(ctx, args)
        await ctx.send(f"Usage: {USAGE}")

    async def list_teams(self, ctx):
        try:
            teams = await asyncio.to_thread(
                lambda: supabase.table("teams").select("*")
                .eq("guild_id", ctx.guild.id).order("name").execute()
            )
            rosters = await asyncio.to_thread(get_team_players_map, ctx.guild.id)
            settings = await asyncio.to_thread(
                lambda: supabase.table("war_settings")
                .select("attacks_required, exempt_absent")
                .eq("guild_id", ctx.guild.id).limit(1).execute()
            )
        except Exception as e:
            return await ctx.send(f"❌ Database error: {e}")
        if not teams.data:
            return await ctx.send(
                "ℹ️ No teams configured yet. Create them from the dashboard's "
                "Overview → Setup, then roster players with `!team add @user <team>`."
            )
        defaults = settings.data[0] if settings.data else {}
        default_attacks = defaults.get("attacks_required") or 6
        default_exempt = defaults.get("exempt_absent", True)
        lines = []
        for team in teams.data:
            name = team.get("name") or "?"
            count = len(rosters.get(team.get("id"), set()))
            attacks = team.get("attacks_required")
            attacks = default_attacks if attacks is None else attacks
            exempt = team.get("exempt_absent")
            exempt = default_exempt if exempt is None else exempt
            channels = []
            war_id, race_id = team.get("war_channel_id"), team.get("race_channel_id")
            if war_id:
                channels.append("⚔️ <#%s>" % war_id)
            if race_id:
                channels.append("🏁 <#%s>" % race_id)
            channel_text = " ".join(channels) or "_no channels_"
            absence = "absences exempt" if exempt else "absences count"
            lines.append("• **%s** — 👥 %s · %s · %s attacks · %s"
                         % (name, count, channel_text, attacks, absence))
        embed = discord.Embed(
            title=f"👥 Teams ({len(lines)})",
            description="\n".join(lines)[:4000],
            color=discord.Color.teal(),
        )
        embed.set_footer(text="Staff: !team players <team> · !team add @user <team> · !team remove @user")
        await ctx.send(embed=embed)

    async def show_players(self, ctx, team_name):
        if not team_name:
            return await ctx.send(f"Usage: `!team players <team>` — {USAGE}")
        team = await asyncio.to_thread(get_team_by_name, ctx.guild.id, team_name)
        if not team:
            return await ctx.send(f"❌ No team called `{team_name}`.")
        if not await self._can_manage(ctx, team):
            return await ctx.send("❌ Staff only.")
        roster = await asyncio.to_thread(get_team_roster, ctx.guild.id, team)
        if not roster:
            return await ctx.send(
                f"ℹ️ **{team.get('name')}** has no rostered players yet — "
                f"add one with `!team add @user {team.get('name')}`."
            )
        lines, departed = [], 0
        for row in roster:
            member = ctx.guild.get_member(row["discord_id"])
            alias = ", ".join(row["aliases"]) or "⚠️ no alias"
            if member is None:
                departed += 1
                lines.append(f"• `{alias}` — <@{row['discord_id']}> ⚠️ left the server")
            else:
                lines.append(
                    f"• `{alias}` — {member.display_name} (`{row['discord_id']}`)")
        text = "\n".join(lines)
        if departed:
            text += f"\n\n⚠️ {departed} player(s) left the server; `!alias prune` cleans their aliases."
        embed = discord.Embed(
            title=f"👥 {team.get('name')} roster ({len(roster)})",
            description=text[:4000],
            color=discord.Color.teal(),
        )
        await ctx.send(embed=embed)

    def _team_from_add_args(self, ctx, raw):
        if not getattr(ctx.message, "mentions", None):
            return None, None
        target = ctx.message.mentions[0]
        name = raw or ""
        for token in (target.mention, f"<@!{target.id}>", f"<@{target.id}>"):
            name = name.replace(token, " ")
        return target, _words(name)

    async def add_player(self, ctx, raw_args):
        target, team_name = self._team_from_add_args(ctx, raw_args)
        if target is None:
            return await ctx.send(f"Usage: {USAGE}")
        if not team_name:
            return await ctx.send(f"Usage: `!team add @user <team>` — {USAGE}")
        team = await asyncio.to_thread(get_team_by_name, ctx.guild.id, team_name)
        if not team:
            return await ctx.send(f"❌ No team called `{team_name}`.")
        if not await self._can_manage(ctx, team):
            return await ctx.send("❌ Staff only.")
        alias = await asyncio.to_thread(get_player_alias, ctx.guild.id, target.id)
        if not alias:
            return await ctx.send(
                "❌ Give them an alias first with `!alias add @user <name>` — "
                "war/race tracking uses aliases, so a roster row without one can't be checked."
            )
        moved = await asyncio.to_thread(
            set_team_player, ctx.guild.id, team["id"], target.id)
        message = f"✅ **{alias}** is now on **{team.get('name')}**'s roster."
        if moved:
            message += " Moved from " + ", ".join(f"**{name}**" for name in moved) + "."
        await ctx.send(message)

    async def remove_player(self, ctx, raw_args):
        if not getattr(ctx.message, "mentions", None):
            return await ctx.send(f"Usage: `!team remove @user` — {USAGE}")
        target = ctx.message.mentions[0]
        team = await asyncio.to_thread(get_player_team, ctx.guild.id, target.id)
        if not team:
            return await ctx.send(f"ℹ️ **{target.display_name}** is not on a team roster.")
        if not await self._can_manage(ctx, team):
            return await ctx.send("❌ Staff only.")
        alias = await asyncio.to_thread(get_player_alias, ctx.guild.id, target.id)
        removed = await asyncio.to_thread(
            remove_team_player, ctx.guild.id, team["id"], target.id)
        if not removed:
            return await ctx.send("❌ Could not update the roster — try again.")
        label = f"`{alias}`" if alias else target.display_name
        await ctx.send(
            f"🧹 Removed {label} from **{team.get('name')}** and cleared them from "
            "its active war missing/excused lists."
        )


async def setup(bot):
    await bot.add_cog(Teams(bot))
