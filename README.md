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

### 🗺️ Maze Island
* **Clock Syncing:** Sync the bot to the in-game countdown timer.
* **Automated Pings:** Schedule standard discount alerts (10%, 20%, 30%).
* **Manual Overrides:** Trigger immediate pings via Discord (`!maze ping`) or the Web Dashboard.
* **Player Preferences:** Players can opt-in/opt-out of ping notifications.

### 📊 Web Dashboard
* **One-stop Overview:** Server settings, teams, captains and the live per-team snapshot on one page.
* **Teams & Captains:** Pair a war channel with a race channel, name the team, and assign captains who act as staff for that team only (bot commands + dashboard, never settings, billing or other teams).
* **Activity Rating:** One war + race score and grade (A+ … D) per player, visible to members; the raw attack log and undo trail stay staff/captain-only.
* **Discord OAuth2:** Secure login and server selection.
* **Paywall & Trials:** 7-Day Free Trial system integrated with Cashfree subscriptions.
* **Alias Management:** Player self-service alias creation, inline rename (live war lists move with the name) and Staff override tables.
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

**Security model (unchanged):** the dashboard talks to Supabase with the anon key, so the
RLS policies for `teams`, `team_captains` and `war_logs` are permissive for signed-in users,
exactly like the existing dashboard tables. Staff/captain scoping is enforced by the UI and by
the bot's service-role code, not by Postgres — a signed-in user who crafts API calls can write
these tables directly. If that trust model ever needs tightening, move dashboard writes behind
a server route that verifies Discord permissions before using the service role.


## 🧪 Tests
The bot tests run fully offline — no Discord/Supabase/OCR keys and no network
access are needed (fake Discord context + in-memory, FK-aware Supabase stand-in).
On a fresh Debian/Ubuntu box install the two test-only system packages first:

```bash
apt install -y python3-pytest python3-discord
python3 -m pytest tests -q
```
