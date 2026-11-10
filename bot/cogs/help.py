import discord
from discord.ext import commands
from database import is_staff_member

def _embed(title, color, desc=None):
    return discord.Embed(title=title, description=desc, color=color)

def build_overview(is_staff):
    e = _embed("📖 Bot Help", discord.Color.blurple(),
               "Use `!help <topic>` for details: `war`, `race`, `maze`, `alias`, `ids`, `warning`, `pings`")
    e.add_field(name="🛡️ War", value="`!war status` · `!war missing list`\nType `attacks done` to log your attacks", inline=False)
    e.add_field(name="🏁 Race", value="`!race status` · `!race ofa` · `!race dmp` · `!race je +500k`", inline=False)
    e.add_field(name="🗺️ Maze", value="`!maze status` · `!maze alerts dm|here|off` · `!maze start 7d 6d12h`", inline=False)
    e.add_field(
        name="👑 Captains",
        value=("A team captain can run their team's war and race commands in the team's "
               "channels (war tracking, lists, `!war attacks`, node/target/sheet selection). "
               "Server settings, warnings, aliases, sheet uploads and other teams stay staff-only."),
        inline=False,
    )
    if is_staff:
        e.add_field(name="🔧 Admin", value="`!alias add @user <name>` · `!alias list` · `!ids` · `!warning`", inline=False)
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
                   "`!war attacks`, `!war check` and `!war set role`."),
            inline=False,
        )
        if is_staff:
            e.add_field(name="Staff", value=(
                "`!war defence ends <time>`\n`!war attack ends <time>`\n`!war cancel`\n"
                "`!war board` — start/refresh the live board · `!war board stop`\n"
                "`!war missing add|remove <name>`\n`!war absent add|remove <name>`\n"
                "`!war attacks <name> <count>` (or `name | count`)\n`!war set attacks <number>`\n"
                "`!war check` · `!war report`\n`!warning add @user <reason>` · `!warning list`"), inline=False)
        return e
    if topic == "race":
        e = _embed("🏁 Race Commands", discord.Color.green())
        e.add_field(name="Everyone", value="`!race status`\n`!race ofa` · `!race ofa done`\n`!race dmp`\n`!race je +500k` · `!race je done`", inline=False)
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
                       "`!alias rename <old> <new>` — keeps the current war counts/lists\n`!alias list`"),
                inline=False,
            )
        else:
            e.description += "\nStaff manage aliases."
        return e
    if topic in ("warning", "warnings"):
        e = _embed("⚠️ Warnings", discord.Color.red(), "Warnings are tracked per server and shown on the dashboard.")
        if is_staff:
            e.add_field(name="Commands", value="`!warning add @user <reason>`\n`!warning list` — recent server warnings\n`!warning list @user`\n`!warning remove <id>`", inline=False)
        return e
    if topic in ("ids", "id"):
        e = _embed("🪪 ID Lookup", discord.Color.teal(), "Staff only.")
        if is_staff:
            e.add_field(name="Commands", value="`!ids` — this server, channel and your ID\n`!ids roles` — all role IDs\n`!ids members [search]` — member IDs\n`!ids @user` — one user's ID and roles", inline=False)
        return e
    if topic in ("ping", "pings"):
        e = _embed("🔔 Pings", discord.Color.gold())
        e.add_field(name="Automatic", value="Maze discount pings go to the configured Maze channel at each discount time (set in the dashboard or with `!maze start`).", inline=False)
        e.add_field(name="Manual", value="`!maze ping 20%` sends an @everyone discount alert (staff).", inline=False)
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
            return await ctx.send("❌ Unknown topic. Try `!help`, `!help war`, `!help race`, `!help maze`.")
        await ctx.send(embed=e)

async def setup(bot):
    await bot.add_cog(Help(bot))
