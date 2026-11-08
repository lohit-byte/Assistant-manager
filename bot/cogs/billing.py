import discord
from discord.ext import commands, tasks
from datetime import datetime, timezone
import asyncio
from database import supabase

def to_utc(s: str) -> datetime:
    if not s: return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

class BillingManager(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.check_expirations.start()

    def cog_unload(self):
        self.check_expirations.cancel()

    @tasks.loop(hours=12)
    async def check_expirations(self):
        await self.bot.wait_until_ready()
        try:
            # Fetch all premium servers (NO parentheses after .execute here)
            res = await asyncio.to_thread(
                supabase.table("guilds").select("*").eq("premium_status", "premium").execute
            )
            
            now = datetime.now(timezone.utc)

            for guild_data in res.data:
                guild_id = guild_data["guild_id"]
                ends_at_str = guild_data.get("premium_ends_at")
                last_ping = guild_data.get("last_renewal_ping", 0)
                
                # If no end date (Lifetime access), skip
                if not ends_at_str:
                    continue
                    
                ends_at = to_utc(ends_at_str)
                if not ends_at:
                    continue
                    
                diff = ends_at - now
                days_left = diff.days
                
                guild = self.bot.get_guild(guild_id)
                if not guild:
                    continue

                # Determine the channel to send the message
                channel_id = guild_data.get("maze_channel_id")
                channel = guild.get_channel(channel_id) if channel_id else None
                if not channel:
                    channel = guild.system_channel
                if not channel:
                    channel = guild.text_channels[0] if guild.text_channels else None
                    
                if not channel:
                    continue

                # --- LOGIC FOR EXPIRY ---
                if days_left <= 0 and last_ping != -1:
                    # 1. Expired (NO parentheses after .execute here)
                    await asyncio.to_thread(
                        supabase.table("guilds").update({
                            "premium_status": "expired",
                            "last_renewal_ping": -1
                        }).eq("guild_id", guild_id).execute
                    )
                    embed = discord.Embed(
                        title="🚨 Premium Expired", 
                        description="Your premium subscription has ended. The bot is now paused.\n[Reactivate on the Dashboard](https://drlohithealth.com/dashboard)",
                        color=discord.Color.red()
                    )
                    await channel.send(content=guild.owner.mention if guild.owner else "", embed=embed)
                    
                elif 0 < days_left <= 1 and (last_ping > 1 or last_ping == 0):
                    # 2. 1 Day Warning (NO parentheses after .execute here)
                    await asyncio.to_thread(
                        supabase.table("guilds").update({"last_renewal_ping": 1}).eq("guild_id", guild_id).execute
                    )
                    embed = discord.Embed(
                        title="⚠️ Premium Expires Tomorrow", 
                        description="Your premium subscription ends in less than 24 hours.\n[Renew on the Dashboard](https://drlohithealth.com/dashboard) to keep the bot online.",
                        color=discord.Color.orange()
                    )
                    await channel.send(content=guild.owner.mention if guild.owner else "", embed=embed)

                elif 1 < days_left <= 3 and (last_ping > 3 or last_ping == 0):
                    # 3. 3 Day Warning (NO parentheses after .execute here)
                    await asyncio.to_thread(
                        supabase.table("guilds").update({"last_renewal_ping": 3}).eq("guild_id", guild_id).execute
                    )
                    embed = discord.Embed(
                        title="⏳ Premium Expiring Soon", 
                        description=f"Your premium subscription ends in {days_left} days.\n[Renew on the Dashboard](https://drlohithealth.com/dashboard) to avoid interruption.",
                        color=discord.Color.yellow()
                    )
                    await channel.send(content=guild.owner.mention if guild.owner else "", embed=embed)

        except Exception as e:
            print(f"Error in billing check loop: {e}")

    @check_expirations.before_loop
    async def before_check(self):
        await self.bot.wait_until_ready()

async def setup(bot):
    await bot.add_cog(BillingManager(bot))
