import os
from supabase import create_client, Client
from dotenv import load_dotenv

# This tells Python to go up one folder (to the root) and find the .env file there
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(root_dir, '.env')
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

# Initialize Supabase Client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_or_create_guild(guild_id: int) -> dict:
    """
    Fetches the guild from Supabase. 
    If it doesn't exist, it creates a new one (starting a 7-day trial).
    """
    response = supabase.table("guilds").select("*").eq("guild_id", guild_id).execute()
    
    if response.data:
        return response.data[0] 
    
    new_guild = {
        "guild_id": guild_id,
        "premium_status": "trial"
    }
    
    insert_response = supabase.table("guilds").insert(new_guild).execute()
    return insert_response.data[0]

def check_premium_status(guild_id: int) -> bool:
    guild = get_or_create_guild(guild_id)
    if guild.get("is_blacklisted"):
        return False
    status = guild.get("premium_status")
    return status in ["trial", "premium"]
