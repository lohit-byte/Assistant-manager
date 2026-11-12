"""Maze Island alerts.

One shared maze event (`maze_events`) drives the discount pings of every
server: the in-game monthly calendar predicts it, the first staff member who
sees the maze countdown corrects it, and the bot fans the alerts out to every
server that subscribed on the Maze dashboard page.  `maze_schedules` is now
only the per-server subscription (channel, mention mode, on/off, dedupe).

Why one shared event: the discounts hang off the event start (+5 h, +24 h,
+72 h, ...), so a wrong start is wrong for everyone and a corrected start must
reach everyone in one step.  That is also what makes "one server notices it,
everybody gets pinged" true.
"""

import asyncio
import os
import re
from datetime import datetime, timedelta, timezone

import discord
from discord.ext import commands

from database import check_premium_status, ensure_user, is_staff_member, supabase
from maze_timing import (
    MAZE_DURATION,
    WINDOWS_7D,
    current_window,
    derive_event_start,
    parse_remaining,
    parse_start_date,
    parse_windows,
    parse_windows_spec,
    upcoming_windows,
    validate_windows,
    windows_to_fire,
)

# The platform owner may edit the shared calendar.  Same account that bypasses
# the premium gate in main.py; MAZE_ADMIN_IDS overrides it with a CSV list.
PLATFORM_ADMIN_IDS = {
    int(part)
    for part in (os.getenv("MAZE_ADMIN_IDS") or "704623764008075284").replace(" ", "").split(",")
    if part.isdigit()
}

USAGE = (
    "Usage: `!maze help`, `!maze status`, `!maze alerts`, "
    "`!maze start 7d 6d12h`, `!maze ping 20%`"
)

STATUS_LABEL = {
    "scheduled": "predicted (from the calendar)",
    "confirmed": "confirmed in game",
    "cancelled": "cancelled",
}


