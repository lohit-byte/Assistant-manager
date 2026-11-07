import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
import asyncio
from collections import defaultdict
from database import supabase, check_premium_status

# --- CONSTANTS ---
DEFENCE = ("defence", "defense")
PHASE = timedelta(hours=24)
WAR = timedelta(hours=48)
DONE_RE = re.compile(r"\battacks?\s+done(?:\s+(\d+))?", re.I)

PING_EVENTS = [
    ("defence_start", timedelta(0), "🛡️ **DEFENCE PHASE HAS STARTED!**"),
    ("defence_30m", timedelta(hours=23, minutes=30), "⚠️ **Defence phase ends in 30 minutes!** Get defences up."),
    ("attack_start", timedelta(hours=24), "⚔️ **ATTACK PHASE HAS STARTED!**"),
    ("attack_12h", timedelta(hours=36), "⚔️ **Attack phase: 12 hours left!**"),
    ("attack_6h", timedelta(hours=42), "⚔️ **Attack phase: 6 hours left!**"),
    ("attack_3h", timedelta(hours=45), "⚔️ **Attack phase: 3 hours left!**"),
    ("attack_1h", timedelta(hours=47), "⚔️ **Attack phase: 1 hour left!**"),
    ("war_end", timedelta(hours=48), "🏁 **The 48-hour war has ended!**")
]

# --- HELPERS ---
def parse_time(time_str):
    regex = re.compile(r'((?P<hours>\d+?)h)?((?P<minutes>\d+?)m)?')
    parts = regex.fullmatch(time_str.lower().replace(" ", ""))
    if not parts: return None
    time_params = {name: int(param) for name, param in parts.groupdict().items() if param}
    if not time_params: return None
    td = timedelta(**time_params)
    return td if td > timedelta(0) else None

def to_utc(s: str) -> datetime:
    if not s: return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

def join_names(items, limit=1000):
    text = ", ".join(i["name"] for i in items)
    return text if len(text) <= limit else text[:limit - 3] + "..."

def progress_bar(current, total, length=20):
    if total == 0: return "░" * length
    fraction = max(0.0, min(1.0, current / total)) 
    filled = int(length * fraction)
    return "█" * filled + "░" * (length - filled)

def fmt_td(td):
    total_seconds = int(td.total_seconds())
    if total_seconds < 0: total_seconds = 0
    hours, remainder = divmod(total_seconds, 3600)
    minutes, _ = divmod(remainder, 60)
    return f"{hours}h {minutes}m"

def is_staff_member(m):
    p = m.guild_permissions
    return p.administrator or p.manage_guild

async def get_war(guild_id):
    res = await asyncio.to_thread(supabase.table("wars").select("*").eq("guild_id", guild_id).limit(1).execute)
    return res.data[0] if res.data else None

async def get_settings(guild_id):
    res = await asyncio.to_thread(supabase.table("war_settings").select("*").eq("guild_id", guild_id).limit(1).execute)
    return {"attacks_required": 6, "exempt_absent": True, **(res.data[0] if res.data else {})}

class WarTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.status_tasks = {}
        self.ping_tasks = {}
        self.done_replies = {}  
        self.locks = defaultdict(asyncio.Lock)

    async def cog_load(self):
        self.bot.loop.create_task(self.restore_events())

    def cog_unload(self):
        for t in [*self.status_tasks.values(), *self.ping_tasks.values()]:
            t.cancel()

    async def cog_command_error(self, ctx, error):
        if isinstance(error, commands.BadArgument):
            return await ctx.send("❌ Couldn't find that member. Mention them with @.")

    async def restore_events(self):
        await self.bot.wait_until_ready()
        try:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("is_active", True).execute)
            for war in res.data:
                if not war.get("war_start") or war.get("phase") == "ended": 
                    continue
                
                guild = self.bot.get_guild(war["guild_id"])
                channel = self.bot.get_channel(war.get("status_channel_id"))
                if not guild or not channel: continue
                
                start = to_utc(war["war_start"])
                now = datetime.now(timezone.utc)
                
                if start + WAR > now:
                    self.schedule_pings(war["guild_id"], channel, start)
                    if war.get("status_message_id"):
                        try:
                            msg = await channel.fetch_message(war["status_message_id"])
                            self.status_tasks[war["guild_id"]] = asyncio.create_task(
                                self.status_updater(war["guild_id"], msg)
                            )
                        except Exception: pass
                else:
                    await self.finish_war(war["guild_id"], channel)
        except Exception as e:
            print(f"Error restoring wars: {e}")

    # --- MAIN WAR COMMAND ---
    @commands.command(name="war")
    @commands.guild_only()
    async def war_group(self, ctx, action: str = None, subaction: str = None, *, args: str = None):
        action = (action or "").lower()
        
        if not action:
            return await ctx.send("Usage: `!war help` to see all commands.")

        if action == "help":
            return await self.show_help(ctx)
        if action == "status":
            return await self.show_status(ctx)
        if action == "missing":
            return await self.war_missing(ctx, subaction, args)
        if action in ("absent", "absence"):
            return await self.war_absent(ctx, subaction, args)
        if action == "report":
            return await self.war_report(ctx)
        if action in ("cancel", "reset"):
            return await self.cancel_war(ctx)
        if action in ("warning", "warn"):
            return await self.war_warning(ctx, subaction, args)
        if action == "attacks":
            return await self.war_attacks(ctx, args)
        if action == "check":
            return await self.war_check(ctx)
        if action == "set":
            if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
            if subaction == "attacks" and args and args.isdigit():
                await asyncio.to_thread(
                    supabase.table("war_settings").upsert({"guild_id": ctx.guild.id, "attacks_required": int(args)}, on_conflict="guild_id").execute
                )
                return await ctx.send(f"✅ Required attacks updated to **{args}**.")
            return await ctx.send("Usage: `!war set attacks <number>`")
            
        if action in ("defence", "defense", "attack"):
            if not is_staff_member(ctx.author):
                return await ctx.send("❌ You must be an Admin or Staff to use this command.")
            
            if subaction != "ends" or not args:
                return await ctx.send(f"Usage: `!war {action} ends <time>` (e.g., `!war {action} ends 24h`)")
                
            await self.start_timer(ctx, action, args)
        else:
            await ctx.send("❌ Unknown action. Use `!war help`.")

    async def start_timer(self, ctx, phase, time_str):
        td = parse_time(time_str)
        if not td: return await ctx.send("❌ Invalid time. Use `24h`, `12h30m`, etc.")
        if td > timedelta(hours=24): return await ctx.send("❌ Phase cannot exceed 24 hours.")

        # THE FIX: Use Discord's time, not the server's broken time
        now = ctx.message.created_at 
        
        end_time = now + td
        war_start = end_time - timedelta(hours=24 if phase in DEFENCE else 48)

        try:
            existing = await get_war(ctx.guild.id)
            continuing = phase == "attack" and existing and existing["is_active"]

            war_data = {
                "guild_id": ctx.guild.id,
                "war_start": war_start.isoformat(),
                "phase": phase,
                "is_active": True,
                "status_message_id": None,
                "status_channel_id": None,
            }
            if not continuing: 
                war_data["missing_list"] = []
                war_data["absent_list"] = []
                war_data["attack_counts"] = {}

            await asyncio.to_thread(supabase.table("wars").upsert(war_data, on_conflict="guild_id").execute)
            
            # Clean up old tasks
            if ctx.guild.id in self.status_tasks: self.status_tasks[ctx.guild.id].cancel()
            if ctx.guild.id in self.ping_tasks:
                for t in self.ping_tasks[ctx.guild.id]: t.cancel()
            
            # Send the initial status message
            # Check if a specific channel is set in the dashboard
            res = await asyncio.to_thread(supabase.table("guilds").select("war_channel_id").eq("guild_id", ctx.guild.id).execute)
            channel_id = res.data[0].get("war_channel_id") if res.data else None
            target_channel = self.bot.get_channel(channel_id) if channel_id else ctx.channel

            status_msg = await target_channel.send(embed=await self.build_status_embed(ctx.guild.id))
            await asyncio.to_thread(
                supabase.table("wars").update({"status_message_id": status_msg.id, "status_channel_id": ctx.channel.id}).eq("guild_id", ctx.guild.id).execute
            )
            
            # Start updater and pings
            self.status_tasks[ctx.guild.id] = asyncio.create_task(self.status_updater(ctx.guild.id, status_msg))
            self.schedule_pings(ctx.guild.id, ctx.channel, war_start)

        except Exception as e:
            await ctx.send(f"❌ Error: {e}")

    def schedule_pings(self, guild_id, channel, war_start):
        self.ping_tasks[guild_id] = []
        now = datetime.now(timezone.utc)
        for event_name, offset, message in PING_EVENTS:
            delay = (war_start + offset - now).total_seconds()
            if delay > 0:
                self.ping_tasks[guild_id].append(
                    asyncio.create_task(self.send_ping(delay, channel, message))
                )

    async def send_ping(self, delay, channel, message):
        await asyncio.sleep(delay)
        try:
            await channel.send(message)
        except discord.HTTPException:
            pass

    async def build_status_embed(self, guild_id):
        war = await get_war(guild_id)
        if not war or not war.get("is_active"): 
            return discord.Embed(title="No Active War", color=discord.Color.light_grey())
        
        start = to_utc(war["war_start"])
        now = datetime.now(timezone.utc)
        missing = war.get("missing_list") or []
        absent = war.get("absent_list") or []
        
        # Determine phase based on time
        if now < start + PHASE:
            phase = "DEFENCE PHASE"
            end = start + PHASE
            bar = progress_bar((now - start).total_seconds(), 86400)
            color = discord.Color.blue()
            desc = f"{bar}\n**Time left in defence:** {fmt_td(end - now)}\n**Defence ends:** <t:{int(end.timestamp())}:R>\n**Attack starts:** <t:{int(end.timestamp())}:R>\n**War ends:** <t:{int((start + WAR).timestamp())}:R>"
        else:
            phase = "ATTACK PHASE"
            end = start + WAR
            bar = progress_bar((now - (start + PHASE)).total_seconds(), 86400)
            color = discord.Color.red()
            desc = f"{bar}\n**Defence phase ended:** {fmt_td(now - (start + PHASE))} ago\n**Time left in attack:** {fmt_td(end - now)}\n**Attack ends:** <t:{int(end.timestamp())}:R>"

        # Calculate upcoming pings
        upcoming = [msg for name, off, msg in PING_EVENTS if start + off > now and name not in ("defence_start", "war_end")]
        pings_line = f"**{len(upcoming)} ping(s) remaining**\n" + "\n".join(f"• {msg.replace('⚠️ ', '').replace('⚔️ ', '')}" for msg in upcoming) if upcoming else "_All pings sent._"

        embed = discord.Embed(title=f"🛡️ {phase} — {guild_id}", color=color, description=desc)
        embed.add_field(name=f"⚠️ Missing Attacks ({len(missing)})", value=join_names(missing) or "None", inline=False)
        embed.add_field(name=f"🏖️ Excused ({len(absent)})", value=join_names(absent) or "None", inline=False)
        embed.add_field(name="🔔 Pings", value=pings_line, inline=False)
        embed.set_footer(text="Updates automatically every minute")
        return embed

    async def status_updater(self, guild_id, message):
        try:
            while True:
                await asyncio.sleep(60)
                war = await get_war(guild_id)
                if not war or not war.get("is_active"): return
                
                start = to_utc(war["war_start"])
                if datetime.now(timezone.utc) >= start + WAR:
                    await self.finish_war(guild_id, message.channel)
                    return
                    
                try: 
                    await message.edit(embed=await self.build_status_embed(guild_id))
                except (discord.NotFound, discord.Forbidden): 
                    return
        except asyncio.CancelledError:
            pass

    async def finish_war(self, guild_id, channel):
        task = self.status_tasks.pop(guild_id, None)
        if task: task.cancel()
        if guild_id in self.ping_tasks:
            for t in self.ping_tasks[guild_id]: t.cancel()
        
        try:
            war = await get_war(guild_id)
            if war and war.get("status_message_id"):
                try:
                    msg = await channel.fetch_message(war["status_message_id"])
                    await msg.edit(embed=discord.Embed(title="🏁 War Ended", description="Use `!war report` for the final list.", color=discord.Color.red()))
                except discord.HTTPException: pass
            
            await asyncio.to_thread(
                supabase.table("wars").update({"is_active": False, "phase": "ended", "status_message_id": None, "status_channel_id": None}).eq("guild_id", guild_id).execute
            )
        except Exception as e: print(f"Error finishing war: {e}")

    # ... [Keep the rest of the file EXACTLY the same as the previous version] ...
    async def show_status(self, ctx):
        await ctx.send(embed=await self.build_status_embed(ctx.guild.id))

    async def cancel_war(self, ctx):
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        war = await get_war(ctx.guild.id)
        if not war or not war.get("is_active"): return await ctx.send("ℹ️ No active war to cancel.")
        
        await self.finish_war(ctx.guild.id, ctx.channel)
        await ctx.send(embed=discord.Embed(description="🛑 War tracking cancelled.", color=discord.Color.light_grey()))

    async def war_report(self, ctx):
        war = await get_war(ctx.guild.id)
        if not war: return await ctx.send("ℹ️ No war data found.")
        
        missing, absent = war.get("missing_list") or [], war.get("absent_list") or []
        embed = discord.Embed(title="🏁 Final War Report", color=discord.Color.red())
        embed.add_field(name=f"❌ Missed Attacks ({len(missing)})", value=join_names(missing) or "Everyone completed their attacks!", inline=False)
        if absent: embed.add_field(name=f"🏖️ Excused ({len(absent)})", value=join_names(absent), inline=False)
        await ctx.send(embed=embed)

    async def war_missing(self, ctx, subaction, args):
        sub = (subaction or "list").lower()
        if sub not in ("list", "add", "remove"):
            return await ctx.send("Usage: `!war missing list|add|remove <name>`")
        if sub != "list" and not is_staff_member(ctx.author):
            return await ctx.send("❌ Staff only.")

        async with self.locks[ctx.guild.id]:
            war = await get_war(ctx.guild.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            
            missing, absent = war.get("missing_list") or [], war.get("absent_list") or []

            if sub == "list":
                if not missing: return await ctx.send("✅ The missing list is empty.")
                return await ctx.send("⚠️ **Missing:** " + join_names(missing))

            if not args: return await ctx.send("❌ Provide a name.")
            name = args.strip().lower()

            if sub == "add":
                if any(a["name"].lower() == name for a in absent):
                    return await ctx.send(f"🏖️ `{name}` is excused and cannot be added to missing.")
                if not any(m["name"].lower() == name for m in missing):
                    missing.append({"name": name})
                    await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("guild_id", ctx.guild.id).execute)
                await ctx.send(embed=discord.Embed(description=f"✅ Added `{name}` to missing.", color=discord.Color.green()))
            else:
                missing = [m for m in missing if m["name"].lower() != name]
                await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("guild_id", ctx.guild.id).execute)
                await ctx.send(embed=discord.Embed(description=f"✅ Removed `{name}` from missing.", color=discord.Color.green()))

    async def war_absent(self, ctx, subaction, args):
        sub = (subaction or "").lower()
        if sub not in ("add", "remove") or not args:
            return await ctx.send("Usage: `!war absent add|remove <name>`")
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")

        async with self.locks[ctx.guild.id]:
            war = await get_war(ctx.guild.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            
            absent, missing = war.get("absent_list") or [], war.get("missing_list") or []
            name = args.strip().lower()

            if sub == "add":
                if not any(a["name"].lower() == name for a in absent):
                    absent.append({"name": name})
                    missing = [m for m in missing if m["name"].lower() != name]
                    await asyncio.to_thread(supabase.table("wars").update({"absent_list": absent, "missing_list": missing}).eq("guild_id", ctx.guild.id).execute)
                await ctx.send(embed=discord.Embed(description=f"🏖️ Added `{name}` to excused.", color=discord.Color.green()))
            else:
                absent = [a for a in absent if a["name"].lower() != name]
                await asyncio.to_thread(supabase.table("wars").update({"absent_list": absent}).eq("guild_id", ctx.guild.id).execute)
                await ctx.send(embed=discord.Embed(description=f"✅ Removed `{name}` from excused.", color=discord.Color.green()))

    async def war_attacks(self, ctx, args):
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        if not args: return await ctx.send("Usage: `!war attacks <name> | <count>`")
        
        if "|" in args:
            name_part, count_part = args.split("|", 1)
            name, count = name_part.strip().lower(), count_part.strip()
        else:
            parts = args.rsplit(maxsplit=1)
            if len(parts) == 2: name, count = parts[0].strip().lower(), parts[1].strip()
            else: return await ctx.send("❌ Use `|` for names with spaces.")

        if not count.isdigit(): return await ctx.send("❌ Count must be a number.")

        cfg = await get_settings(ctx.guild.id)
        async with self.locks[ctx.guild.id]:
            war = await get_war(ctx.guild.id)
            if not war: return await ctx.send("ℹ️ No war data found.")
            
            counts = war.get("attack_counts") or {}
            counts[name] = int(count)
            missing = war.get("missing_list") or []
            
            if int(count) >= cfg["attacks_required"]:
                missing = [m for m in missing if m["name"].lower() != name]
                
            await asyncio.to_thread(
                supabase.table("wars").update({"attack_counts": counts, "missing_list": missing}).eq("guild_id", ctx.guild.id).execute
            )
        await ctx.send(f"✅ `{name}`: {count}/{cfg['attacks_required']} attacks.")

    async def war_check(self, ctx):
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        war = await get_war(ctx.guild.id)
        if not war: return await ctx.send("ℹ️ No war data found.")
        
        cfg = await get_settings(ctx.guild.id)
        required = cfg["attacks_required"]
        counts = {k.lower(): int(v) for k, v in (war.get("attack_counts") or {}).items()}
        absent = {a["name"].lower() for a in war.get("absent_list") or []}
        missing = {m["name"].lower() for m in war.get("missing_list") or []}
        names = set(counts) | missing 
        
        short = sorted(
            ((n, counts.get(n, 0)) for n in names if not (cfg["exempt_absent"] and n in absent) and counts.get(n, 0) < required),
            key=lambda x: (x[1], x[0]),
        )
        
        embed = discord.Embed(title=f"📋 Below {required} attacks", color=discord.Color.orange())
        if short:
            text = "\n".join(f"• {n} — {c}/{required}" for n, c in short)
            embed.description = text if len(text) <= 4000 else text[:3990] + "\n..."
        else:
            embed.description = "✅ Everyone met the requirement."
        await ctx.send(embed=embed)

    async def warning_dispatch(self, ctx, action, target, reason):
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
        action = (action or "").lower()
        usage = "Usage: `!warning add @user <reason>` | `list @user` | `remove <id>`"
        if action not in ("add", "list", "remove") or not target:
            return await ctx.send(usage)

        try:
            if action == "remove":
                if not target.isdigit(): return await ctx.send(usage)
                res = await asyncio.to_thread(supabase.table("warnings").delete().eq("id", int(target)).eq("guild_id", ctx.guild.id).execute)
                return await ctx.send("✅ Warning removed." if res.data else "❌ No warning with that ID here.")

            try: member = await commands.MemberConverter().convert(ctx, target)
            except commands.BadArgument: return await ctx.send("❌ Couldn't find that member. Mention them with @.")

            if action == "add":
                reason_text = reason or "No reason provided"
                await asyncio.to_thread(supabase.table("warnings").insert({
                    "guild_id": ctx.guild.id, "discord_id": member.id,
                    "reason": reason_text, "issued_by": ctx.author.id,
                }).execute)
                await ctx.send(f"📌 **{member.display_name}** has been warned.")
                try: await member.send(f"⚠️ Warning from **{ctx.guild.name}**.\nReason: {reason_text}")
                except discord.HTTPException: pass
            else:
                res = await asyncio.to_thread(supabase.table("warnings").select("*").eq("guild_id", ctx.guild.id).eq("discord_id", member.id).order("created_at", desc=True).limit(10).execute)
                if not res.data: return await ctx.send(f"✅ **{member.display_name}** has no warnings.")
                embed = discord.Embed(title=f"Warnings for {member.display_name}", color=discord.Color.red())
                for w in res.data:
                    ts = to_utc(w.get("created_at"))
                    when = f"<t:{int(ts.timestamp())}:d>" if ts else "Unknown"
                    embed.add_field(name=f"ID {w['id']}", value=f"{when} — {w['reason']}", inline=False)
                await ctx.send(embed=embed)
        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    @commands.command(name="warning")
    @commands.guild_only()
    async def warning_group(self, ctx, action: str = None, target: str = None, *, reason: str = None):
        await self.warning_dispatch(ctx, action, target, reason)

    async def war_warning(self, ctx, subaction, args):
        parts = (args or "").split(maxsplit=1)
        await self.warning_dispatch(ctx, subaction, parts[0] if parts else None, parts[1] if len(parts) > 1 else None)

    async def show_help(self, ctx):
        is_staff = is_staff_member(ctx.author)
        embed = discord.Embed(title="🛡️ War Commands", color=discord.Color.blue())
        embed.add_field(name="Public Commands", value=(
            "`!war status` — View current timer and missing list\n"
            "`!war missing list` — See who hasn't attacked yet\n"
            "`attacks done` — Type in chat to report your attacks\n"
            "`attacks done 2` — Report a specific number of attacks"
        ), inline=False)
        if is_staff:
            embed.add_field(name="Staff Commands", value=(
                "`!war defence ends <time>` — Start defence timer\n"
                "`!war attack ends <time>` — Start attack timer\n"
                "`!war cancel` — Stop tracking the current war\n"
                "`!war report` — View final missing list after a war\n"
                "`!war missing add|remove <name>` — Manage missing list\n"
                "`!war absent add|remove <name>` — Manage excused list\n"
                "`!war attacks <name> | <count>` — Manually log attacks\n"
                "`!war check` — List players below required attacks\n"
                "`!war warning add|list|remove <target>` — Manage warnings\n"
                "`!war set attacks <number>` — Set required attacks (default 6)"
            ), inline=False)
        await ctx.send(embed=embed)

    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot or not message.guild: return
        if not DONE_RE.search(message.content): return

        is_premium = await asyncio.to_thread(check_premium_status, message.guild.id)
        if not is_premium: return

        async with self.locks[message.guild.id]:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("guild_id", message.guild.id).eq("is_active", True).execute)
            if not res.data: return
            war = res.data[0]
            if message.channel.id != war.get("status_channel_id"): return

            cfg = await get_settings(message.guild.id)
            required = cfg["attacks_required"]
            counts = war.get("attack_counts") or {}
            missing = war.get("missing_list") or []
            
            aliases = await asyncio.to_thread(supabase.table("aliases").select("alias_name, discord_id").eq("guild_id", message.guild.id).execute)
            alias_map = {row["alias_name"]: row["discord_id"] for row in aliases.data}
            
            names = {message.author.display_name.lower(), message.author.name.lower(), *[k.lower() for k, v in alias_map.items() if v == message.author.id]}
            found = next((m for m in missing if m["name"].lower() in names), None)

            m = DONE_RE.search(message.content)
            done = int(m.group(1)) if m.group(1) else required
            key = found["name"].lower() if found else message.author.display_name.lower()
            
            counts[key] = done
            if done >= required and found: missing.remove(found)
                
            await asyncio.to_thread(
                supabase.table("wars").update({"missing_list": missing, "attack_counts": counts}).eq("guild_id", message.guild.id).execute
            )

        reply = await message.reply(
            f"✅ **{message.author.display_name}**: {done}/{required} attacks recorded."
            + (" Staff: react ❌ to undo." if found and done >= required else ""),
            mention_author=False,
        )
        if found and done >= required:
            if len(self.done_replies) > 500: self.done_replies.pop(next(iter(self.done_replies)), None)
            self.done_replies[reply.id] = found["name"]
            await reply.add_reaction("❌")

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        if payload.user_id == self.bot.user.id or str(payload.emoji) != "❌": return
        name = self.done_replies.get(payload.message_id)
        if not name: return

        guild = self.bot.get_guild(payload.guild_id)
        reactor = guild.get_member(payload.user_id) if guild else None
        if not reactor or not is_staff_member(reactor): return

        async with self.locks[guild.id]:
            war = await get_war(guild.id)
            if not war or not war.get("is_active"): return
            
            missing = war.get("missing_list") or []
            counts = war.get("attack_counts") or {}
            
            if not any(m["name"].lower() == name.lower() for m in missing):
                missing.append({"name": name})
                counts[name.lower()] = 0
                await asyncio.to_thread(
                    supabase.table("wars").update({"missing_list": missing, "attack_counts": counts}).eq("guild_id", guild.id).execute
                )
            
        self.done_replies.pop(payload.message_id, None)
        channel = self.bot.get_channel(payload.channel_id)
        if channel: await channel.send(f"↩️ **{name}** re-added to missing by {reactor.display_name}.")

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
