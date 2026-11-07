import discord
from discord.ext import commands
import asyncio
import re
import json
from database import supabase, check_premium_status
from ocr_engine import process_race_image

NODES_PER_LAP = 5
UNITS = {'K': 1e3, 'M': 1e6, 'B': 1e9}

def parse_amount(s):
    m = re.fullmatch(r'\s*([\d.,]+)\s*([KMB])?\s*', str(s), re.IGNORECASE)
    if not m: raise ValueError(f"bad amount: {s}")
    return float(m.group(1).replace(',', '.')) * UNITS.get((m.group(2) or '').upper(), 1)

def format_amount(v):
    for suffix, div in (('B', 1e9), ('M', 1e6), ('K', 1e3)):
        if v >= div: return f"{round(v / div, 2):g} {suffix}"
    return f"{round(v, 2):g}"

def clean_val(v_str):
    """Safely parses strings like '1.2M' or '15' into an integer."""
    try:
        m = re.match(r'\s*([\d.]+)\s*([KMB])?', str(v_str).upper())
        if not m: return 0
        return int(float(m.group(1)) * {'K': 1e3, 'M': 1e6, 'B': 1e9}.get(m.group(2), 1))
    except:
        return 0

def parse_node_args(args):
    if '|' in args:
        chunks = [c.strip() for c in args.split('|')]
    else:
        ms = list(re.finditer(r'(?<![\w.])\d+(?:[.,]\d+)?', args))
        if len(ms) < 3: raise ValueError("need 3 numbers")
        starts = [m.start() for m in ms[:3]]
        ends = starts[1:] + [len(args)]
        chunks = [args[s:e].strip() for s, e in zip(starts, ends)]
    
    out = []
    for c in chunks:
        m = re.match(r'([\d.,]+)\s*([KMB](?![a-z]))?\s*(.*)', c, re.IGNORECASE)
        if not m: raise ValueError(f"can't read: {c}")
        val = f"{m.group(1).replace(',', '.')} {(m.group(2) or '').upper()}".strip()
        out.append((val, m.group(3).strip()))
    return out

def is_staff_member(m):
    p = m.guild_permissions
    return p.administrator or p.manage_guild

async def get_race(channel_id):
    res = await asyncio.to_thread(supabase.table("race_state").select("*").eq("channel_id", channel_id).limit(1).execute)
    return res.data[0] if res.data else None

async def get_alias(guild_id, user_id, default_name):
    if not user_id: return default_name
    res = await asyncio.to_thread(supabase.table("aliases").select("alias_name").eq("guild_id", guild_id).eq("discord_id", user_id).limit(1).execute)
    return res.data[0]["alias_name"] if res.data else default_name

async def log_race_action(guild_id, user_id, player_name, action_type):
    try:
        await asyncio.to_thread(supabase.table("race_logs").insert({
            "guild_id": guild_id, "discord_id": user_id, "player_name": player_name, "action_type": action_type
        }).execute())
    except Exception as e:
        print(f"Failed to log race action: {e}")

async def check_team_limit(guild_id):
    res = await asyncio.to_thread(supabase.table("guilds").select("max_teams").eq("guild_id", guild_id).execute)
    max_teams = res.data[0].get("max_teams", 1) if res.data else 1
    active = await asyncio.to_thread(supabase.table("race_state").select("channel_id").eq("guild_id", guild_id).execute)
    return len(active.data) < max_teams

