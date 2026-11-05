import discord
from discord.ext import commands
from datetime import datetime, timezone, timedelta
import re
import asyncio
from collections import defaultdict
from database import supabase

# --- CONSTANTS & HELPERS ---
DEFENCE = ("defence", "defense")
DONE_RE = re.compile(r"\battacks?\s+done\b", re.I)

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

async def get_aliases(guild_id):
    res = await asyncio.to_thread(supabase.table("aliases").select("alias_name, discord_id").eq("guild_id", guild_id).execute)
    return {row["alias_name"]: row["discord_id"] for row in res.data}

class WarTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.timers = {}
        self.status_tasks = {}
        self.done_replies = {}  # reply_msg_id -> removed name
        self.locks = defaultdict(asyncio.Lock)

    async def cog_load(self):
        self.bot.loop.create_task(self.restore_events())

    def cog_unload(self):
        for t in [*self.timers.values(), *self.status_tasks.values()]:
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
                
                end = start + timedelta(hours=24 if war["phase"] in DEFENCE else 48)
                
                if end > now:
                    self.timers[war["guild_id"]] = asyncio.create_task(
                        self.timer_countdown(war["guild_id"], channel, war["phase"], end)
                    )
                elif war["phase"] not in DEFENCE:
                    # War ended while bot was offline
                    await self.finish_war(war["guild_id"], channel)
                    continue
                
                if war.get("status_message_id"):
                    try:
                        msg = await channel.fetch_message(war["status_message_id"])
                        self.status_tasks[war["guild_id"]] = asyncio.create_task(
                            self.status_updater(war["guild_id"], msg)
                        )
                    except Exception:
                        pass
        except Exception as e:
            print(f"Error restoring wars: {e}")

    # --- MAIN WAR COMMAND ---
    @commands.command(name="war")
    @commands.guild_only()
    async def war_group(self, ctx, action: str = None, subaction: str = None, *, args: str = None):
        action = (action or "").lower()
        
        if not action:
            return await ctx.send("Usage: `!war defence ends 24h` | `!war status` | `!war report` | `!war missing`")

        if action == "status":
            return await self.show_status(ctx)
        if action == "missing":
            return await self.war_missing(ctx, subaction, args)
        if action in ("absent", "absence"):
            return await self.war_absent(ctx, subaction, args)
        if action == "report":
            return await self.war_report(ctx)
        if action == "cancel":
            return await self.cancel_war(ctx)
            
        if action in ("defence", "defense", "attack"):
            if not (ctx.author.guild_permissions.administrator or ctx.author.guild_permissions.manage_guild):
                return await ctx.send("❌ You must be an Admin or Staff to use this command.")
            
            if subaction != "ends" or not args:
                return await ctx.send(f"Usage: `!war {action} ends <time>` (e.g., `!war {action} ends 24h`)")
                
            await self.start_timer(ctx, action, args)
        else:
            await ctx.send("❌ Unknown action. Use `!war defence ends`, `!war status`, or `!war report`.")

    async def start_timer(self, ctx, phase, time_str):
        td = parse_time(time_str)
        if not td: return await ctx.send("❌ Invalid time. Use `24h`, `12h30m`, etc.")
        if td > timedelta(hours=24): return await ctx.send("❌ Phase cannot exceed 24 hours.")

        now = datetime.now(timezone.utc)
        end_time = now + td
        war_start = end_time - timedelta(hours=24 if phase in DEFENCE else 48)

        try:
            existing = await asyncio.to_thread(
                supabase.table("wars").select("is_active").eq("guild_id", ctx.guild.id).execute
            )
            continuing = phase == "attack" and existing.data and existing.data[0]["is_active"]

            war_data = {
                "guild_id": ctx.guild.id,
                "war_start": war_start.isoformat(),
                "phase": phase,
                "is_active": True,
                "status_message_id": None,
                "status_channel_id": None,
            }
            if not continuing:  # Fresh war only
                war_data["missing_list"] = []
                war_data["absent_list"] = []

            await asyncio.to_thread(supabase.table("wars").upsert(war_data, on_conflict="guild_id").execute)
            
            embed = discord.Embed(
                title=f"⚔️ War {phase.capitalize()} Phase Started",
                description=f"**Ends:** <t:{int(end_time.timestamp())}:R>",
                color=discord.Color.blue()
            )
            await ctx.send(embed=embed)
            
            if ctx.guild.id in self.timers: self.timers[ctx.guild.id].cancel()
            if ctx.guild.id in self.status_tasks: self.status_tasks[ctx.guild.id].cancel()
            
            self.timers[ctx.guild.id] = asyncio.create_task(
                self.timer_countdown(ctx.guild.id, ctx.channel, phase, end_time)
            )
            
            status_msg = await ctx.send(embed=await self.build_status_embed(ctx.guild.id))
            await asyncio.to_thread(
                supabase.table("wars").update({"status_message_id": status_msg.id, "status_channel_id": ctx.channel.id}).eq("guild_id", ctx.guild.id).execute
            )
            self.status_tasks[ctx.guild.id] = asyncio.create_task(self.status_updater(ctx.guild.id, status_msg))

        except discord.HTTPException as e:
            await ctx.send(f"❌ Discord API error: {e}")
        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    async def timer_countdown(self, guild_id, channel, phase, end_time):
        try:
            delay = (end_time - datetime.now(timezone.utc)).total_seconds()
            if delay > 0:
                await asyncio.sleep(delay)
                
            if phase in DEFENCE:
                await channel.send("⚠️ **Defence Phase has ended!** Use `!war attack ends 24h`")
            else:
                await self.finish_war(guild_id, channel)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"Timer error for guild {guild_id}: {e}")
        finally:
            if self.timers.get(guild_id) is asyncio.current_task():
                self.timers.pop(guild_id, None)

    async def finish_war(self, guild_id, channel):
        task = self.status_tasks.pop(guild_id, None)
        if task: task.cancel()
        
        try:
            res = await asyncio.to_thread(
                supabase.table("wars").select("status_message_id").eq("guild_id", guild_id).execute
            )
            await asyncio.to_thread(
                supabase.table("wars").update({
                    "is_active": False, "phase": "ended",
                    "status_message_id": None, "status_channel_id": None,
                }).eq("guild_id", guild_id).execute
            )
            
            if res.data and res.data[0].get("status_message_id"):
                try:
                    msg = await channel.fetch_message(res.data[0]["status_message_id"])
                    await msg.edit(embed=discord.Embed(
                        title="🏁 War Ended", description="Use `!war report` for the final list.",
                        color=discord.Color.red()))
                except discord.HTTPException:
                    pass
            await channel.send("🏁 **War has ended!** Use `!war report` to see the final missing list.")
        except Exception as e:
            print(f"Error finishing war for guild {guild_id}: {e}")

    async def build_status_embed(self, guild_id):
        res = await asyncio.to_thread(supabase.table("wars").select("*").eq("guild_id", guild_id).eq("is_active", True).execute)
        if not res.data: return discord.Embed(title="No Active War", color=discord.Color.light_grey())
        
        war = res.data[0]
        start = to_utc(war["war_start"])
        
        embed = discord.Embed(title="🛡️ Active War Status", color=discord.Color.gold())
        
        if war["phase"] in DEFENCE:
            end = start + timedelta(hours=24)
            embed.description = f"**Phase:** Defence\n**Ends:** <t:{int(end.timestamp())}:R>"
        else:
            end = start + timedelta(hours=48)
            embed.description = f"**Phase:** Attack\n**Ends:** <t:{int(end.timestamp())}:R>"
            
        missing = war.get("missing_list") or []
        absent = war.get("absent_list") or []
        
        if missing:
            embed.add_field(name=f"⚠️ Missing Attacks ({len(missing)})", value=join_names(missing), inline=False)
        else:
            embed.add_field(name="✅ Missing Attacks", value="None", inline=False)
            
        if absent:
            embed.add_field(name=f"🏖️ Excused ({len(absent)})", value=join_names(absent), inline=False)
            
        return embed

    async def status_updater(self, guild_id, message):
        while True:
            await asyncio.sleep(60)
            try:
                await message.edit(embed=await self.build_status_embed(guild_id))
            except (discord.NotFound, discord.Forbidden):
                return
            except Exception as e:
                print(f"Status update failed: {e}")

    async def show_status(self, ctx):
        try:
            await ctx.send(embed=await self.build_status_embed(ctx.guild.id))
        except Exception as e:
            await ctx.send(f"❌ Error: {e}")

    # --- REPORT & CANCEL ---
    async def war_report(self, ctx):
        try:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("guild_id", ctx.guild.id).execute)
            if not res.data: return await ctx.send("ℹ️ No war data found.")
            
            war = res.data[0]
            missing = war.get("missing_list") or []
            absent = war.get("absent_list") or []
            
            embed = discord.Embed(title="🏁 Final War Report", color=discord.Color.red())
            
            if missing:
                embed.add_field(name=f"❌ Missed Attacks ({len(missing)})", value=join_names(missing), inline=False)
            else:
                embed.add_field(name="✅ Missed Attacks", value="Everyone completed their attacks!", inline=False)
                
            if absent:
                embed.add_field(name=f"🏖️ Excused ({len(absent)})", value=join_names(absent), inline=False)
                
            await ctx.send(embed=embed)
            
        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    async def cancel_war(self, ctx):
        if not (ctx.author.guild_permissions.administrator or ctx.author.guild_permissions.manage_guild):
            return await ctx.send("❌ Staff only.")
            
        try:
            res = await asyncio.to_thread(supabase.table("wars").select("is_active").eq("guild_id", ctx.guild.id).execute)
            if not res.data or not res.data[0].get("is_active"):
                return await ctx.send("ℹ️ No active war to cancel.")
                
            if ctx.guild.id in self.timers: self.timers[ctx.guild.id].cancel()
            await self.finish_war(ctx.guild.id, ctx.channel)
            await ctx.send("🛑 War tracking cancelled.")
        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    # --- MISSING LIST ---
    async def war_missing(self, ctx, subaction, args):
        subaction = (subaction or "list").lower()
        
        if subaction not in ("list", "add", "remove"):
            return await ctx.send("Usage: `!war missing list | add <name> | remove <name>`")
            
        if subaction != "list" and not (ctx.author.guild_permissions.administrator or ctx.author.guild_permissions.manage_guild):
            return await ctx.send("❌ Staff only.")

        try:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("guild_id", ctx.guild.id).eq("is_active", True).execute)
            if not res.data: return await ctx.send("ℹ️ No active war found.")
            
            war = res.data[0]
            missing = war.get("missing_list") or []
            absent = war.get("absent_list") or []

            if subaction == "list":
                if not missing: return await ctx.send("✅ The missing list is empty.")
                return await ctx.send("⚠️ **Missing:** " + join_names(missing))

            if not args: return await ctx.send("❌ Provide a name.")

            name = args.strip().lower()
            
            if subaction == "add":
                if any(a.get("name").lower() == name for a in absent):
                    return await ctx.send(f"🏖️ `{name}` is excused and cannot be added to missing.")

                if not any(m.get("name").lower() == name for m in missing):
                    missing.append({"name": name})
                    await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("guild_id", ctx.guild.id).execute)
                await ctx.send(f"✅ Added `{name}` to missing.")
                
            elif subaction == "remove":
                missing = [m for m in missing if m.get("name").lower() != name]
                await asyncio.to_thread(supabase.table("wars").update({"missing_list": missing}).eq("guild_id", ctx.guild.id).execute)
                await ctx.send(f"✅ Removed `{name}` from missing.")

        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    # --- ABSENCE ---
    async def war_absent(self, ctx, subaction, args):
        subaction = (subaction or "").lower()
        if not subaction or not args or subaction not in ("add", "remove"):
            return await ctx.send("Usage: `!war absent add <name>` or `!war absent remove <name>`")

        if not (ctx.author.guild_permissions.administrator or ctx.author.guild_permissions.manage_guild):
            return await ctx.send("❌ Staff only.")

        try:
            res = await asyncio.to_thread(supabase.table("wars").select("*").eq("guild_id", ctx.guild.id).eq("is_active", True).execute)
            if not res.data: return await ctx.send("ℹ️ No active war found.")
            
            war = res.data[0]
            absent = war.get("absent_list") or []
            missing = war.get("missing_list") or []
            name = args.strip().lower()

            if subaction == "add":
                if not any(a.get("name").lower() == name for a in absent):
                    absent.append({"name": name})
                    missing = [m for m in missing if m.get("name").lower() != name]
                    await asyncio.to_thread(supabase.table("wars").update({"absent_list": absent, "missing_list": missing}).eq("guild_id", ctx.guild.id).execute)
                await ctx.send(f"🏖️ Added `{name}` to excused list.")
                
            elif subaction == "remove":
                absent = [a for a in absent if a.get("name").lower() != name]
                await asyncio.to_thread(supabase.table("wars").update({"absent_list": absent}).eq("guild_id", ctx.guild.id).execute)
                await ctx.send(f"✅ Removed `{name}` from excused list.")
        except Exception as e:
            await ctx.send(f"❌ Database error: {e}")

    # --- WARNINGS ---
    @commands.command(name="warning")
    @commands.guild_only()
    async def warning_group(self, ctx, action: str = None, member: discord.Member = None, *, reason: str = None):
        action = (action or "").lower()
        if not action or not member:
            return await ctx.send("Usage: `!warning add @user <reason>` or `!warning list @user`")

        if not (ctx.author.guild_permissions.administrator or ctx.author.guild_permissions.manage_guild):
            return await ctx.send("❌ Staff only.")

        if action == "add":
            reason_text = reason or "No reason provided"
            try:
                await asyncio.to_thread(supabase.table("warnings").insert({
                    "guild_id": ctx.guild.id,
                    "discord_id": member.id,
                    "reason": reason_text,
                    "issued_by": ctx.author.id
                }).execute)
                
                await ctx.send(f"📌 **{member.display_name}** has been warned.")
                try:
                    await member.send(f"⚠️ You received a warning from **{ctx.guild.name}** staff.\nReason: {reason_text}")
                except discord.HTTPException:
                    await ctx.send("*(Couldn't DM the user, their DMs are closed)*")
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")

        elif action == "list":
            try:
                res = await asyncio.to_thread(supabase.table("warnings").select("*").eq("guild_id", ctx.guild.id).eq("discord_id", member.id).execute)
                if not res.data: return await ctx.send(f"✅ **{member.display_name}** has no warnings.")
                
                embed = discord.Embed(title=f"Warnings for {member.display_name}", color=discord.Color.red())
                for w in res.data[-10:]:
                    ts = to_utc(w.get("created_at"))
                    when = f"<t:{int(ts.timestamp())}:d>" if ts else "Unknown date"
                    embed.add_field(name="Warning", value=f"{when} — {w['reason']}", inline=False)
                await ctx.send(embed=embed)
            except Exception as e:
                await ctx.send(f"❌ Database error: {e}")
        else:
            await ctx.send("Usage: `!warning add @user <reason>` or `!warning list @user`")

    # --- ON MESSAGE (Attacks Done Triggers) ---
    @commands.Cog.listener()
    async def on_message(self, message):
        if message.author.bot or not message.guild: return
        if not DONE_RE.search(message.content): return

        async with self.locks[message.guild.id]:
            res = await asyncio.to_thread(
                supabase.table("wars").select("*").eq("guild_id", message.guild.id).eq("is_active", True).execute
            )
            if not res.data: return
            war = res.data[0]
            if message.channel.id != war.get("status_channel_id"): return

            missing = war.get("missing_list") or []
            aliases = await get_aliases(message.guild.id)
            names = {message.author.display_name.lower(), message.author.name.lower(),
                     *[k.lower() for k, v in aliases.items() if v == message.author.id]}
            
            found = next((m for m in missing if m["name"].lower() in names), None)
            if not found: return

            missing.remove(found)
            await asyncio.to_thread(
                supabase.table("wars").update({"missing_list": missing}).eq("guild_id", message.guild.id).execute
            )

        reply = await message.reply(
            f"✅ **{message.author.display_name}** marked as done. Staff: react ❌ to undo.",
            mention_author=False,
        )
        self.done_replies[reply.id] = found["name"]
        await reply.add_reaction("❌")

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        if payload.user_id == self.bot.user.id or str(payload.emoji) != "❌": return
        
        name = self.done_replies.get(payload.message_id)
        if not name: return

        guild = self.bot.get_guild(payload.guild_id)
        reactor = guild.get_member(payload.user_id) if guild else None
        if not reactor or not (reactor.guild_permissions.administrator or reactor.guild_permissions.manage_guild):
            return

        async with self.locks[guild.id]:
            res = await asyncio.to_thread(
                supabase.table("wars").select("*").eq("guild_id", guild.id).eq("is_active", True).execute
            )
            if not res.data: return
            
            missing = res.data[0].get("missing_list") or []
            if any(m["name"].lower() == name.lower() for m in missing): return
            
            missing.append({"name": name})
            await asyncio.to_thread(
                supabase.table("wars").update({"missing_list": missing}).eq("guild_id", guild.id).execute
            )
            
        self.done_replies.pop(payload.message_id, None)
        channel = self.bot.get_channel(payload.channel_id)
        if channel:
            await channel.send(f"↩️ **{name}** re-added to missing by {reactor.display_name}.")

async def setup(bot):
    await bot.add_cog(WarTracker(bot))
