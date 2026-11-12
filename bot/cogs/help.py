import discord
from discord.ext import commands
from database import is_staff_member

def _embed(title, color, desc=None):
    return discord.Embed(title=title, description=desc, color=color)

def build_overview(is_staff):
    topics = "`war`, `race`, `maze`, `team`, `alias`"
    if is_staff:
        topics += ", `ids`, `roles`, `warning`, `pings`"
    e = _embed("📖 Bot Help", discord.Color.blurple(),
               f"Use `!help <topic>` for details: {topics}")
    e.add_field(name="🛡️ War", value="`!war status` · `!war missing list`\nType `attacks done` to log your attacks", inline=False)
    e.add_field(name="🏁 Race", value="`!race status` · `!race ofa` · `!race dyp` · `!race je +500k`", inline=False)
    e.add_field(name="🗺️ Maze", value="`!maze status` · `!maze alerts dm|here|off` · `!maze start 7d 6d12h`", inline=False)
    e.add_field(
        name="👑 Captains",
        value=("A team captain can run their team's war and race commands in the team's "
               "channels (war tracking, lists, `!war attacks`, node/target/sheet selection, "
               "that team's `!war set attacks` / `!war set exempt`). "
               "Server settings, warnings, aliases, sheet uploads and other teams stay staff-only."),
        inline=False,
    )
    team_help = "`!team list` — teams, channels, roster sizes and each team's war rules"
    if is_staff:
        team_help += ("\n`!team players <team>` · `!team add @user <team>` · "
                      "`!team remove @user`")
    e.add_field(name="👥 Teams", value=team_help, inline=False)
    if is_staff:
        e.add_field(
            name="🏷️ Aliases",
            value="`!alias add @user <name>` · `!alias list` · `!alias prune`",
            inline=False,
        )
        e.add_field(
            name="⚠️ Warnings",
            value=("`!warning add @user <reason>` · `!warning list` · `!warning remove <id>`\n"
                   "*Separate from aliases; shown on the dashboard.*"),
            inline=False,
        )
        e.add_field(
            name="🪪 Setup helpers",
            value=("`!ids` — server, channel, member and user IDs\n"
                   "`!roles` — every role with its ID and member count · `!roles @role` — who has it"),
            inline=False,
        )
    e.set_footer(text="Staff-only commands are shown to staff only.")
    return e

