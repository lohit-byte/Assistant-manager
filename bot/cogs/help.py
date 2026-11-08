import discord
from discord.ext import commands
from database import is_staff_member

def _embed(title, color, desc=None):
    return discord.Embed(title=title, description=desc, color=color)

def build_overview(is_staff):
    e = _embed("📖 Bot Help", discord.Color.blurple(),
               "Use `!help <topic>` for details: `war`, `race`, `maze`, `alias`, `ids`, `pings`")
    e.add_field(name="🛡️ War", value="`!war status` · `!war missing list`\nType `attacks done` to log your attacks", inline=False)
    e.add_field(name="🏁 Race", value="`!race status` · `!race ofa` · `!race dmp` · `!race je +500k`", inline=False)
    e.add_field(name="🗺️ Maze", value="`!maze status` · `!maze start 7d 6d12h`", inline=False)
    if is_staff:
        e.add_field(name="🔧 Admin", value="`!alias add @user <name>` · `!ids` · `!warning`", inline=False)
    e.set_footer(text="Staff-only commands are shown to staff only.")
    return e

def build_topic(topic, is_staff):
    if topic == "war":
        e = _embed("🛡️ War Commands", discord.Color.blue())
        e.add_field(name="Everyone", value="`!war status`\n`!war missing list`\n`attacks done` (or `4 attacks done`)", inline=False)
        if is_staff:
            e.add_field(name="Staff", value=(
                "`!war defence ends <time>`\n`!war attack ends <time>`\n`!war cancel`\n"
                "`!war missing add|remove <name>`\n`!war absent add|remove <name>`\n"
                "`!war attacks <name> | <count>`\n`!war set attacks <number>`\n"
                "`!war check` · `!war report`\n`!warning add|list|remove`"), inline=False)
        return e
    if topic == "race":
        e = _embed("🏁 Race Commands", discord.Color.green())
        e.add_field(name="Everyone", value="`!race status`\n`!race ofa` · `!race ofa done`\n`!race dmp`\n`!race je +500k` · `!race je done`", inline=False)
        if is_staff:
            e.add_field(name="Staff", value=(
                "`!race uploadsheet <name>` · `!race use <name>`\n`!race next`\n"
                "`!race newnode <image>` or `!race newnode 50 hatch | 10 breed`\n"
                "`!race set <desc|dyp|je|ofa> <value>`\n`!race target <number>`\n"
                "`!race ofa cancel` · `!race clear`"), inline=False)
        return e
    if topic == "maze":
        e = _embed("🗺️ Maze Commands", discord.Color.purple(), "Maze commands are staff only.")
        if is_staff:
            e.add_field(name="Commands", value=(
                "`!maze start <3d|7d> <time>` — time left (`6d12h`) or start date (`05/11`)\n"
                "`!maze status`\n`!maze stop`\n`!maze ping 20%` — manual discount ping"), inline=False)
        return e
    if topic in ("alias", "aliases"):
        e = _embed("👤 Aliases", discord.Color.orange(), "Aliases link in-game names to Discord users so they aren't pinged by name.")
        if is_staff:
            e.add_field(name="Commands", value="`!alias add @user <alias>`\n`!alias remove <alias>`", inline=False)
        else:
            e.description += "\nStaff manage aliases."
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
        staff = is_staff_member(ctx.author)
        if not topic:
            return await ctx.send(embed=build_overview(staff))
        e = build_topic(topic.lower(), staff)
        if e is None:
            return await ctx.send("❌ Unknown topic. Try `!help`, `!help war`, `!help race`, `!help maze`.")
        await ctx.send(embed=e)

async def setup(bot):
    await bot.add_cog(Help(bot))
