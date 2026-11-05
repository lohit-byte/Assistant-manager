import discord
from discord.ext import commands
import os
import asyncio
from dotenv import load_dotenv

from database import supabase, get_or_create_guild, check_premium_status

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

if not TOKEN:
    raise RuntimeError("DISCORD_TOKEN missing from .env")

# Your Discord ID - Developer Bypass
DEVELOPER_ID = 704623764008075284

intents = discord.Intents.default()
intents.message_content = True 
intents.members = True         

class MonsterBot(commands.Bot):
    def __init__(self):
        super().__init__(command_prefix="!", intents=intents)

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
        await asyncio.to_thread(get_or_create_guild, g.id)
        
    print("🚀 Bot is ready.")

@bot.event
async def on_guild_join(guild):
    await asyncio.to_thread(get_or_create_guild, guild.id)

@bot.event
async def on_command_error(ctx, error):
    if isinstance(error, commands.CommandNotFound):
        return
    if isinstance(error, commands.NoPrivateMessage):
        return await ctx.send("❌ This command only works in a server.")
    if isinstance(error, commands.CheckFailure):
        return # The check itself already sends a message
        
    print(f"❌ Command Error in {ctx.command}: {error}")

@bot.check
async def premium_gate(ctx):
    # Bypass all checks for the Developer
    if ctx.author.id == DEVELOPER_ID:
        return True

    if ctx.guild is None:
        return False
        
    ok = await asyncio.to_thread(check_premium_status, ctx.guild.id)
    if not ok:
        await ctx.send("❌ This server's 7-day trial has expired or the server is blocked. Please upgrade via the dashboard.")
    return ok

@bot.command(name="force")
@commands.guild_only()
async def force_command(ctx, action: str = None):
    if ctx.author.id != DEVELOPER_ID:
        return await ctx.send("❌ You do not have permission to run this developer command.")
        
    if action and action.lower() == "premium":
        try:
            await asyncio.to_thread(
                supabase.table("guilds").update({"premium_status": "premium"}).eq("guild_id", ctx.guild.id).execute
            )
            await ctx.send("✅ **Server force-upgraded to Premium!** You can now use all commands.")
        except Exception as e:
            await ctx.send(f"❌ Error: {e}")
    else:
        await ctx.send("Usage: `!force premium`")

if __name__ == "__main__":
    bot.run(TOKEN)
