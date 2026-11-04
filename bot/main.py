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
intents.message_content = True # Required to read plain text like "attacks done"
intents.members = True         # Required to resolve user aliases

# Initialize Bot
bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f"✅ Logged in as {bot.user} (ID: {bot.user.id})")
    print("🔗 Testing Supabase Connection...")
    
    try:
        # Quick test to see if we can reach the database
        response = supabase.table("guilds").select("guild_id").limit(1).execute()
        print("✅ Supabase connection successful!")
    except Exception as e:
        print(f"❌ Supabase connection failed: {e}")
        
    print("🚀 Bot is ready and waiting for commands.")

@bot.event
async def on_guild_join(guild):
    """
    Triggered when the bot is invited to a new server.
    Auto-creates the server in the database with a fresh 7-day trial.
    """
    print(f"Joined new server: {guild.name} ({guild.id})")
    get_or_create_guild(guild.id)

# Run the bot
if __name__ == "__main__":
    bot.run(TOKEN)
