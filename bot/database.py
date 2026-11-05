import os
from datetime import datetime, timezone
from supabase import create_client, Client
from dotenv import load_dotenv

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(root_dir, '.env')
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment variables.")

supabase: Client = create_client(SUPABASE_URL.strip().rstrip('/'), SUPABASE_KEY.strip())

def get_or_create_guild(guild_id: int) -> dict:
    res = supabase.table("guilds").select("*").eq("guild_id", guild_id).execute()
    if res.data:
        return res.data[0]
    
    supabase.table("guilds").upsert(
        {"guild_id": guild_id, "premium_status": "trial"},
        on_conflict="guild_id",
        ignore_duplicates=True,
    ).execute()
    
    return supabase.table("guilds").select("*").eq("guild_id", guild_id).execute().data[0]

def check_premium_status(guild_id: int) -> bool:
    guild = get_or_create_guild(guild_id)
    if guild.get("is_blacklisted"):
        return False
        
    status = guild.get("premium_status")
    if status == "premium":
        return True
        
    if status == "trial":
        ends = guild.get("trial_ends_at")
        if not ends:
            return True
            
        try:
            clean_date = ends.replace("Z", "+00:00")
            end_date = datetime.fromisoformat(clean_date)
            return end_date > datetime.now(timezone.utc)
        except Exception as e:
            print(f"Error parsing trial date '{ends}': {e}")
            return True
            
    return False