def build_topic(topic, is_staff):
    if topic == "war":
        e = _embed("🛡️ War Commands", discord.Color.blue())
        e.add_field(name="Everyone", value="`!war status`\n`!war missing list`\n`attacks done` (or `4 attacks done`)", inline=False)
        e.add_field(name="Reminders", value=(
            "Channel reminders fire automatically: defence ends 30m, attack starts, 12h, 6h, 3h, 30m, war end. "
            "The 12h reminder mentions only players on the missing list."), inline=False)
        e.add_field(
            name="Captains",
            value=("A team captain can run the team war commands in their team's war channel: "
                   "start/cancel a war, the live board, the missing/excused lists, "
                   "`!war attacks`, `!war check`, `!war set role`, and this team's "
                   "`!war set attacks` / `!war set exempt`."),
            inline=False,
        )
        if is_staff:
            e.add_field(name="Staff", value=(
                "`!war defence ends <time>`\n`!war attack ends <time>`\n`!war cancel`\n"
                "`!war board` — start/refresh the live board · `!war board stop`\n"
                "`!war missing add|remove <name>` — pass several @mentions or comma-separated names at once\n"
                "`!war absent add|remove <name>`\n"
                "`!war attacks <name> <count>` (or `name | count`)\n"
                "`!war set attacks <number>` · `!war set exempt on|off` (team value in a team channel)\n"
                "`!war check` · `!war report`\n`!warning add @user <reason>` · `!warning list`"), inline=False)
        return e
    if topic == "race":
        e = _embed("🏁 Race Commands", discord.Color.green())
        e.add_field(name="Everyone", value="`!race status`\n`!race ofa` · `!race ofa done`\n`!race dyp` (`dmp` works too)\n`!race je +500k` · `!race je done`\n*Logging a task needs your alias — ask staff for* `!alias add @you <name>`.", inline=False)
        e.add_field(
            name="Captains",
            value=("A team captain can run the team race commands in their team's race channel: "
                   "`!race use`, `!race next`, `!race target`, `!race newnode`, `!race set`, "
                   "`!race sheets`, and OFA approve/cancel/release. Sheet uploads stay staff-only."),
            inline=False,
        )
        if is_staff:
            e.add_field(name="Staff", value=(
                "`!race uploadsheet <name>` (.json/.csv/.tsv) · `!race use <name>` · `!race use default` (bundled)\n"
                "`!race sheets` — guild sheets + default (bundled)\n`!race next`\n"
                "`!race newnode <image>` or `!race newnode 50 hatch | 10 breed`\n"
                "`!race set <desc|dyp|je|ofa> <value>`\n`!race target <number>`\n"
                "`!race ofa cancel` · `!race ofa release` · `!race clear`"), inline=False)
        return e
    if topic == "maze":
        e = _embed("🗺️ Maze Commands", discord.Color.purple())
        e.add_field(name="Everyone", value=(
            "`!maze status` — event, ping mode and next discounts\n"
            "`!maze alerts` — show your alert preference\n"
            "`!maze alerts here|dm|off` — channel @here (default), DM, or off"), inline=False)
        if is_staff:
            e.add_field(name="Staff", value=(
                "`!maze start <3d|7d> <time>` — time left (`6d12h`) or start date (`05/11`)\n"
                "`!maze stop`\n`!maze set ping here|everyone|role @role|none`\n"
                "`!maze ping 20%` — manual discount ping"), inline=False)
        return e
    if topic in ("alias", "aliases"):
        e = _embed("👤 Aliases", discord.Color.orange(), "Aliases link in-game names to Discord users so they aren't pinged by name.")
        if is_staff:
            e.add_field(
                name="Commands",
                value=("`!alias add @user <alias>`\n`!alias remove <alias>`\n"
                       "`!alias rename <old> <new>` — keeps the current war counts/lists\n"
                       "`!alias list` — flags aliases whose member left the server\n"
                       "`!alias prune` — removes those aliases and clears them from active war lists"),
                inline=False,
            )
        else:
            e.description += "\nStaff manage aliases."
        return e
    if topic in ("warning", "warnings"):
        e = _embed("⚠️ Warnings", discord.Color.red(), "Warnings are tracked per server and shown on the dashboard.")
        if is_staff:
            e.add_field(name="Commands", value=("`!warning add @user <reason>` — records it and DMs the player\n"
                                                "`!warning list` — recent server warnings\n`!warning list @user`\n"
                                                "`!warning remove <id>`"), inline=False)
        return e
    if topic in ("ids", "id"):
        e = _embed("🪪 ID Lookup", discord.Color.teal(), "Staff only.")
        if is_staff:
            e.add_field(name="Commands", value="`!ids` — this server, channel and your ID\n`!ids roles` — all role IDs\n`!ids members [search]` — member IDs\n`!ids @user` — one user's ID and roles", inline=False)
            e.add_field(name="Roles", value="`!roles` — role IDs with member counts\n`!roles @role` — the members holding that role", inline=False)
        return e
    if topic in ("team", "teams", "roster"):
        e = _embed("👥 Teams", discord.Color.teal(),
                   "Teams group players for war and race; each team has its own roster and war rules.")
        e.add_field(name="Everyone",
                    value="`!team list` — teams, channels, roster size and that team's war rules",
                    inline=False)
        if is_staff:
            e.add_field(name="Staff", value=(
                "`!team players <team>` — the roster, flagging members who left\n"
                "`!team add @user <team>` — add or move a player (they need an alias first)\n"
                "`!team remove @user` — remove them from their team and clean its active war lists\n"
                "`!war set attacks <number>` / `!war set exempt on|off` — per-team war rules in the team channel"),
                inline=False)
        return e
    if topic in ("roles", "role"):
        e = _embed("🎭 Roles & IDs", discord.Color.teal(), "Staff only.")
        if is_staff:
            e.add_field(name="Commands", value=(
                "`!roles` — every role with its ID and member count\n"
                "`!roles <name>` or `!roles @role` — the members holding that role\n"
                "`!ids` — this server, channel and your ID\n"
                "`!ids roles` — role IDs only\n"
                "`!ids members [search]` — member IDs\n"
                "`!ids @user` — one user's ID and roles"), inline=False)
        return e
    if topic in ("ping", "pings"):
        e = _embed("🔔 Pings", discord.Color.gold())
        e.add_field(name="Automatic", value="Maze discount pings go to the configured Maze channel at each discount time (set in the dashboard or with `!maze start`).", inline=False)
        e.add_field(name="Manual", value="`!maze ping 20%` sends a discount alert using the configured ping mention (staff).", inline=False)
        return e
    return None

class Help(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="help")
    @commands.guild_only()
    async def help_command(self, ctx, topic: str = None):
        staff = await is_staff_member(ctx.author)
        if not topic:
            return await ctx.send(embed=build_overview(staff))
        e = build_topic(topic.lower(), staff)
        if e is None:
            return await ctx.send("❌ Unknown topic. Try `!help`, `!help war`, `!help race`, `!help maze`, `!help team`, `!help ids`, `!help roles`.")
        await ctx.send(embed=e)

async def setup(bot):
    await bot.add_cog(Help(bot))