def to_utc(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def stamp(value: datetime | None) -> str:
    return f"<t:{int(value.timestamp())}:F>" if value else "Not set"


class MazeTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.timers: dict[int, list[asyncio.Task]] = {}
        self.signatures: dict[int, tuple] = {}
        self._sync_task: asyncio.Task | None = None
        self._ping_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._warned: set[str] = set()

    def _warn_once(self, key: str, message: str):
        """Log a setup problem once instead of on every 20 s / 60 s tick."""
        if key in self._warned:
            return
        self._warned.add(key)
        print(message)

    async def cog_load(self):
        self._sync_task = asyncio.create_task(self._sync_loop())
        self._ping_task = asyncio.create_task(self._ping_loop())

    def cog_unload(self):
        for task in (self._sync_task, self._ping_task):
            if task:
                task.cancel()
        for guild_id in list(self.timers):
            self._cancel(guild_id)

    # ------------------------------------------------------------------ state

    async def _fetch_event(self):
        """The live maze, or the next one on the shared calendar."""
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
        try:
            res = await asyncio.to_thread(
                lambda: supabase.table("maze_events")
                .select("*")
                .gte("event_end", cutoff)
                .neq("status", "cancelled")
                .order("event_start")
                .limit(1)
                .execute()
            )
        except Exception as exc:
            # A deploy can land before shared/schema.sql creates maze_events.
            self._warn_once("event", f"Maze event lookup failed: {exc!r}")
            return None
        return res.data[0] if res.data else None

    async def _fetch_events(self, limit=10):
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
        try:
            res = await asyncio.to_thread(
                lambda: supabase.table("maze_events")
                .select("*")
                .gte("event_end", cutoff)
                .neq("status", "cancelled")
                .order("event_start")
                .limit(limit)
                .execute()
            )
        except Exception as exc:
            self._warn_once("calendar", f"Maze calendar lookup failed: {exc!r}")
            return []
        return res.data

    async def _fetch_windows(self):
        """The edited discount ladder, or None to use the built-in one."""
        try:
            res = await asyncio.to_thread(
                lambda: supabase.table("maze_settings")
                .select("windows")
                .eq("id", 1)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            self._warn_once("settings", f"Maze settings lookup failed: {exc!r}")
            return None
        row = res.data[0] if res.data else None
        spec = parse_windows(row.get("windows")) if row else None
        if spec is None:
            return None
        problem = validate_windows(spec)
        if problem:
            print(f"Ignoring the edited maze schedule ({problem}); using the built-in one.")
            return None
        return spec

    async def _fetch_subscriptions(self):
        res = await asyncio.to_thread(
            lambda: supabase.table("maze_schedules").select("*").execute()
        )
        return res.data

    async def _resolve_channel(self, row):
        """Ping channel: the server's maze channel, else the guild system channel."""
        channel = self.bot.get_channel(row.get("channel_id")) if row.get("channel_id") else None
        if channel:
            return channel
        guild = self.bot.get_guild(row.get("guild_id"))
        if not guild:
            return None
        configured = None
        try:
            res = await asyncio.to_thread(
                lambda: supabase.table("guilds")
                .select("maze_channel_id")
                .eq("guild_id", row["guild_id"])
                .limit(1)
                .execute()
            )
            configured = res.data[0].get("maze_channel_id") if res.data else None
        except Exception:
            configured = None
        return guild.get_channel(configured) if configured else guild.system_channel

    # -------------------------------------------------------------- scheduler

    async def _ping_loop(self):
        """Drain dashboard "ping now" requests; Discord already pings instantly."""
        await self.bot.wait_until_ready()
        while True:
            try:
                await self._drain_manual_pings()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"Maze manual ping drain failed: {exc!r}")
            await asyncio.sleep(20)

    async def _drain_manual_pings(self):
        try:
            res = await asyncio.to_thread(
                lambda: supabase.table("maze_pings")
                .select("*")
                .order("created_at")
                .limit(5)
                .execute()
            )
        except Exception as exc:
            self._warn_once("ping-queue", f"Maze ping queue lookup failed: {exc!r}")
            return
        for row in res.data:
            try:
                await self._send_manual_ping(row.get("guild_id"), row.get("percent") or "10%")
            except Exception as exc:
                print(f"Manual maze ping failed: {exc!r}")
            ping_id = row.get("id")
            try:
                await asyncio.to_thread(
                    lambda ping_id=ping_id: supabase.table("maze_pings")
                    .delete()
                    .eq("id", ping_id)
                    .execute()
                )
            except Exception as exc:
                print(f"Maze ping cleanup failed: {exc!r}")

    async def _send_manual_ping(self, guild_id, percent):
        try:
            res = await asyncio.to_thread(
                supabase.table("maze_schedules")
                .select("*")
                .eq("guild_id", guild_id)
                .limit(1)
                .execute
            )
        except Exception as exc:
            print(f"Manual maze ping lookup failed for {guild_id}: {exc!r}")
            return
        row = res.data[0] if res.data else None
        if not row or row.get("ping_enabled_global") is False:
            return
        if not await asyncio.to_thread(check_premium_status, guild_id):
            return
        channel = await self._resolve_channel(row)
        if not channel:
            return
        event = await self._fetch_event()
        ends_at = to_utc(event.get("event_end")) if event else None
        if await self._deliver(channel, row, self._discount_embed(percent, ends_at)):
            await self._dm_alert_players(guild_id, percent, ends_at or datetime.now(timezone.utc))

    async def _sync_loop(self):
        await self.bot.wait_until_ready()
        while True:
            try:
                await self.sync()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"Maze sync failed: {exc!r}")
            await asyncio.sleep(60)

    async def sync(self):
        """Re-arm every server's timers from the shared event and its settings."""
        async with self._lock:
            event = await self._fetch_event()
            spec = await self._fetch_windows() or WINDOWS_7D
            rows = await self._fetch_subscriptions()
            seen = set()

            for row in rows:
                guild_id = row.get("guild_id")
                seen.add(guild_id)
                try:
                    channel = await self._resolve_channel(row)
                    signature = self._signature(event, row, channel, spec)
                    if signature == self.signatures.get(guild_id):
                        continue  # nothing changed -> keep the existing timers
                    self._cancel(guild_id)
                    self.signatures[guild_id] = signature
                    if not event or not channel or row.get("ping_enabled_global") is False:
                        continue
                    self._arm(guild_id, channel, event, spec)
                except Exception as exc:
                    print(f"Maze subscription {guild_id} failed: {exc!r}")

            # A dashboard delete/removal drops the row: drop its leftover timers.
            for guild_id in list(self.timers):
                if guild_id not in seen:
                    self._cancel(guild_id)
                    self.signatures.pop(guild_id, None)

    @staticmethod
    def _signature(event, row, channel, spec):
        return (
            (event or {}).get("id"),
            (event or {}).get("event_start"),
            getattr(channel, "id", None),
            row.get("ping_enabled_global"),
            row.get("ping_mention"),
            row.get("ping_role_id"),
            repr(spec),
        )

    def _cancel(self, guild_id):
        for task in self.timers.pop(guild_id, []):
            task.cancel()

    def _arm(self, guild_id, channel, event, spec):
        start = to_utc(event.get("event_start"))
        if not start:
            return
        self.timers[guild_id] = [
            asyncio.create_task(self._fire(guild_id, channel, window, delay, event))
            for window, delay in windows_to_fire(start, datetime.now(timezone.utc), spec)
        ]

    async def _fire(self, guild_id, channel, window, delay, event):
        if delay > 0:
            await asyncio.sleep(delay)

        # The event may have been corrected, the server may have turned alerts
        # off, or a restart may have already sent this discount.
        try:
            event_res, row_res = await asyncio.gather(
                asyncio.to_thread(
                    lambda: supabase.table("maze_events")
                    .select("id,event_start")
                    .eq("id", event["id"])
                    .limit(1)
                    .execute()
                ),
                asyncio.to_thread(
                    lambda: supabase.table("maze_schedules")
                    .select("ping_enabled_global,ping_mention,ping_role_id,sent_pings")
                    .eq("guild_id", guild_id)
                    .limit(1)
                    .execute()
                ),
            )
        except Exception as exc:
            print(f"Maze ping check failed for {guild_id}: {exc!r}")
            return

        current = event_res.data[0] if event_res.data else None
        if not current or to_utc(current.get("event_start")) != to_utc(event.get("event_start")):
            return  # corrected while we slept; the sync loop owns the new timers

        row = row_res.data[0] if row_res.data else None
        if not row or row.get("ping_enabled_global") is False:
            return
        # Scheduled pings are not commands, so the command-level premium gate in
        # main.py never sees them; an expired server must stay paused.
        if not await asyncio.to_thread(check_premium_status, guild_id):
            return

        key = window.key()
        if key in (row.get("sent_pings") or []):
            return

        event_start = to_utc(event.get("event_start"))
        opening = event_start is not None and window.start <= event_start
        delivered = await self._deliver(
            channel, row, self._discount_embed(window.percent, window.end, opening)
        )

        if delivered:
            try:
                seen = list(row.get("sent_pings") or []) + [key]
                await asyncio.to_thread(
                    supabase.table("maze_schedules")
                    .update({"sent_pings": seen[-50:]})
                    .eq("guild_id", guild_id)
                    .execute
                )
            except Exception as exc:
                print(f"Maze ping bookkeeping failed in {guild_id}: {exc!r}")

        await self._dm_alert_players(guild_id, window.percent, window.end)

    def _discount_embed(self, percent, window_end, opening=False):
        if window_end is None:
            headline = f"🚨 **{percent} off moves is live right now.**"
        elif opening:
            headline = (
                f"**Maze Island is live** — the opening {percent} move discount runs until "
                f"<t:{int(window_end.timestamp())}:t>."
            )
        else:
            headline = f"**{percent} off moves** until <t:{int(window_end.timestamp())}:t>."
        return discord.Embed(
            title="🗺️ Maze Island discount!",
            description=f"{headline}\n\nSpend your Maze Coins before it ends.",
            color=discord.Color.purple(),
        )

    async def _deliver(self, channel, row, embed):
        content, allowed = self._mention_payload(
            channel,
            (row.get("ping_mention") or "here").lower(),
            row.get("ping_role_id"),
        )
        try:
            if content:
                await channel.send(content=content, embed=embed, allowed_mentions=allowed)
            else:
                await channel.send(embed=embed)
            return True
        except (discord.HTTPException, AttributeError, TypeError) as exc:
            print(f"Maze ping failed in {channel}: {exc!r}")
            return False

    def _mention_payload(self, channel, mode, role_id=None):
        me = getattr(getattr(channel, "guild", None), "me", None)
        can_mention = bool(me and channel.permissions_for(me).mention_everyone)
        if mode == "everyone" and can_mention:
            return "@everyone", discord.AllowedMentions(everyone=True)
        if mode == "here" and can_mention:
            return "@here", discord.AllowedMentions(everyone=True)
        if mode == "role" and role_id:
            return f"<@&{role_id}>", discord.AllowedMentions(roles=True)
        return None, discord.AllowedMentions.none()

    # ------------------------------------------------------------ player DMs

    async def _get_alert_mode(self, guild_id, discord_id):
        try:
            res = await asyncio.to_thread(
                supabase.table("player_ping_settings")
                .select("maze_alert_mode")
                .eq("guild_id", guild_id)
                .eq("discord_id", discord_id)
                .limit(1)
                .execute
            )
            if res.data:
                return res.data[0].get("maze_alert_mode") or "here"
        except Exception as exc:
            print(f"Maze alert preference lookup failed: {exc!r}")
        return "here"

    async def _alert_count(self, guild_id):
        try:
            res = await asyncio.to_thread(
                supabase.table("player_ping_settings")
                .select("discord_id")
                .eq("guild_id", guild_id)
                .eq("maze_alert_mode", "dm")
                .execute
            )
            return len(res.data)
        except Exception:
            return 0

    async def _dm_alert_players(self, guild_id, percent, ends_at):
        try:
            res = await asyncio.to_thread(
                supabase.table("player_ping_settings")
                .select("discord_id")
                .eq("guild_id", guild_id)
                .eq("maze_alert_mode", "dm")
                .limit(1000)
                .execute
            )
        except Exception as exc:
            print(f"Maze DM alert lookup failed: {exc!r}")
            return
        guild = self.bot.get_guild(guild_id)
        guild_name = getattr(guild, "name", "your server")
        end_ts = int(ends_at.timestamp())
        for row in res.data:
            discord_id = row.get("discord_id")
            user = guild.get_member(discord_id) if guild and discord_id else None
            if user is None:
                try:
                    user = self.bot.get_user(discord_id)
                except Exception:
                    user = None
            if user is None:
                continue
            try:
                await user.send(
                    embed=discord.Embed(
                        title="🗺️ Maze discount — DM alert",
                        description=(
                            f"**{percent} off moves** is live in **{guild_name}** "
                            f"until <t:{end_ts}:t>."
                        ),
                        color=discord.Color.purple(),
                    )
                )
                await asyncio.sleep(0.5)
            except (discord.HTTPException, AttributeError, TypeError):
                pass

    # --------------------------------------------------------- subscriptions

    async def _ensure_subscription(self, ctx, enabled=True):
        """Make sure this server has an alert row, keeping an existing channel."""
        try:
            res = await asyncio.to_thread(
                supabase.table("maze_schedules")
                .select("guild_id,channel_id")
                .eq("guild_id", ctx.guild.id)
                .limit(1)
                .execute
            )
            if res.data:
                patch = {"ping_enabled_global": enabled}
                if not res.data[0].get("channel_id"):
                    patch["channel_id"] = ctx.channel.id
                await asyncio.to_thread(
                    supabase.table("maze_schedules")
                    .update(patch)
                    .eq("guild_id", ctx.guild.id)
                    .execute
                )
            else:
                await asyncio.to_thread(
                    supabase.table("maze_schedules")
                    .insert(
                        {
                            "guild_id": ctx.guild.id,
                            "channel_id": ctx.channel.id,
                            "ping_enabled_global": enabled,
                        }
                    )
                    .execute
                )
        except Exception as exc:
            print(f"Maze subscription update failed for {ctx.guild.id}: {exc!r}")

    async def _confirm_event(self, start, end, guild_id=None, user_id=None):
        """Create or correct the shared event closest to ``start``."""
        window = timedelta(hours=24)
        try:
            res = await asyncio.to_thread(
                supabase.table("maze_events")
                .select("*")
                .gte("event_start", (start - window).isoformat())
                .lte("event_start", (start + window).isoformat())
                .neq("status", "cancelled")
                .execute
            )
            nearby = res.data or []
            payload = {
                "event_start": start.isoformat(),
                "event_end": end.isoformat(),
                "status": "confirmed",
                "source": "report",
                "confirmed_by_guild": guild_id,
                "confirmed_by_user": user_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if nearby:
                existing = min(
                    nearby, key=lambda row: abs(to_utc(row["event_start"]) - start)
                )
                moved = abs((to_utc(existing["event_start"]) - start).total_seconds()) > 60
                await asyncio.to_thread(
                    supabase.table("maze_events")
                    .update(payload)
                    .eq("id", existing["id"])
                    .execute
                )
                return {**existing, **payload}, moved

            payload["maze_type"] = "7d"
            created = await asyncio.to_thread(
                supabase.table("maze_events").insert(payload).execute
            )
            return created.data[0], False
        except Exception as exc:
            print(f"Maze event confirm failed: {exc!r}")
            return None, False

    # --------------------------------------------------------------- replies

    @staticmethod
    def _timeline_lines(event_start, limit=3, mark_current=True):
        now = datetime.now(timezone.utc)
        lines = []
        live = current_window(event_start, now) if mark_current else None
        if live:
            lines.append(
                f"▪ **{live.percent}** live now, until <t:{int(live.end.timestamp())}:t>"
            )
        for window in upcoming_windows(event_start, now)[:limit]:
            lines.append(
                f"▪ **{window.percent}** <t:{int(window.start.timestamp())}:R> "
                f"(<t:{int(window.start.timestamp())}:t> → <t:{int(window.end.timestamp())}:t>)"
            )
        return lines or ["No more discounts this maze."]

    def _event_embed(self, event):
        start = to_utc(event.get("event_start"))
        end = to_utc(event.get("event_end"))
        embed = discord.Embed(title="🗺️ Maze Island", color=discord.Color.purple())
        embed.add_field(name="Starts", value=stamp(start), inline=True)
        embed.add_field(name="Ends", value=stamp(end), inline=True)
        embed.add_field(
            name="Schedule", value=STATUS_LABEL.get(event.get("status"), event.get("status")), inline=True
        )
        if start:
            embed.add_field(
                name="Discounts", value="\n".join(self._timeline_lines(start)), inline=False
            )
        if event.get("confirmed_by_guild"):
            embed.set_footer(
                text=f"Confirmed by server {event['confirmed_by_guild']} · shared by every server"
            )
        return embed

    # -------------------------------------------------------------- commands

    async def show_help(self, ctx):
        is_staff = await is_staff_member(ctx.author)
        embed = discord.Embed(title="🗺️ Maze Commands", color=discord.Color.purple())
        embed.add_field(
            name="Everyone",
            value=(
                "`!maze status` — maze, discounts and this server's alert settings\n"
                "`!maze alerts` — show your alert preference\n"
                "`!maze alerts here|dm|off` — channel @here (default), DM, or off"
            ),
            inline=False,
        )
        if is_staff:
            embed.add_field(
                name="Staff",
                value=(
                    "`!maze start 7d 6d21h47m` — paste the in-game countdown; corrects the shared "
                    "schedule for every server\n"
                    "`!maze start 7d 05/11` — set the start date instead\n"
                    "`!maze stop` — turn this server's alerts off\n"
                    "`!maze windows` — the discount schedule (staff can edit it)\n"
                    "`!maze windows set 0-5:50 5-13:20 24-36:10 ...` — change it for every server\n"
                    "`!maze windows reset` — back to the built-in schedule\n"
                    "`!maze set ping here|everyone|role @role|none`\n"
                    "`!maze ping 20%` — manual discount ping"
                ),
                inline=False,
            )
        if ctx.author.id in PLATFORM_ADMIN_IDS:
            embed.add_field(
                name="Platform owner",
                value=(
                    "`!maze cal` — the shared calendar\n"
                    "`!maze cal add 05/11` — add a predicted maze\n"
                    "`!maze cal rm 05/11` — remove one"
                ),
                inline=False,
            )
        await ctx.send(embed=embed)

    async def windows_command(self, ctx, action, spec_text):
        action = (action or "").lower()
        stored = await self._fetch_windows()
        spec = stored or WINDOWS_7D

        if action in ("", "show", "list"):
            event = await self._fetch_event()
            start = to_utc(event.get("event_start")) if event else None
            lines = []
            for start_h, end_h, percent in spec:
                line = f"`{start_h:>3}h → {end_h:>3}h` **{percent}**"
                if start:
                    line += (
                        f" · {stamp(start + timedelta(hours=start_h))} → "
                        f"{stamp(start + timedelta(hours=end_h))}"
                    )
                lines.append(line)
            embed = discord.Embed(
                title="🗺️ Maze discount schedule",
                description="\n".join(lines),
                color=discord.Color.purple(),
            )
            embed.set_footer(
                text=(
                    "Edited schedule — staff can change it again with !maze windows set ..."
                    if stored
                    else "Built-in schedule (from the 5–12 Nov 2026 maze)"
                )
            )
            return await ctx.send(embed=embed)

        if not await is_staff_member(ctx.author):
            return await ctx.send("❌ You must be an Admin or Staff to edit the maze schedule.")

        if action in ("reset", "default", "clear"):
            return await self._save_windows(ctx, None)

        if action in ("set", "edit"):
            edited = parse_windows_spec(spec_text)
            if not edited:
                return await ctx.send(
                    "❌ Usage: `!maze windows set 0-5:50 5-13:20 24-36:10 72-84:10 120-132:10 164-168:20`\n"
                    "*`(start hour)-(end hour):(discount)`, measured from the maze start.*"
                )
            problem = validate_windows(edited)
            if problem:
                return await ctx.send(f"❌ That schedule does not work: {problem}.")
            return await self._save_windows(ctx, edited)

        return await ctx.send(
            "Usage: `!maze windows`, `!maze windows set 0-5:50 5-13:20 ...`, `!maze windows reset`"
        )

    async def _save_windows(self, ctx, spec):
        payload = {
            "id": 1,
            "windows": [list(window) for window in spec] if spec else None,
            "updated_by": ctx.author.id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await asyncio.to_thread(
                supabase.table("maze_settings").upsert(payload, on_conflict="id").execute
            )
        except Exception as exc:
            return await ctx.send(f"❌ Database error: {exc}")
        await self.sync()
        if not spec:
            return await ctx.send(
                "↩️ Back to the built-in maze discount schedule. Every server re-armed."
            )
        lines = "\n".join(f"`{s:>3}h → {e:>3}h` **{p}**" for s, e, p in spec)
        await ctx.send(
            embed=discord.Embed(
                title="✅ Maze discount schedule saved",
                description=f"{lines}\n\nEvery server has been re-armed.",
                color=discord.Color.purple(),
            )
        )

    async def status(self, ctx):
        embed = discord.Embed(title="🗺️ Maze Island", color=discord.Color.purple())
        try:
            event = await self._fetch_event()
        except Exception as exc:
            return await ctx.send(f"❌ Database error: {exc}")

        if event:
            embed = self._event_embed(event)
        else:
            embed.description = (
                "No maze on the shared calendar yet.\n"
                "Staff: when the maze appears in game, run `!maze start 7d 6d21h47m` "
                "with the countdown you see."
            )

        try:
            res = await asyncio.to_thread(
                supabase.table("maze_schedules")
                .select("*")
                .eq("guild_id", ctx.guild.id)
                .limit(1)
                .execute
            )
            row = res.data[0] if res.data else None
        except Exception:
            row = None

        if row:
            mention = (row.get("ping_mention") or "here").lower()
            role_id = row.get("ping_role_id")
            mention_label = {
                "here": "@here",
                "everyone": "@everyone",
                "none": "no mention",
                "role": f"<@&{role_id}>" if role_id else "role (not set)",
            }.get(mention, mention)
            channel_id = row.get("channel_id")
            dm_count = await self._alert_count(ctx.guild.id)
            embed.add_field(
                name="This server",
                value=(
                    f"Alerts: {'on' if row.get('ping_enabled_global', True) else 'off'} · "
                    f"mention {mention_label} · "
                    f"{f'<#{channel_id}>' if channel_id else 'configured maze channel'}\n"
                    f"Players on DM alerts: {dm_count}"
                ),
                inline=False,
            )
        else:
            embed.add_field(
                name="This server",
                value="Alerts are off. Turn them on from the Maze page in the dashboard.",
                inline=False,
            )
        embed.set_footer(text="Players: !maze alerts here|dm|off · Staff: !maze start 7d <time left>")
        await ctx.send(embed=embed)

    async def alerts_command(self, ctx, mode):
        mode = (mode or "").strip().lower()
        if not mode:
            current = await self._get_alert_mode(ctx.guild.id, ctx.author.id)
            label = {"dm": "**DM alerts**", "off": "**off**", "here": "**channel @here**"}.get(
                current, f"**{current}**"
            )
            return await ctx.send(
                f"🔔 Maze alerts are {label} for you.\n"
                "Change with `!maze alerts here`, `!maze alerts dm` or `!maze alerts off`."
            )
        if mode not in ("here", "dm", "off"):
            return await ctx.send("❌ Use `!maze alerts here`, `!maze alerts dm` or `!maze alerts off`.")
        try:
            await asyncio.to_thread(ensure_user, ctx.author.id)
            await asyncio.to_thread(
                supabase.table("player_ping_settings")
                .upsert(
                    {
                        "guild_id": ctx.guild.id,
                        "discord_id": ctx.author.id,
                        "maze_alert_mode": mode,
                        "maze_pings_enabled": mode != "off",
                    },
                    on_conflict="guild_id,discord_id",
                )
                .execute
            )
        except Exception as exc:
            return await ctx.send(f"❌ Database error: {exc}")
        message = {
            "here": "🔔 Maze alerts set to **channel @here**.",
            "dm": "🔔 Maze alerts set to **DM** — I'll message you at every discount.",
            "off": "🔕 Maze alerts turned **off** for you.",
        }[mode]
        await ctx.send(message)

    async def set_ping(self, ctx, subaction, value):
        if (subaction or "").lower() != "ping":
            return await ctx.send("Usage: `!maze set ping here|everyone|role @role|none`")
        value = (value or "").strip()
        parts = value.split()
        mode = parts[0].lower() if parts else ""
        role_id = None
        if mode == "role":
            if ctx.message.role_mentions:
                role_id = ctx.message.role_mentions[0].id
            elif len(parts) > 1 and parts[1].isdigit():
                role_id = int(parts[1])
            if not role_id:
                return await ctx.send("❌ Mention the role to ping, e.g. `!maze set ping role @Maze Alerts`.")
        elif mode not in ("here", "everyone", "none"):
            return await ctx.send("Usage: `!maze set ping here|everyone|role @role|none`")
        try:
            await self._ensure_subscription(ctx)
            await asyncio.to_thread(
                supabase.table("maze_schedules")
                .update({"ping_mention": mode, "ping_role_id": role_id})
                .eq("guild_id", ctx.guild.id)
                .execute
            )
        except Exception as exc:
            return await ctx.send(f"❌ Database error: {exc}")
        suffix = f" (<@&{role_id}>)" if role_id else ""
        await ctx.send(f"✅ Maze ping mention set to **{mode}**{suffix}.")
        await self.sync()

    async def start_event(self, ctx, duration, time_input):
        # `!maze start 7d 6d12h` and `!maze start 6d12h` both work.
        first = (duration or "").strip().lower()
        if first == "3d":
            return await ctx.send("❌ Maze Island is a 7-day event. Use `!maze start 7d <time left>`.")
        if first == "7d":
            time_input = (time_input or "").strip()
        else:
            time_input = f"{duration or ''} {time_input or ''}".strip()
        if not time_input:
            return await ctx.send(
                "❌ Usage: `!maze start 7d <time left>`\n"
                "*Time left as shown in game (`6d21h47m`) or a start date (`05/11`).*"
            )

        now = datetime.now(timezone.utc)
        from_countdown = any(unit in time_input.lower() for unit in ("d", "h", "m"))
        if from_countdown:
            remaining = parse_remaining(time_input)
            if not remaining or not (timedelta(0) < remaining <= MAZE_DURATION + timedelta(hours=1)):
                return await ctx.send("❌ Paste the countdown from the game, e.g. `6d21h47m`.")
            start = derive_event_start(now, remaining)
        else:
            start = parse_start_date(time_input, now)
            if not start:
                return await ctx.send("❌ Invalid date. Use `DD/MM`, e.g. `05/11`.")
        end = start + MAZE_DURATION

        event, moved = await self._confirm_event(start, end, ctx.guild.id, ctx.author.id)
        if not event:
            return await ctx.send("❌ Could not save the maze event. Try again in a moment.")

        await self._ensure_subscription(ctx)
        await self.sync()

        embed = self._event_embed(event)
        if moved:
            embed.title = "🗺️ Maze schedule corrected"
            embed.description = (
                "The shared schedule moved — every server has been re-armed with the new times."
            )
        await ctx.send(embed=embed)

    async def stop_event(self, ctx):
        try:
            res = await asyncio.to_thread(
                supabase.table("maze_schedules")
                .select("guild_id")
                .eq("guild_id", ctx.guild.id)
                .limit(1)
                .execute
            )
            if res.data:
                await asyncio.to_thread(
                    supabase.table("maze_schedules")
                    .update({"ping_enabled_global": False})
                    .eq("guild_id", ctx.guild.id)
                    .execute
                )
            else:
                await self._ensure_subscription(ctx, enabled=False)
        except Exception as exc:
            return await ctx.send(f"❌ Database error: {exc}")
        self._cancel(ctx.guild.id)
        self.signatures.pop(ctx.guild.id, None)
        await ctx.send(
            "🔕 Maze alerts are off for this server. Run `!maze start 7d <time left>` or use the "
            "dashboard to turn them back on."
        )

    async def calendar_command(self, ctx, action, arg):
        if ctx.author.id not in PLATFORM_ADMIN_IDS:
            return await ctx.send("❌ Only the platform owner can edit the maze calendar.")
        action = (action or "list").lower()

        if action == "list":
            events = await self._fetch_events(limit=10)
            if not events:
                return await ctx.send("ℹ️ The shared maze calendar is empty.")
            embed = discord.Embed(
                title="🗺️ Maze calendar", color=discord.Color.purple()
            )
            for event in events:
                start = to_utc(event.get("event_start"))
                embed.add_field(
                    name=f"<t:{int(start.timestamp())}:D>",
                    value=(
                        f"<t:{int(start.timestamp())}:F> → "
                        f"<t:{int(to_utc(event['event_end']).timestamp())}:F>\n"
                        f"{STATUS_LABEL.get(event.get('status'), event.get('status'))}"
                    ),
                    inline=False,
                )
            return await ctx.send(embed=embed)

        if action == "add":
            start = parse_start_date(arg or "", datetime.now(timezone.utc))
            if not start:
                return await ctx.send("❌ Usage: `!maze cal add 05/11` (start date, 11:00 UTC).")
            end = start + MAZE_DURATION
            payload = {
                "event_start": start.isoformat(),
                "event_end": end.isoformat(),
                "maze_type": "7d",
                "status": "scheduled",
                "source": "calendar",
            }
            try:
                # Select-then-write: the live table has no unique index on event_start,
                # and re-adding a confirmed date must not demote it to "scheduled".
                existing = await asyncio.to_thread(
                    supabase.table("maze_events")
                    .select("id,status")
                    .eq("event_start", start.isoformat())
                    .limit(1)
                    .execute
                )
                row = existing.data[0] if existing.data else None
                if row and row.get("status") == "confirmed":
                    return await ctx.send(
                        f"ℹ️ {stamp(start)} is already confirmed in game — nothing to add."
                    )
                if row:
                    await asyncio.to_thread(
                        supabase.table("maze_events")
                        .update(payload)
                        .eq("id", row["id"])
                        .execute
                    )
                else:
                    await asyncio.to_thread(
                        supabase.table("maze_events").insert(payload).execute
                    )
            except Exception as exc:
                return await ctx.send(f"❌ Database error: {exc}")
            await self.sync()
            return await ctx.send(
                f"🗓️ Added a predicted maze: {stamp(start)} → {stamp(end)}. Alerts are armed."
            )

        if action == "rm":
            target = parse_start_date(arg or "", datetime.now(timezone.utc))
            events = await self._fetch_events(limit=20)
            if not events:
                return await ctx.send("ℹ️ The shared maze calendar is empty.")
            if target:
                event = min(
                    events, key=lambda row: abs(to_utc(row["event_start"]) - target)
                )
            else:
                event = events[0]
            try:
                await asyncio.to_thread(
                    supabase.table("maze_events")
                    .update({"status": "cancelled"})
                    .eq("id", event["id"])
                    .execute
                )
            except Exception as exc:
                return await ctx.send(f"❌ Database error: {exc}")
            await self.sync()
            return await ctx.send(
                f"🛑 Removed the maze starting {stamp(to_utc(event.get('event_start')))}."
            )

        await ctx.send("Usage: `!maze cal`, `!maze cal add 05/11`, `!maze cal rm 05/11`")

    async def manual_ping(self, ctx, raw):
        raw = (raw or "").replace(" ", "")
        match = re.fullmatch(r"(\d{1,3})%", raw)
        if not match or not (1 <= int(match.group(1)) <= 100):
            return await ctx.send("❌ Use a percentage from 1–100, e.g. `!maze ping 20%`")

        try:
            res = await asyncio.to_thread(
                supabase.table("maze_schedules")
                .select("ping_mention,ping_role_id")
                .eq("guild_id", ctx.guild.id)
                .limit(1)
                .execute
            )
            row = res.data[0] if res.data else {}
        except Exception:
            row = {}
        content, allowed = self._mention_payload(
            ctx.channel,
            (row.get("ping_mention") or "here").lower(),
            row.get("ping_role_id"),
        )
        event = await self._fetch_event()
        end = to_utc(event.get("event_end")) if event else None
        percent = f"{match.group(1)}%"
        description = f"🚨 **{percent} of move costs is live right now!**\n\nSpend your Maze Coins!"
        if end:
            description += f"\n\nMaze ends <t:{int(end.timestamp())}:R>."

        embed = discord.Embed(
            title="🗺️ Maze Island discount!",
            description=description,
            color=discord.Color.purple(),
        )
        if content:
            await ctx.send(content=content, embed=embed, allowed_mentions=allowed)
        else:
            await ctx.send(embed=embed)
        await self._dm_alert_players(ctx.guild.id, percent, end or datetime.now(timezone.utc))

    @commands.command(name="maze")
    @commands.guild_only()
    async def maze_group(self, ctx, action: str = None, arg1: str = None, *, arg2: str = None):
        action = (action or "").lower()
        if not action:
            return await ctx.send(USAGE)
        if action == "help":
            return await self.show_help(ctx)

        # Players manage their own alert preference; no staff needed.
        if action in ("alerts", "alert"):
            return await self.alerts_command(ctx, (arg1 or "").lower())

        if action == "status":
            return await self.status(ctx)

        if action in ("cal", "calendar"):
            return await self.calendar_command(ctx, arg1, arg2)

        if action in ("windows", "window", "schedule"):
            return await self.windows_command(ctx, arg1, arg2)

        if action == "start":
            if not await is_staff_member(ctx.author):
                return await ctx.send("❌ You must be an Admin or Staff to confirm the maze.")
            return await self.start_event(ctx, arg1, arg2)

        if not await is_staff_member(ctx.author):
            return await ctx.send("❌ You must be an Admin or Staff to use Maze commands.")

        if action == "set":
            return await self.set_ping(ctx, arg1, arg2)

        if action in ("stop", "off"):
            return await self.stop_event(ctx)

        if action == "ping":
            return await self.manual_ping(ctx, (arg1 or "") + (arg2 or ""))

        await ctx.send("❌ Unknown action. Use `start`, `status`, `stop`, `ping`, `alerts`, `cal` or `set`.")


async def setup(bot):
    await bot.add_cog(MazeTracker(bot))
