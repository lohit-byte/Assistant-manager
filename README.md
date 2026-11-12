# ⚔️ Monster Legends Team Manager Bot with Dashboard

A unified Discord bot and web dashboard designed for Monster Legends alliances to manage Wars, Races, and Maze Islands. Built as a SaaS platform with premium features unlocked via server subscriptions.

# ✨ Features

### ⚔️ War Tracker
* **Dynamic Timers:** 48-hour phase timers (Defense & Attack) managed via Discord commands.
* **Missing Attack Lists:** Track who missed attacks using an alias mapping system (no accidental `@mentions`).
* **One-tap "I attacked":** A persistent button on the live board, phase announcement and reminders; every tap is recorded in `war_logs` and removes the player from the missing list at the required count. Typing `attacks done` still works.
* **Approval Workflows:** Staff can approve/reject player self-logged attacks.
* **Warning System:** Issue and track warnings with automatic DM notifications to players.

### 🏁 Race Tracker
* **Node Tracking:** Full support for OFA (One For All), DYP (Do Your Part), and JE (Joint Effort).
* **Bundled Node Sheet:** One `nodesheet.json` on the bot host is the default sheet for every server (`!race next`, `!race use default`); per-server uploads still override it.
* **OCR Integration:** Built-in OCR to read race screenshots automatically via Discord.
* **Dynamic Targets:** Set team lap targets and track live progress.
* **Staff Overrides:** Manual contribution logging and corrections.

### 👥 Teams & rosters
* **Many teams per server:** a main team plus feeder/recruiting teams, each pairing its own war and race channel (set up from the dashboard).
* **Roster:** `!team list`, `!team players <team>`, `!team add @user <team>` (moves a player from their old team and cleans its active war lists) and `!team remove @user`. A rostered player needs an alias first.
* **Per-team war rules:** `!war set attacks <number>` and `!war set exempt on|off` in a team channel store that team's values; global staff values are only the fallback outside a team. Race is already per team channel; Maze stays server-wide.
* `!war missing add` and the 12h reminder validate against the team roster, so players who left a team/servers are flagged instead of pinged.

### 🗺️ Maze Island
* **Clock Syncing:** Sync the bot to the in-game countdown timer.
* **Automated Pings:** Schedule standard discount alerts (10%, 20%, 30%).
* **Manual Overrides:** Trigger immediate pings via Discord (`!maze ping`) or the Web Dashboard.
* **Player Preferences:** Players can opt-in/opt-out of ping notifications.

### 📊 Web Dashboard
* **One-stop Overview:** Server settings, teams, captains and the live per-team snapshot on one page.
* **Server setup page:** staff-only **Manage → Server setup** is the single place to link each subteam’s war and race channels, name the team, assign its captains, and set the **Leader**, **Helper staff (co-lead)** and **Staff** role IDs the bot treats as staff (the Overview and Settings pages link straight to it).
* **Teams & Captains:** Pair a war channel with a race channel, name the team, and assign up to **4 captains per team** (1 leader + 3 co-leads, matching the game) who act as staff for that team only (bot commands + dashboard, never settings, billing or other teams).
* **Activity Rating:** One war + race score and grade (A+ … D) per player, visible to members; the raw attack log and undo trail stay staff/captain-only.
* **Discord OAuth2:** Secure login and server selection. The landing page offers **Sign in** next to **Start free trial**, so returning staff reopen their dashboard without starting a new trial.
* **Light & Dark appearance:** a per-browser Light / Dark / Match device switch under **Settings**, applied before first paint (no flash) and remembered on that device.
* **In-context help and confirmations:** every staff control explains what it changes, and every successful save, edit or delete shows a success notification so staff can see it worked.
* **Paywall & Trials:** 7-Day Free Trial system integrated with Cashfree subscriptions.
* **Alias Management:** Player self-service alias creation, inline rename (live war lists move with the name), Staff override tables, and departed-member checks — `!alias list` flags members who left and `!alias prune` removes them from the alias list and active war lists.
* **Local Timezones:** Automatic conversion of Maze discount times to the user's local time.

## 🛠️ Tech Stack
* **Discord Bot:** Python (`discord.py`)
* **Dashboard Frontend:** Next.js (React) + Tailwind CSS
* **Backend & Database:** Supabase (PostgreSQL, Auth, Realtime)
* **Hosting:** Wispbyte (Bot) / Vercel (Dashboard)
* **Billing:** Cashfree

