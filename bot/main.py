import discord
from discord.ext import commands
import os
import asyncio
import traceback
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

from database import supabase, get_or_create_guild, check_premium_status

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

if not TOKEN:
    raise RuntimeError("DISCORD_TOKEN missing from .env")

# Your Discord ID - Developer Bypass
DEVELOPER_ID = 704623764008075284

# Paid plan -> (stored plan id, team limit, paid days). Elite is unlimited via the
# 1,000,000 sentinel shared with the dashboard's lib/plans.ts.
PLAN_TIERS = {
    "starter": ("starter_monthly", 1, 30),
    "pro": ("pro_monthly", 3, 30),
    "elite": ("elite_yearly", 1_000_000, 365),
}

intents = discord.Intents.default()
intents.message_content = True 
intents.members = True         

class MonsterBot(commands.Bot):
    def __init__(self):
        # Discord parses mentions in plain sends by default, and member display
        # names are interpolated into several replies: never let those ping
        # @everyone/@here or a role. Announcement paths that must ping pass their
        # own AllowedMentions explicitly.
        super().__init__(
            command_prefix="!",
            intents=intents,
            allowed_mentions=discord.AllowedMentions(everyone=False, roles=False, users=True),
        )

    async def setup_hook(self):
        cogs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cogs")
        if not os.path.exists(cogs_dir):
            os.makedirs(cogs_dir)
            
        for filename in sorted(os.listdir(cogs_dir)):
            if filename.endswith(".py") and not filename.startswith("_"):
                try:
                    await self.load_extension(f"cogs.{filename[:-3]}")
                    print(f"✅ Loaded extension: {filename[:-3]}")
                except Exception as e:
                    print(f"❌ Failed to load {filename}: {e}")

bot = MonsterBot()
bot.remove_command("help")

@bot.event
async def on_ready():
    if getattr(bot, "_ready_once", False):
        return
    bot._ready_once = True
    
    print(f"✅ Logged in as {bot.user} (ID: {bot.user.id})")
    print("🔗 Testing Supabase Connection...")
    
    try:
        await asyncio.to_thread(supabase.table("guilds").select("guild_id").limit(1).execute)
        print("✅ Supabase connection successful!")
    except Exception as e:
        print(f"❌ Supabase connection failed: {e}")
        
    for g in bot.guilds:
        # One bad guild must not abort the backfill for every later guild.
        try:
            await asyncio.to_thread(get_or_create_guild, g.id)
        except Exception as e:
            print(f"❌ Could not initialise guild {g.id}: {e}")

    print("🚀 Bot is ready.")

@bot.event
async def on_guild_join(guild):
    try:
        await asyncio.to_thread(get_or_create_guild, guild.id)
    except Exception as e:
        print(f"❌ Could not initialise guild {guild.id}: {e}")

@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.CommandNotFound):
        return
    if isinstance(error, commands.NoPrivateMessage):
        return await ctx.send("❌ This command only works in a server.")
    if isinstance(error, commands.CheckFailure):
        return # The check itself already sends a message
    if isinstance(error, commands.UserInputError):
        # Bad arguments, unknown members, missing required arguments, ...
        return await ctx.send(f"❌ {error}")

    print(f"❌ Command Error in {ctx.command}: {error}")
    traceback.print_exception(type(error), error, error.__traceback__)
    try:
        await ctx.send("❌ Something went wrong while running that command. The bot owner has the details.")
    except discord.HTTPException:
        pass

@bot.check
async def premium_gate(ctx):
    # Bypass all checks for the Developer
    if ctx.author.id == DEVELOPER_ID:
        return True

    # Help must stay reachable when a trial expires so people can find support.
    # That includes the per-cog help pages (`!war help`, `!maze help`).
    if ctx.command is not None:
        name = ctx.command.name
        if name == "help":
            return True
        if name in ("war", "maze"):
            parts = (getattr(ctx.message, "content", "") or "").split()
            if len(parts) > 1 and parts[1].lower() == "help":
                return True

    if ctx.guild is None:
        # Let the command's own guild-only check raise NoPrivateMessage, which
        # is answered in on_command_error (global checks run before those).
        return True

    try:
        ok = await asyncio.to_thread(check_premium_status, ctx.guild.id)
    except Exception as e:
        # A database outage must not kill the command silently: discord.py only
        # routes CommandError to on_command_error.
        print(f"❌ Premium check failed for {ctx.guild.id}: {e}")
        try:
            await ctx.send("❌ I couldn't check this server's subscription right now. Please try again in a minute.")
        except discord.HTTPException:
            pass
        return False
    if not ok:
        await ctx.send("❌ This server's 7-day trial has expired or the server is blocked. Please upgrade via the dashboard.")
    return ok

@bot.command(name="force")
@commands.guild_only()
async def force_command(ctx, action: str = None, tier: str = None):
    if ctx.author.id != DEVELOPER_ID:
        return await ctx.send("❌ You do not have permission to run this developer command.")

    if action and action.lower() == "premium":
        chosen = PLAN_TIERS.get((tier or "elite").strip().lower())
        if not chosen:
            return await ctx.send("Usage: `!force premium [starter|pro|elite]`")
        plan_id, max_teams, days = chosen
        try:
            # The developer bypass never ran get_or_create_guild; make sure the
            # row exists or the update silently matches nothing.
            await asyncio.to_thread(get_or_create_guild, ctx.guild.id)
            ends_at = datetime.now(timezone.utc) + timedelta(days=days)
            payload = {
                "premium_status": "premium",
                # Paid grants always expire; a lifetime grant stays a manual SQL choice.
                "premium_ends_at": ends_at.isoformat(),
                "plan": plan_id,
                "max_teams": max_teams,
                "last_renewal_ping": 0,
            }
            try:
                res = await asyncio.to_thread(
                    supabase.table("guilds").update(payload).eq("guild_id", ctx.guild.id).execute
                )
            except Exception:
                # Dashboard/bot can be deployed before the 2026-12 migration adds `plan`.
                legacy_payload = {key: value for key, value in payload.items() if key != "plan"}
                res = await asyncio.to_thread(
                    supabase.table("guilds").update(legacy_payload).eq("guild_id", ctx.guild.id).execute
                )
            if not res.data:
                return await ctx.send("❌ Could not upgrade this server (no guild row).")
            await ctx.send(
                f"✅ **Server force-upgraded to {plan_id.replace('_', ' ').title()}** "
                f"until {ends_at.date().isoformat()}. You can now use all commands."
            )
        except Exception as e:
            await ctx.send(f"❌ Error: {e}")
    else:
        await ctx.send("Usage: `!force premium [starter|pro|elite]`")

if __name__ == "__main__":
    bot.run(TOKEN)
