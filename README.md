# ⚔️ Monster Legends Team Manager Bot & Dashboard

A unified Discord bot and web dashboard designed for Monster Legends alliances to manage Wars, Races, and Maze Islands. Built as a SaaS platform with premium features unlocked via server subscriptions.

## ✨ Features

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
* **Paywall & Trials:** 7-Day Free Trial system integrated with Stripe subscriptions.
* **Server Setup:** Intuitive dropdowns to map Discord channels and roles.
* **Alias Management:** Player self-service alias creation with Staff override tables.
* **Local Timezones:** Automatic conversion of Maze discount times to the user's local time.

## 🛠️ Tech Stack
* **Discord Bot:** Python (`discord.py`)
* **Dashboard Frontend:** Next.js (React) + Tailwind CSS
* **Backend & Database:** Supabase (PostgreSQL, Auth, Realtime)
* **Hosting:** Wispbyte (Bot) / Vercel (Dashboard)
* **Billing:** Stripe