## 💼 Subscription & Support
* **This platform operates on a Server Premium model. The first 7 days are free (Trial)
*  **If you have any billing issues or need to claim subscription manually, please email to warbot.support@gmail.com

*  Created by [lohit/lohit-byte]

## ⚙️ Bot environment variables
Set these as process environment variables (Fly secrets / Wispbyte env) or in a
`.env` file at the repo root. The file is gitignored — never commit it.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot login token |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | yes | Service-role key (server-side only, bypasses RLS) |
| `OCR_SPACE_API_KEY` | for race OCR | ocr.space key used by `!race newnode <image>` |
| `DASHBOARD_URL` | optional | Link shown in billing notices |
| `NODESHEET_PATH` | optional | Path to the bundled race node sheet. Defaults to `nodesheet.json` in the bot's working directory |

## 🔐 Bot intents and permissions

Enable both **privileged intents** in the Discord Developer Portal (Bot → Privileged
Gateway Intents) before inviting the bot:

| Intent | Why the bot needs it |
| --- | --- |
| **Message Content** | `!commands`, `attacks done` messages and race screenshot attachments |
| **Server Members** | member lists, staff/captain role checks, `!ids members`, `!roles` |

The invite URL lives in `dashboard/lib/constants.ts` and requests the permissions the
bot may use: View Channels, Send Messages, Manage Messages, Embed Links, Attach Files,
Read Message History, Mention Everyone and Add Reactions (`permissions=257088`).
No bot command assigns roles, so **Manage Roles is not required** — `!war set role`
only stores which role the channel's announcements ping.

If a server re-invites the bot with fewer permissions, live boards, embeds and
war/maze pings fail silently; re-invite with that URL after granting the two intents.

## 🗂️ Race node sheet

The bot reads one shared node sheet from disk and offers it as **default (bundled)** to every
server. It is used by `!race next` when the channel has no active sheet and can be selected
with `!race use default`. A per-server `!race uploadsheet` still overrides it.

Create a `nodesheet.json` next to the bot (or point `NODESHEET_PATH` at it). The shape is the
same JSON the race page and `!race uploadsheet` already accept — keyed by `lap.node`, nodes
1–5, with the three task texts:

```json
{
  "0.1": { "ofa": "OFA task text", "dyp": "DYP task text", "je": "JE task text" },
  "0.2": { "ofa": "OFA task text", "dyp": "DYP task text", "je": "JE task text" }
}
```

Upload the real file through the Wispbyte file manager (or `NODESHEET_PATH`). A bad top-level
file is ignored; a single bad node is skipped — the rest of the sheet keeps working.
`nodesheet.example.json` in the repo shows the format.

## 🚀 Deploying this version

1. **Supabase:** open `shared/schema.sql` and run everything from the
   `MIGRATIONS for existing databases` heading to the end of the file in the SQL editor
   (paste the whole block in one go). It adds the missing columns, creates `teams`,
   `team_captains` and `war_logs`, and installs the idempotent RLS policies. Safe to re-run.
   The `CREATE TABLE` statements earlier in the file are the fresh-install schema and are
   not part of this migration.
2. **Bot:** upload `nodesheet.json` (optional) and redeploy. The bot keeps working without the
   migration, but captain checks and the attack log need the new tables.
3. **Dashboard:** redeploy (Vercel). Then open **Overview → Setup**, add each team (or import
   the channels the bot already tracks), assign captains, and save.

**Security model:** the bot talks to Supabase with the service-role key (it bypasses RLS);
the dashboard uses the anon key with a signed-in Supabase user. Every dashboard table now has
RLS enabled with an `authenticated` policy, so anonymous PostgREST calls cannot read or write
it (including `guilds.premium_status`). Staff/captain *scoping* is still enforced by the UI and
by the bot's service-role code, not by Postgres — a signed-in user who crafts API calls can
write guild data directly. If that trust model needs tightening, move dashboard writes behind a
server route that verifies Discord permissions before using the service role.


## 🧪 Tests
The bot tests run fully offline — no Discord/Supabase/OCR keys and no network
access are needed (fake Discord context + in-memory, FK-aware Supabase stand-in).
On a fresh Debian/Ubuntu box install the two test-only system packages first:

```bash
apt install -y python3-pytest python3-discord
python3 -m pytest tests -q
```
