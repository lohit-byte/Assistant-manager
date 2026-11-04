import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

# Initialize Supabase Client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_or_create_guild(guild_id: int) -> dict:
    """
    Fetches the guild from Supabase. 
    If it doesn't exist, it creates a new one (starting a 7-day trial).
    """
    # Try to fetch the guild
    response = supabase.table("guilds").select("*").eq("guild_id", guild_id).execute()
    
    if response.data:
        return response.data[0] # Return existing guild data
    
    # If no data, create a new guild record
    new_guild = {
        "guild_id": guild_id,
        "premium_status": "trial"
        # Note: trial_ends_at, default attacks (6), etc., are handled by the SQL defaults
    }
    
    insert_response = supabase.table("guilds").insert(new_guild).execute()
    return insert_response.data[0]

def check_premium_status(guild_id: int) -> bool:
    """
    Checks if a guild has an active subscription or is still in the trial.
    """
    guild = get_or_create_guild(guild_id)
    
    # If blacklisted, deny access immediately
    if guild.get("is_blacklisted"):
        return False
        
    status = guild.get("premium_status")
    # You can add datetime logic here later to check if the trial actually expired
    
    return status in ["trial", "premium"]
