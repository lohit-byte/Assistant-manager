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

# Reminder copy follows the UX psychology guide: one exact, localized deadline, the loss
# (what pauses) and the reassurance (what is kept), then a one-click action.
PAUSES = "War timers, missing lists, race nodes and maze pings pause"
KEPT = "Nothing is deleted — teams, aliases, settings and war/race/maze history are kept."


def dashboard_link(label: str) -> str:
    return f"[{label}]({DASHBOARD_URL})" if DASHBOARD_URL else label


def to_utc(s: str) -> datetime:
    if not s:
        return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _when(moment: datetime) -> str:
    """Discord localizes these per reader, so everyone sees their own exact deadline."""
    return f"<t:{int(moment.timestamp())}:F> (<t:{int(moment.timestamp())}:R>)"


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
            premium = await asyncio.to_thread(
                supabase.table("guilds").select("*").eq("premium_status", "premium").execute
            )
            trial = await asyncio.to_thread(
                supabase.table("guilds").select("*").eq("premium_status", "trial").execute
            )
        except Exception as e:
            print(f"Error in billing check loop: {e}")
            return

        now = datetime.now(timezone.utc)
        for guild_data in premium.data:
            # One malformed row must not stop reminders for every other guild.
            try:
                await self._process_guild(guild_data, now)
            except Exception as e:
                print(f"Billing check failed for {guild_data.get('guild_id')}: {e}")
        for guild_data in trial.data:
            try:
                await self._process_trial_guild(guild_data, now)
            except Exception as e:
                print(f"Trial check failed for {guild_data.get('guild_id')}: {e}")

    def _pick_channel(self, guild, guild_data):
        """Prefer the maze channel, then the system channel, then the first text channel."""
        channel_id = guild_data.get("maze_channel_id")
        channel = guild.get_channel(channel_id) if channel_id else None
        if not channel:
            channel = guild.system_channel
        if not channel:
            channel = guild.text_channels[0] if guild.text_channels else None
        return channel

    async def _send_notice(self, guild, guild_data, embed):
        """Channel notice when there is a channel, plus a DM to the people who can renew.

        Returns True when at least one copy was delivered so a marker is not consumed by
        an outage.
        """
        delivered = False
        channel = self._pick_channel(guild, guild_data)
        if channel is not None:
            owner_ping = guild.owner.mention if guild.owner else ""
            try:
                await channel.send(content=owner_ping, embed=embed)
                delivered = True
            except discord.HTTPException as e:
                print(f"Billing notice failed in {guild.id}: {e}")
        dm_count = await self._dm_admins(guild, embed)
        return delivered or dm_count > 0

    async def _process_guild(self, guild_data, now):
        guild_id = guild_data["guild_id"]
        ends_at_str = guild_data.get("premium_ends_at")
        last_ping = guild_data.get("last_renewal_ping", 0)

        # If no end date (manual lifetime access), skip.
        if not ends_at_str:
            return

        ends_at = to_utc(ends_at_str)
        if not ends_at:
            return

        diff = ends_at - now
        total_hours = diff.total_seconds() / 3600
        expired = total_hours <= 0
        days_left = max(1, math.ceil(total_hours / 24))

        # A renewal can happen without the payment webhook resetting the marker;
        # a stale 1/3/-1 marker must not mute the new term's warnings.
        if not expired:
            stale_marker = (
                last_ping == -1
                or (last_ping == 1 and total_hours > 24)
                or (last_ping == 3 and total_hours > 72)
            )
            if stale_marker:
                await asyncio.to_thread(
                    supabase.table("guilds").update({"last_renewal_ping": 0}).eq("guild_id", guild_id).execute
                )
                last_ping = 0

        guild = self.bot.get_guild(guild_id)
        if not guild:
            return

        # --- LOGIC FOR EXPIRY ---
        if expired:
            if last_ping == -1:
                return
            delivered = await self._send_notice(guild, guild_data, discord.Embed(
                title="🚨 Tracking paused",
                description=(
                    f"The paid term ended on {_when(ends_at)}.\n"
                    f"{PAUSES}.\n{KEPT}\n"
                    f"{dashboard_link('Reactivate — one click, nothing to re-enter')}."
                ),
                color=discord.Color.red()
            ))
            # The gate must close even when the notice could not be delivered;
            # only the marker waits for a successful delivery (and a retry).
            payload = {"premium_status": "expired"}
            if delivered:
                payload["last_renewal_ping"] = -1
            await self._update_if_unchanged(guild_id, ends_at_str, payload)

        elif total_hours <= 24 and last_ping not in (1, -1):
            # 2. 1 Day Warning
            delivered = await self._send_notice(guild, guild_data, discord.Embed(
                title="⚠️ Last day of premium",
                description=(
                    f"Tracking pauses on {_when(ends_at)}.\n"
                    f"After that: {PAUSES.lower()}.\n{KEPT}\n"
                    f"{dashboard_link('Extend now')} without a gap."
                ),
                color=discord.Color.orange()
            ))
            if delivered:
                await self._update_if_unchanged(guild_id, ends_at_str, {"last_renewal_ping": 1})

        elif total_hours <= 72 and last_ping not in (1, 3, -1):
            # 3. 3 Day Warning
            delivered = await self._send_notice(guild, guild_data, discord.Embed(
                title=f"⏳ Premium ends in {days_left} days",
                description=(
                    f"Tracking pauses on {_when(ends_at)}.\n"
                    f"After that: {PAUSES.lower()}.\n{KEPT}\n"
                    f"{dashboard_link('Renew on the Dashboard')} to avoid interruption."
                ),
                color=discord.Color.yellow()
            ))
            if delivered:
                await self._update_if_unchanged(guild_id, ends_at_str, {"last_renewal_ping": 3})

    async def _process_trial_guild(self, guild_data, now):
        """Trial reminders: one at <= 48h left, one after the trial ends."""
        guild_id = guild_data["guild_id"]
        ends_at_str = guild_data.get("trial_ends_at")
        last_ping = guild_data.get("last_renewal_ping", 0)

        if not ends_at_str:
            return
        ends_at = to_utc(ends_at_str)
        if not ends_at:
            return

        diff = ends_at - now
        total_hours = diff.total_seconds() / 3600
        guild = self.bot.get_guild(guild_id)
        if not guild:
            return

        if total_hours <= 0:
            if last_ping == -1:
                return
            delivered = await self._send_notice(guild, guild_data, discord.Embed(
                title="🚨 Free trial ended",
                description=(
                    f"The free trial ended on {_when(ends_at)}.\n"
                    f"{PAUSES}.\n{KEPT}\n"
                    f"{dashboard_link('Pick a plan — one click, nothing to re-enter')}."
                ),
                color=discord.Color.red()
            ))
            if delivered:
                await self._update_trial_if_unchanged(guild_id, ends_at_str, {"last_renewal_ping": -1})
            return

        if total_hours <= 48 and last_ping not in (1, -1):
            delivered = await self._send_notice(guild, guild_data, discord.Embed(
                title="⏳ Trial ends in 2 days",
                description=(
                    f"Your free trial ends on {_when(ends_at)}.\n"
                    f"After that: {PAUSES.lower()}.\n{KEPT}\n"
                    f"{dashboard_link('Pick a plan')} to keep tracking without a gap."
                ),
                color=discord.Color.orange()
            ))
            if delivered:
                await self._update_trial_if_unchanged(guild_id, ends_at_str, {"last_renewal_ping": 1})

    async def _dm_admins(self, guild, embed):
        """DM the guild owner and up to four Manage-Server admins; return #sent."""
        sent = 0
        targets, seen = [], set()
        if guild.owner is not None:
            targets.append(guild.owner)
            seen.add(guild.owner.id)
        for member in list(getattr(guild, "members", []))[:1000]:
            if len(targets) >= 5:
                break
            if getattr(member, "bot", False) or member.id in seen:
                continue
            perms = getattr(member, "guild_permissions", None)
            if perms is not None and (perms.administrator or perms.manage_guild):
                targets.append(member)
                seen.add(member.id)
        for member in targets:
            try:
                await member.send(embed=embed)
            except (discord.HTTPException, AttributeError, TypeError) as e:
                print(f"Billing DM failed for {getattr(member, 'id', '?')}: {e}")
            else:
                sent += 1
        return sent

    async def _update_if_unchanged(self, guild_id, ends_at_str, payload):
        """Only write if premium_ends_at still matches what the sweep read."""
        res = await asyncio.to_thread(
            supabase.table("guilds").update(payload)
            .eq("guild_id", guild_id).eq("premium_ends_at", ends_at_str).execute
        )
        return bool(res.data)

    async def _update_trial_if_unchanged(self, guild_id, ends_at_str, payload):
        """Only write if trial_ends_at still matches what the sweep read."""
        res = await asyncio.to_thread(
            supabase.table("guilds").update(payload)
            .eq("guild_id", guild_id).eq("trial_ends_at", ends_at_str).execute
        )
        return bool(res.data)

    @check_expirations.before_loop
    async def before_check(self):
        await self.bot.wait_until_ready()


async def setup(bot):
    await bot.add_cog(BillingManager(bot))
