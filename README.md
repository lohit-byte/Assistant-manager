# ⚔️ Monster Legends Team Manager Bot with Dashboard

A unified Discord bot and web dashboard designed for Monster Legends alliances to manage Wars, Races, and Maze Islands. Built as a SaaS platform with premium features unlocked via server subscriptions.

# ✨ Features

### ⚔️ War Tracker
* **Dynamic Timers:** 48-hour phase timers (Defense & Attack) managed via Discord commands.
* **Missing Attack Lists:** Track who missed attacks using an alias mapping system (no accidental `@mentions`).
* **Approval Workflows:** Staff can approve/reject player self-logged attacks.
* **Warning System:** Issue and track warnings with automatic DM notifications to players.

### 🏁 Race Tracker
* **Node Tracking:** Full support for OFA (One For All), DYP (Do Your Part), and JE (Joint Effort).
* **OCR Integration:** Built-in OCR to read race screenshots automatically via Discord.
* **Dynamic Targets:** Set team lap targets and track live progress.
* **Staff Overrides:** Manual contribution logging and corrections.

### 🗺️ Maze Island
* **Clock Syncing:** Sync the bot to the in-game countdown timer.
* **Automated Pings:** Schedule standard discount alerts (10%, 20%, 30%).
* **Manual Overrides:** Trigger immediate pings via Discord (`!maze ping`) or the Web Dashboard.
* **Player Preferences:** Players can opt-in/opt-out of ping notifications.

### 📊 Web Dashboard
* **Discord OAuth2:** Secure login and server selection.
* **Paywall & Trials:** 7-Day Free Trial system integrated with Cashfree subscriptions.
* **Server Setup:** Intuitive dropdowns to map Discord channels and roles.
* **Alias Management:** Player self-service alias creation with Staff override tables.
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

## 🧪 Tests
The bot tests run fully offline — no Discord/Supabase/OCR keys and no network
access are needed (fake Discord context + in-memory, FK-aware Supabase stand-in):

```bash
python -m pytest tests -q
```
