import os
import time
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
        ends = guild.get("premium_ends_at")
        if not ends: 
            return True # Manual premium with no expiry
        try:
            clean_date = ends.replace("Z", "+00:00")
            end_date = datetime.fromisoformat(clean_date)
            return end_date > datetime.now(timezone.utc)
        except Exception as e:
            print(f"Error parsing premium date {ends}: {e}")
            return False
            
    if status == "trial":
        ends = guild.get("trial_ends_at")
        if not ends: 
            return False 
        try:
            clean_date = ends.replace("Z", "+00:00")
            end_date = datetime.fromisoformat(clean_date)
            return end_date > datetime.now(timezone.utc)
        except Exception:
            return False 
            
_role_cache = {}

def get_staff_role_ids(guild_id: int) -> set:
    now = time.time()
    cached = _role_cache.get(guild_id)
    if cached and now - cached[0] < 60:
        return cached[1]
    ids = set()
    try:
        res = supabase.table("guilds").select("staff_role_id,leader_role_id,colead_role_id").eq("guild_id", guild_id).limit(1).execute()
        if res.data:
            for v in res.data[0].values():
                if v:
                    ids.add(int(v))
    except Exception as e:
        print(f"Role lookup failed: {e}")
    _role_cache[guild_id] = (now, ids)
    return ids

def is_staff_member(m) -> bool:
    p = m.guild_permissions
    if p.administrator or p.manage_guild:
        return True
    role_ids = get_staff_role_ids(m.guild.id)
    return any(r.id in role_ids for r in m.roles)

    return False
