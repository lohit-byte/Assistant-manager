import discord
from discord.ext import commands
import re
import asyncio
from datetime import datetime, timedelta, timezone
from database import supabase, is_staff_member

SCHEDULE_7D = [
    (6 * 24 + 22, 0, "20%"), (5 * 24 + 19, 0, "10%"), (5 * 24 + 0, 0, "30%"),
    (4 * 24 + 17, 0, "10%"), (4 * 24 + 1, 0, "10%"), (3 * 24 + 6, 0, "10%"),
    (1 * 24 + 9, 0, "10%"), (0 * 24 + 1, 0, "20%"),
]
SCHEDULE_3D = [
    (2 * 24 + 23, 0, "30%"), (1 * 24 + 23, 0, "20%"),
    (1 * 24 + 11, 0, "10%"), (0 * 24 + 11, 0, "10%"),
]

def to_utc(s: str) -> datetime:
    if not s: return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

class MazeTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.timers = {}
        self.schedule_signatures = {}
        self._sync_task = None

    async def cog_load(self):
        self._sync_task = asyncio.create_task(self._sync_loop())

    def cog_unload(self):
        if self._sync_task:
            self._sync_task.cancel()
        for guild_id in list(self.timers):
            self._cancel(guild_id)

    def _cancel(self, guild_id):
        for t in self.timers.pop(guild_id, []):
            t.cancel()
        self.schedule_signatures.pop(guild_id, None)

    async def _sync_loop(self):
        """Reload schedules periodically so dashboard edits reach a running bot."""
        await self.bot.wait_until_ready()
        while True:
            try:
                await self.restore_schedules()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"Maze schedule sync failed: {e}")
            await asyncio.sleep(300)

    async def _resolve_channel(self, row):
        """Schedule channel, then the guild's configured maze channel, then system channel."""
        channel = self.bot.get_channel(row.get("channel_id")) if row.get("channel_id") else None
        if channel:
            return channel
        guild = self.bot.get_guild(row.get("guild_id"))
        if not guild:
            return None
        try:
            res = await asyncio.to_thread(
                supabase.table("guilds").select("maze_channel_id")
                .eq("guild_id", row["guild_id"]).limit(1).execute
            )
            configured = res.data[0].get("maze_channel_id") if res.data else None
        except Exception:
            configured = None
        return guild.get_channel(configured) if configured else guild.system_channel

    async def restore_schedules(self):
        await self.bot.wait_until_ready()
        res = await asyncio.to_thread(supabase.table("maze_schedules").select("*").execute)
        now = datetime.now(timezone.utc)
        seen = set()

        for row in res.data:
            guild_id = row.get("guild_id")
            seen.add(guild_id)
            try:
                channel = await self._resolve_channel(row)
                end_time = to_utc(row.get("event_end"))
                start_time = to_utc(row.get("event_start"))
                signature = (
                    row.get("event_start"), row.get("event_end"), row.get("maze_type"),
                    getattr(channel, "id", None), row.get("ping_enabled_global"),
                    repr(row.get("discount_schedule")),
                )
                if signature == self.schedule_signatures.get(guild_id):
                    continue  # unchanged -> keep the existing timers
                if not channel or not end_time or end_time <= now:
                    self._cancel(guild_id)
                    continue
                self.schedule_pings(
                    guild_id, channel, row.get("maze_type", "7d"),
                    end_time, start_time, row.get("discount_schedule"),
                )
                self.schedule_signatures[guild_id] = signature
            except Exception as e:
                print(f"Error restoring maze schedule for {guild_id}: {e}")

        # A dashboard delete/stop removes the row: drop its leftover timers.
        for guild_id in list(self.timers):
            if guild_id not in seen:
                self._cancel(guild_id)

    @staticmethod
    def _normalise_schedule(raw):
        """Validate a custom ``discount_schedule`` JSON value (list of [hours, minutes, pct])."""
        if not isinstance(raw, list) or not raw:
            return None
        out = []
        for item in raw:
            try:
                hours, minutes, pct = item
                out.append((int(hours), int(minutes), str(pct)))
            except (TypeError, ValueError):
                return None
        return out

    def schedule_pings(self, guild_id, channel, maze_type, end_time, start_time, custom_schedule=None):
        self._cancel(guild_id)

        self.timers[guild_id] = []
        schedule = self._normalise_schedule(custom_schedule) or (
            SCHEDULE_7D if maze_type == "7d" else SCHEDULE_3D
        )
        now = datetime.now(timezone.utc)
        
        for hours, minutes, pct in schedule:
            discount_time = end_time - timedelta(hours=hours, minutes=minutes)
            delay = (discount_time - now).total_seconds()
            
            if delay > 0:
                self.timers[guild_id].append(
                    asyncio.create_task(self.ping_discount_at_time(guild_id, channel, pct, delay, end_time))
                )
            elif -300 < delay <= 0:
                self.timers[guild_id].append(
                    asyncio.create_task(self.ping_discount_at_time(guild_id, channel, pct, 0, end_time))
                )

    async def ping_discount_at_time(self, guild_id, channel, pct, delay, expected_end=None):
        if delay > 0:
            await asyncio.sleep(delay)

        # The event may have been cancelled, rescheduled or pings disabled while we slept.
        try:
            res = await asyncio.to_thread(
                supabase.table("maze_schedules")
                .select("ping_enabled_global, event_end")
                .eq("guild_id", guild_id)
                .limit(1)
                .execute
            )
            row = res.data[0] if res.data else None
            if not row or row.get("ping_enabled_global") is False:
                return
            if expected_end is not None and to_utc(row.get("event_end")) != expected_end:
                return  # schedule changed; the sync loop owns the new timers
        except Exception as e:
            print(f"Maze ping check failed for {guild_id}: {e}")
            return

        embed = discord.Embed(
            title="🗺️ Maze Island Discount!",
            description=f"🚨 **{pct} Discount is live right now!**\n\nSpend your Maze Coins!",
            color=discord.Color.purple()
        )
        
        # --- NEW CODE: Check for configured channel ---
        try:
            res = await asyncio.to_thread(supabase.table("guilds").select("maze_channel_id").eq("guild_id", guild_id).execute)
            configured_id = res.data[0].get("maze_channel_id") if res.data else None
            if configured_id:
                target_channel = self.bot.get_channel(configured_id)
                if target_channel:
                    channel = target_channel
        except Exception:
            pass
        # ----------------------------------------------
        
        # channel.guild.me is None when the bot member is not cached (for
        # example right after a reconnect), which would raise AttributeError.
        me = getattr(getattr(channel, "guild", None), "me", None)
        can_mention = bool(me and channel.permissions_for(me).mention_everyone)

        try:
            if can_mention:
                await channel.send(content="@everyone", embed=embed, allowed_mentions=discord.AllowedMentions(everyone=True))
            else:
                await channel.send(embed=embed)
        except (discord.HTTPException, AttributeError, TypeError) as e:
            print(f"Maze ping failed in {guild_id}: {e}")

    @commands.command(name="maze")
    @commands.guild_only()
    async def maze_group(self, ctx, action: str = None, arg1: str = None, *, arg2: str = None):
        action = (action or "").lower()
        if not action:
            return await ctx.send("Usage: `!maze help`, `!maze start`, `!maze status`, or `!maze ping 20%`")
        
        if action == "help":
            return await ctx.invoke(self.bot.get_command("help"), topic="maze")

        # `status` is informational, so members may use it. Everything else
        # changes shared server state and stays staff-only.
        if action != "status" and not is_staff_member(ctx.author):
            return await ctx.send("❌ You must be an Admin or Staff to use Maze commands.")

        if action == "status":
            try:
                res = await asyncio.to_thread(supabase.table("maze_schedules").select("*").eq("guild_id", ctx.guild.id).execute)
                if not res.data: return await ctx.send("ℹ️ No Maze event scheduled.")
                
                row = res.data[0]
                start = to_utc(row.get("event_start"))
                end = to_utc(row.get("event_end"))
                
                start_str = f"<t:{int(start.timestamp())}:F>" if start else "Not set"
                end_str = f"<t:{int(end.timestamp())}:F>" if end else "Not set"

                embed = discord.Embed(title="🗺️ Maze Event Status", color=discord.Color.purple())
                embed.add_field(name="Type", value=row.get("maze_type", "7d").upper(), inline=True)
                embed.add_field(name="Starts", value=start_str, inline=True)
                embed.add_field(name="Ends", value=end_str, inline=True)
                embed.add_field(name="Pings Enabled", value=str(row.get("ping_enabled_global", True)), inline=True)
                await ctx.send(embed=embed)
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")

        elif action in ("stop", "cancel", "clear"):
            try:
                await asyncio.to_thread(supabase.table("maze_schedules").delete().eq("guild_id", ctx.guild.id).execute)
                self._cancel(ctx.guild.id)
                await ctx.send("🛑 Maze schedule and all pending discount pings have been cancelled.")
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")

        elif action == "start":
            duration = (arg1 or "").lower()
            time_input = (arg2 or "").strip()

            if duration not in ("3d", "7d") or not time_input:
                return await ctx.send("❌ Usage: `!maze start <3d|7d> <time>`\n*Time can be remaining time (`6d12h`) or a date (`05/11`).*")

            now = datetime.now(timezone.utc)
            
            if "d" in time_input or "h" in time_input:
                regex = re.compile(r'((?P<days>\d+?)d)?((?P<hours>\d+?)h)?')
                parts = regex.fullmatch(time_input.lower().replace(" ", ""))
                if not parts: return await ctx.send("❌ Invalid time format. Use `6d12h`.")
                
                td_args = {k: int(v) for k, v in parts.groupdict().items() if v}
                end_time = now + timedelta(**td_args)
                days = 3 if duration == "3d" else 7
                start_time = end_time - timedelta(days=days)
            else:
                m = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}))?", time_input)
                if not m:
                    return await ctx.send("❌ Invalid date format. Use `DD/MM` (e.g., `05/11`).")
                day, month = int(m.group(1)), int(m.group(2))
                year = int(m.group(3)) if m.group(3) else now.year
                try:
                    start_time = datetime(year, month, day, 11, 0, tzinfo=timezone.utc)
                except ValueError:
                    return await ctx.send("❌ That date doesn't exist. Use `DD/MM` (e.g., `05/11`).")

                days = 3 if duration == "3d" else 7
                end_time = start_time + timedelta(days=days)

                # If the event has already passed entirely, roll to next year
                if end_time < now:
                    try:
                        start_time = start_time.replace(year=start_time.year + 1)
                    except ValueError:  # 29 Feb -> next year isn't a leap year
                        start_time = start_time.replace(year=start_time.year + 1, day=28)
                    end_time = start_time + timedelta(days=days)

            try:
                await asyncio.to_thread(
                    supabase.table("maze_schedules").upsert({
                        "guild_id": ctx.guild.id,
                        "event_start": start_time.isoformat(),
                        "event_end": end_time.isoformat(),
                        "maze_type": duration,
                        "channel_id": ctx.channel.id,
                        "ping_enabled_global": True
                    }, on_conflict="guild_id").execute
                )
            except Exception as e:
                return await ctx.send(f"❌ Database error: {e}")

            # Reload from the database so both this command and the periodic sync
            # agree on the timers.
            await self.restore_schedules()

            embed = discord.Embed(title="🗺️ Maze Event Scheduled", color=discord.Color.purple())
            embed.add_field(name="Duration", value=f"{duration.upper()}", inline=True)
            embed.add_field(name="Starts", value=f"<t:{int(start_time.timestamp())}:F>", inline=True)
            embed.add_field(name="Ends", value=f"<t:{int(end_time.timestamp())}:F>", inline=True)
            await ctx.send(embed=embed)

        elif action == "ping":
            raw = (arg1 or "") + (arg2 or "")
            m = re.fullmatch(r"(\d{1,3})%", raw)
            
            if not m or not (1 <= int(m.group(1)) <= 100):
                return await ctx.send("❌ Use a percentage from 1–100, e.g. `!maze ping 20%`")

            # INDENTATION FIXED HERE
            me = ctx.guild.me
            if not me or not ctx.channel.permissions_for(me).mention_everyone:
                return await ctx.send("❌ I lack the 'Mention @everyone' permission in this channel.")

            embed = discord.Embed(
                title="🗺️ Maze Island Discount!",
                description=f"🚨 **{m.group(1)}% Discount is live right now!**\n\nSpend your Maze Coins!",
                color=discord.Color.purple()
            )
            await ctx.send(content="@everyone", embed=embed, allowed_mentions=discord.AllowedMentions(everyone=True))
            
        else:
            await ctx.send("❌ Unknown action. Use `start`, `status`, `stop`, or `ping`.")

async def setup(bot):
    await bot.add_cog(MazeTracker(bot))
