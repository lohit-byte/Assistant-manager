import discord
from discord.ext import commands, tasks
from datetime import datetime, timezone
import asyncio
import math
import os
from database import supabase

# Set DASHBOARD_URL in the bot environment (e.g. https://<your-app>.vercel.app).
# When unset the messages simply omit the link instead of pointing at a wrong site.
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "").rstrip("/")


def dashboard_link(label: str) -> str:
    return f"[{label}]({DASHBOARD_URL})" if DASHBOARD_URL else label

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
            res = await asyncio.to_thread(
                supabase.table("guilds").select("*").eq("premium_status", "premium").execute
            )
        except Exception as e:
            print(f"Error in billing check loop: {e}")
            return

        now = datetime.now(timezone.utc)
        for guild_data in res.data:
            # One malformed row must not stop reminders for every other guild.
            try:
                await self._process_guild(guild_data, now)
            except Exception as e:
                print(f"Billing check failed for {guild_data.get('guild_id')}: {e}")

    async def _process_guild(self, guild_data, now):
        guild_id = guild_data["guild_id"]
        ends_at_str = guild_data.get("premium_ends_at")
        last_ping = guild_data.get("last_renewal_ping", 0)

        # If no end date (Lifetime access), skip
        if not ends_at_str:
            return

        ends_at = to_utc(ends_at_str)
        if not ends_at:
            return

        diff = ends_at - now
        total_hours = diff.total_seconds() / 3600
        expired = total_hours <= 0
        days_left = max(1, math.ceil(total_hours / 24))

        guild = self.bot.get_guild(guild_id)
        if not guild:
            return

        # Prefer the maze channel, then the system channel, then the first text channel.
        channel_id = guild_data.get("maze_channel_id")
        channel = guild.get_channel(channel_id) if channel_id else None
        if not channel:
            channel = guild.system_channel
        if not channel:
            channel = guild.text_channels[0] if guild.text_channels else None
        if not channel:
            return

        owner_ping = guild.owner.mention if guild.owner else ""

        async def send_notice(embed):
            try:
                await channel.send(content=owner_ping, embed=embed)
            except discord.HTTPException as e:
                print(f"Billing notice failed in {guild_id}: {e}")

        # --- LOGIC FOR EXPIRY ---
        if expired:
            if last_ping == -1:
                return
            await asyncio.to_thread(
                supabase.table("guilds").update({
                    "premium_status": "expired",
                    "last_renewal_ping": -1
                }).eq("guild_id", guild_id).execute
            )
            await send_notice(discord.Embed(
                title="🚨 Premium Expired",
                description=(
                    "Your premium subscription has ended. The bot is now paused.\n"
                    f"{dashboard_link('Reactivate on the Dashboard')}."
                ),
                color=discord.Color.red()
            ))

        elif total_hours <= 24 and last_ping not in (1, -1):
            # 2. 1 Day Warning
            await asyncio.to_thread(
                supabase.table("guilds").update({"last_renewal_ping": 1}).eq("guild_id", guild_id).execute
            )
            await send_notice(discord.Embed(
                title="⚠️ Premium Expires Tomorrow",
                description=(
                    f"Your premium subscription ends in about {int(total_hours)} hours.\n"
                    f"{dashboard_link('Renew on the Dashboard')} to keep the bot online."
                ),
                color=discord.Color.orange()
            ))

        elif total_hours <= 72 and last_ping not in (1, 3, -1):
            # 3. 3 Day Warning
            await asyncio.to_thread(
                supabase.table("guilds").update({"last_renewal_ping": 3}).eq("guild_id", guild_id).execute
            )
            await send_notice(discord.Embed(
                title="⏳ Premium Expiring Soon",
                description=(
                    f"Your premium subscription ends in {days_left} days.\n"
                    f"{dashboard_link('Renew on the Dashboard')} to avoid interruption."
                ),
                color=discord.Color.yellow()
            ))

    @check_expirations.before_loop
    async def before_check(self):
        await self.bot.wait_until_ready()

async def setup(bot):
    await bot.add_cog(BillingManager(bot))
