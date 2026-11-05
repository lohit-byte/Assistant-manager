import discord
from discord.ext import commands
import os
from dotenv import load_dotenv
from database import supabase, get_or_create_guild

# Load env variables
load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

# Set up bot intents
intents = discord.Intents.default()
intents.message_content = True 
intents.members = True         

# Initialize Bot
class MonsterBot(commands.Bot):
    def __init__(self):
        super().__init__(command_prefix="!", intents=intents)

    async def setup_hook(self):
        # This loads all files in the cogs folder automatically
        for filename in os.listdir('./cogs'):
            if filename.endswith('.py'):
                await self.load_extension(f'cogs.{filename[:-3]}')
                print(f"Loaded extension: {filename[:-3]}")

bot = MonsterBot()

@bot.event
async def on_ready():
    print(f"✅ Logged in as {bot.user} (ID: {bot.user.id})")
    print("🔗 Testing Supabase Connection...")
    try:
        supabase.table("guilds").select("guild_id").limit(1).execute()
        print("✅ Supabase connection successful!")
    except Exception as e:
        print(f"❌ Supabase connection failed: {e}")
    print("🚀 Bot is ready and waiting for commands.")

@bot.event
async def on_guild_join(guild):
    print(f"Joined new server: {guild.name} ({guild.id})")
    get_or_create_guild(guild.id)

if __name__ == "__main__":
    bot.run(TOKEN)