class RaceTracker(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.locks = {}

    def get_lock(self, channel_id):
        if channel_id not in self.locks:
            self.locks[channel_id] = asyncio.Lock()
        return self.locks[channel_id]

    @commands.command(name="race")
    @commands.guild_only()
    async def race_group(self, ctx, action: str = None, *, args: str = None):
        action = (action or "").lower()
        args = (args or "").strip() or None
        subaction = args.split()[0].lower() if args else None

        if not action: return await ctx.send("Usage: `!race help` or `!race status`")
        if action == "help": return await self.show_help(ctx)
        if action == "status": return await self.show_status(ctx)
        
        # PUBLIC TASKS
        if action in ("ofa", "dmp", "dyp", "je"): 
            return await self.handle_task(ctx, action, subaction, args)

        # STAFF ONLY
        if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")

        if action == "uploadsheet": return await self.upload_sheet(ctx, args)
        if action == "use": return await self.use_sheet(ctx, args)
        if action == "next": return await self.advance_node_auto(ctx)
        
        # TEAM LIMIT CHECK (For starting new tracking)
        if action in ("target", "newnode"):
            existing = await get_race(ctx.channel.id)
            if not existing or existing.get("task_description") == "No Active Node":
                if not await check_team_limit(ctx.guild.id):
                    return await ctx.send("❌ **Team limit reached!** Your server's plan only allows a certain number of active teams. Upgrade on the dashboard to add more.")

        if action == "target":
            if not args or not args.isdigit(): return await ctx.send("Usage: `!race target 20`")
            await asyncio.to_thread(supabase.table("race_state").upsert({"guild_id": ctx.guild.id, "channel_id": ctx.channel.id, "target_laps": int(args)}, on_conflict="channel_id").execute)
            return await ctx.send(f"✅ Race target updated to **{args}** laps.")
            
        if action == "clear":
            await asyncio.to_thread(supabase.table("race_state").upsert({
                "channel_id": ctx.channel.id, "task_description": "No Active Node", 
                "ofa_holder_id": None, "ofa_target": None, "ofa_done": False, 
                "dyp_progress": 0, "dyp_target": 0, "dyp_contributors": [], 
                "je_progress": "0", "je_target": "0", "je_done": False, 
                "pending_ofa_message_id": None, "pending_ofa_user_id": None
            }, on_conflict="channel_id").execute)
            return await ctx.send("🧹 Current node cleared.")
            
        if action == "newnode": return await self.advance_node_manual(ctx, args)
        if action == "set": return await self.manual_set(ctx, subaction, args)
            
        await ctx.send("❌ Unknown race action. Use `!race help`.")

    async def upload_sheet(self, ctx, name):
        if not name: return await ctx.send("Usage: `!race uploadsheet <name>` (attach a .json file)")
        if not ctx.message.attachments: return await ctx.send("❌ Please attach a `.json` file.")
        attachment = ctx.message.attachments[0]
        if not attachment.filename.endswith('.json'): return await ctx.send("❌ File must be a `.json` file.")
        try:
            content = await attachment.read()
            data = json.loads(content.decode('utf-8'))
            await asyncio.to_thread(supabase.table("race_sheets").upsert({"guild_id": ctx.guild.id, "name": name, "data": data}, on_conflict="guild_id,name").execute)
            await ctx.send(f"✅ Sheet **{name}** uploaded successfully with **{len(data)}** nodes.")
        except Exception as e: await ctx.send(f"❌ Failed to parse JSON: {e}")

    async def use_sheet(self, ctx, name):
        if not name: return await ctx.send("Usage: `!race use <name>`")
        res = await asyncio.to_thread(supabase.table("race_sheets").select("id").eq("guild_id", ctx.guild.id).eq("name", name).execute)
        if not res.data: return await ctx.send(f"❌ Sheet `{name}` not found.")
        await asyncio.to_thread(supabase.table("race_state").upsert({"channel_id": ctx.channel.id, "guild_id": ctx.guild.id, "active_race_sheet": name}, on_conflict="channel_id").execute)
        await ctx.send(f"✅ Now using sheet **{name}**.")

    async def advance_node_auto(self, ctx):
        state = await get_race(ctx.channel.id)
        if not state or not state.get('active_race_sheet'): return await ctx.send("❌ No active sheet set. Use `!race use <name>` first.")
        sheet_name = state['active_race_sheet']
        
        new_node = state.get('current_node', 0) + 1
        new_lap = state.get('current_lap', 0)
        if new_node > NODES_PER_LAP: new_node, new_lap = 1, new_lap + 1
        node_key = f"{new_lap}.{new_node}"

        res = await asyncio.to_thread(supabase.table("race_sheets").select("data").eq("guild_id", ctx.guild.id).eq("name", sheet_name).execute)
        sheet_data = res.data[0]['data']
        if node_key not in sheet_data: return await ctx.send(f"❌ Node `{node_key}` not found in sheet **{sheet_name}**. Are you at the end?")

        node_info = sheet_data[node_key]
        ofa_t, dyp_t, je_t = node_info['ofa'], node_info['dyp'], node_info['je']
        
        # SMARTER DYP PARSING (Looks for "10 members" first)
        dyp_target = 0
        match_members = re.search(r'(\d+)\s*(?:members?|players?)', dyp_t, re.IGNORECASE)
        if match_members:
            dyp_target = int(match_members.group(1))
        else:
            match_fallback = re.search(r'(\d+)', dyp_t)
            if match_fallback: dyp_target = int(match_fallback.group(1))

        desc = f"OFA: {ofa_t} | DYP: {dyp_t} | JE: {je_t}"
        await self._save_new_node(ctx, new_lap, new_node, ofa_t, dyp_target, je_t, desc, 0, "0")
        await ctx.send(f"📖 Loaded **{node_key}** from sheet **{sheet_name}**.")

    async def advance_node_manual(self, ctx, args):
        state = await get_race(ctx.channel.id)
        if not state: state = {"current_lap": 0, "current_node": 0}
        new_node = state.get('current_node', 0) + 1
        new_lap = state.get('current_lap', 0)
        if new_node > NODES_PER_LAP: new_node, new_lap = 1, new_lap + 1

        if ctx.message.attachments:
            await ctx.send("🔍 Scanning image...")
            ocr_result = await process_race_image(await ctx.message.attachments[0].read())
            if isinstance(ocr_result, dict):
                desc = f"OFA: {ocr_result['ofa']['task']} | DYP: {ocr_result['dyp']['task']} | JE: {ocr_result['je']['task']}"
                await self._save_new_node(ctx, new_lap, new_node, ocr_result['ofa']['target'], ocr_result['dyp']['target'], ocr_result['je']['target'], desc, ocr_result['dyp']['progress'], ocr_result['je']['progress'])
                return
            else: 
                await ctx.send(f"⚠️ {ocr_result}\nChecking manual input...")

        if args:
            try:
                (ofa_t, ofa_d), (dyp_r, dyp_d), (je_t, je_d) = parse_node_args(args)
                desc = f"OFA: {ofa_d} | DYP: {dyp_d} | JE: {je_d}"
                # Use clean_val so strings like "1.2M" don't crash int()
                await self._save_new_node(ctx, new_lap, new_node, ofa_t, clean_val(dyp_r), je_t, desc, 0, "0")
                return
            except ValueError: 
                return await ctx.send("❌ Invalid format. Use `!race newnode 50 hatch | 10 breed | 5 craft`")
        
        await ctx.send("❌ Please attach an image or provide text.")

    async def _save_new_node(self, ctx, lap, node, ofa_t, dyp_t, je_t, desc, dyp_p=0, je_p="0"):
        await asyncio.to_thread(supabase.table("race_state").upsert({
            "channel_id": ctx.channel.id, "guild_id": ctx.guild.id, "current_lap": lap, "current_node": node, "task_description": desc,
            "ofa_holder_id": None, "ofa_target": ofa_t, "ofa_done": False, "dyp_progress": dyp_p, "dyp_target": dyp_t, "dyp_contributors": [],
            "je_progress": je_p, "je_target": je_t, "je_done": False, "pending_ofa_message_id": None, "pending_ofa_user_id": None
        }, on_conflict="channel_id").execute)
        await ctx.send(f"✅ Node initialized: **Lap {lap}.{node}**\n*Tasks:* {desc}")
        await self.show_status(ctx)

    async def manual_set(self, ctx, subaction, args):
        if not subaction or not args: return await ctx.send("Usage: `!race set <desc|dyp|je|ofa> <value>`")
        parts = args.split(maxsplit=1)
        val = parts[1].strip() if len(parts) > 1 else ""
        try:
            if subaction == "desc": 
                await asyncio.to_thread(supabase.table("race_state").upsert({"channel_id": ctx.channel.id, "task_description": args}, on_conflict="channel_id").execute)
                return await ctx.send(f"✅ Task description set to: `{args}`")
            elif subaction == "dyp" and val.isdigit(): 
                await asyncio.to_thread(supabase.table("race_state").upsert({"channel_id": ctx.channel.id, "dyp_target": int(val)}, on_conflict="channel_id").execute)
                return await ctx.send(f"✅ DYP target set to {val}.")
            elif subaction == "je": 
                await asyncio.to_thread(supabase.table("race_state").upsert({"channel_id": ctx.channel.id, "je_target": val}, on_conflict="channel_id").execute)
                return await ctx.send(f"✅ JE target set to {val}.")
            elif subaction == "ofa": 
                await asyncio.to_thread(supabase.table("race_state").upsert({"channel_id": ctx.channel.id, "ofa_target": val}, on_conflict="channel_id").execute)
                return await ctx.send(f"✅ OFA target set to {val}.")
            else: 
                return await ctx.send("❌ Invalid set command.")
        except Exception as e: 
            await ctx.send(f"❌ Database error: {e}")

    async def handle_task(self, ctx, action, subaction, args):
        lock = self.get_lock(ctx.channel.id)
        async with lock:
            state = await get_race(ctx.channel.id)
            if not state or state.get('task_description') in (None, "No Active Node"): 
                return await ctx.send("❌ No active node.")
            
            display_name = await get_alias(ctx.guild.id, ctx.author.id, ctx.author.display_name)

            if action == "ofa":
                if subaction in ("cancel", "release"):
                    if not is_staff_member(ctx.author): return await ctx.send("❌ Staff only.")
                    await asyncio.to_thread(supabase.table("race_state").update({"pending_ofa_message_id": None, "pending_ofa_user_id": None}).eq("channel_id", ctx.channel.id).execute)
                    return await ctx.send("✅ Pending OFA claim cancelled.")
                    
                if subaction == "done":
                    if not state.get('ofa_holder_id') or (ctx.author.id != state['ofa_holder_id'] and not is_staff_member(ctx.author)): 
                        return await ctx.send("❌ You don't hold OFA.")
                    await asyncio.to_thread(supabase.table("race_state").update({"ofa_done": True}).eq("channel_id", ctx.channel.id).execute)
                    await log_race_action(ctx.guild.id, ctx.author.id, display_name, "ofa_done")
                    return await ctx.send(f"🎉 **OFA marked as COMPLETED** by {display_name}!")
                    
                if state.get('ofa_holder_id') or state.get('pending_ofa_message_id'): 
                    return await ctx.send("❌ OFA is already claimed or pending approval.")
                    
                msg = await ctx.send(f"🏆 **{display_name}** is claiming **OFA**! Staff: React ✅ to approve.")
                await msg.add_reaction("✅"); await msg.add_reaction("❌")
                await asyncio.to_thread(supabase.table("race_state").update({"pending_ofa_message_id": msg.id, "pending_ofa_user_id": ctx.author.id}).eq("channel_id", ctx.channel.id).execute)

            elif action in ("dmp", "dyp"):
                contribs = state.get('dyp_contributors') or []
                if str(ctx.author.id) in contribs: 
                    return await ctx.send("❌ You have already contributed for this node.")
                    
                new_prog = min(state.get('dyp_progress', 0) + 1, state.get('dyp_target', 0))
                contribs.append(str(ctx.author.id))
                await asyncio.to_thread(supabase.table("race_state").update({"dyp_progress": new_prog, "dyp_contributors": contribs}).eq("channel_id", ctx.channel.id).execute)
                await log_race_action(ctx.guild.id, ctx.author.id, display_name, "dyp_done")
                
                if new_prog >= state.get('dyp_target', 0): 
                    await ctx.send(f"🎉 **DYP Target Reached!** ({new_prog}/{state['dyp_target']})")
                else: 
                    await ctx.send(f"✅ DYP logged for **{display_name}**. Pending: `{new_prog}/{state['dyp_target']}`")

            elif action == "je":
                if not args: return await ctx.send("Usage: `!race je +500k` or `!race je done`")
                if args.lower() == "done":
                    await asyncio.to_thread(supabase.table("race_state").update({"je_done": True, "je_progress": state.get('je_target')}).eq("channel_id", ctx.channel.id).execute)
                    await log_race_action(ctx.guild.id, ctx.author.id, display_name, "je_done")
                    return await ctx.send(f"🎉 **JE completed** by {display_name}!")
                if args.startswith("+"):
                    try:
                        amt = parse_amount(args[1:])
                        curr = parse_amount(state.get('je_progress', '0'))
                        targ = parse_amount(state.get('je_target', '0'))
                        new_val = min(curr + amt, targ)
                        done = new_val >= targ
                        await asyncio.to_thread(supabase.table("race_state").update({"je_progress": format_amount(new_val), "je_done": done}).eq("channel_id", ctx.channel.id).execute)
                        await log_race_action(ctx.guild.id, ctx.author.id, display_name, "je_done")
                        await ctx.send(f"✅ JE logged for **{display_name}**. Progress: `{format_amount(new_val)}/{state['je_target']}`")
                        if done: await ctx.send("🎉 **JE Target Reached!**")
                    except ValueError: 
                        await ctx.send("❌ Invalid amount. Use `+500k`.")

    async def show_status(self, ctx):
        state = await get_race(ctx.channel.id)
        if not state: return await ctx.send("ℹ️ No race data found.")
        
        embed = discord.Embed(title="🏁 Current Race Node Status", color=discord.Color.blue())
        curr_lap = state.get('current_lap', 0)
        target = state.get('target_laps', 0)
        target_str = f" (Target: {target})" if target > 0 else ""
        sheet_str = f"\n**Sheet:** {state.get('active_race_sheet')}" if state.get('active_race_sheet') else ""
        
        embed.add_field(name="Progress", value=f"**Lap {curr_lap}.{state.get('current_node', 0)}**{target_str}{sheet_str}", inline=False)
        embed.add_field(name="Tasks", value=state.get('task_description', 'None'), inline=False)
        
        if state.get('task_description') == "No Active Node" or not state.get('task_description'):
            embed.add_field(name="OFA", value="Not Set ⏳", inline=True)
            embed.add_field(name="DYP", value="Not Set ⏳", inline=True)
            embed.add_field(name="JE", value="Not Set ⏳", inline=True)
            return await ctx.send(embed=embed)

        if state.get('ofa_holder_id'):
            holder = await get_alias(ctx.guild.id, state['ofa_holder_id'], f"<@{state['ofa_holder_id']}>")
            ofa_status = f"✅ Completed by {holder}" if state.get('ofa_done') else f"⏳ In Progress by {holder}"
            ofa_status += f" (Target: {state.get('ofa_target') or 'Not set'})"
        elif state.get('pending_ofa_message_id'): 
            ofa_status = f"⏳ Pending approval for <@{state['pending_ofa_user_id']}>"
        else: 
            ofa_status = f"Available ✅ (Target: {state.get('ofa_target') or 'Not set'})"
            
        embed.add_field(name="One For All (OFA)", value=ofa_status, inline=False)
        
        dyp_curr, dyp_targ = state.get('dyp_progress', 0), state.get('dyp_target', 0)
        embed.add_field(name="Do Your Part (DYP)", value="✅ Completed" if dyp_curr >= dyp_targ else f"{dyp_curr}/{dyp_targ} pending", inline=True)
        
        je_curr, je_targ = state.get('je_progress', '0'), state.get('je_target', '0')
        embed.add_field(name="Joint Effort (JE)", value="✅ Completed" if state.get('je_done') else f"{je_curr}/{je_targ} contributions", inline=True)
        
        await ctx.send(embed=embed)

    async def show_help(self, ctx):
        is_staff = is_staff_member(ctx.author)
        embed = discord.Embed(title="🏁 Race Commands", color=discord.Color.green())
        embed.add_field(name="Public Commands", value=(
            "`!race status`\n"
            "`!race ofa`\n"
            "`!race ofa done`\n"
            "`!race dmp`\n"
            "`!race je +500k`\n"
            "`!race je done`"
        ), inline=False)
        if is_staff: 
            embed.add_field(name="Staff Commands", value=(
                "`!race uploadsheet <name>`\n"
                "`!race use <name>`\n"
                "`!race next`\n"
                "`!race newnode <image>`\n"
                "`!race newnode 50 hatch | 10 breed | 5 craft`\n"
                "`!race set <desc|dyp|je|ofa> <value>`\n"
                "`!race target <number>`\n"
                "`!race ofa cancel`\n"
                "`!race clear`"
            ), inline=False)
        await ctx.send(embed=embed)

    @commands.Cog.listener()
    async def on_raw_reaction_add(self, payload):
        if payload.user_id == self.bot.user.id or str(payload.emoji) not in ("✅", "❌"): return
        
        guild = self.bot.get_guild(payload.guild_id)
        reactor = guild.get_member(payload.user_id) if guild else None
        if not reactor or not is_staff_member(reactor): return

        is_premium = await asyncio.to_thread(check_premium_status, guild.id)
        if not is_premium: return

        lock = self.get_lock(payload.channel_id)
        async with lock:
            state = await get_race(payload.channel_id)
            if not state or state.get('pending_ofa_message_id') != payload.message_id: return
            
            channel = self.bot.get_channel(payload.channel_id)
            user_id = state.get('pending_ofa_user_id')
            display_name = await get_alias(payload.guild_id, user_id, f"<@{user_id}>")
            
            if str(payload.emoji) == "✅":
                if state.get('ofa_holder_id'): 
                    await channel.send("❌ OFA was already claimed while this was pending.")
                else:
                    await asyncio.to_thread(supabase.table("race_state").update({
                        "ofa_holder_id": user_id, "ofa_done": False,
                        "pending_ofa_message_id": None, "pending_ofa_user_id": None
                    }).eq("channel_id", payload.channel_id).execute)
                    await log_race_action(payload.guild_id, user_id, display_name, "ofa_claim")
                    await channel.send(f"✅ OFA locked for **{display_name}**!")
            else:
                await asyncio.to_thread(supabase.table("race_state").update({
                    "pending_ofa_message_id": None, "pending_ofa_user_id": None
                }).eq("channel_id", payload.channel_id).execute)
                await channel.send("❌ OFA claim denied.")

async def setup(bot):
    await bot.add_cog(RaceTracker(bot))
