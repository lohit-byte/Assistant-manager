# Subscription Plan Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and display the purchased plan (Starter 1 team / Pro 3 teams / Elite unlimited) across bot and dashboard, fix lifetime-premium display, and make subscription state writable only by the service role.

**Architecture:** A new pure `dashboard/lib/plans.ts` is the single source of truth for plan ids, team limits, premium-activity checks and the webhook upsert payload. Both payment webhooks write a `plan` column plus a numeric `max_teams` (Elite = `1000000`). The dashboard reads those helpers for display/limits; the bot keeps using `max_teams` and only adds plan-aware messaging and a tier argument to `!force premium`. Postgres column privileges lock subscription columns to the service role.

**Tech Stack:** Next.js 14 (App Router, route handlers), Supabase Postgres + RLS, python discord.py bot, pytest offline fakes, node assert-style checks with local `tsc` (existing `dashboard/scripts/check-*.cjs` pattern).

**Spec:** `docs/superpowers/specs/2026-11-12-plan-tiers-design.md`

## Global Constraints

- Plan ids are exactly `starter_monthly`, `pro_monthly`, `elite_yearly`.
- Team limits: Starter 1, Pro 3, Elite `1000000` (`UNLIMITED_TEAMS`), displayed as "Unlimited".
- `premium_ends_at IS NULL` with `premium_status='premium'` means lifetime-active, everywhere.
- `plan` column is nullable for legacy rows; infer only from `max_teams` 1→starter, 3→pro, ≥99→elite; anything else → unknown/null.
- SQL migration block must be idempotent and appended to `shared/schema.sql`.
- No new npm/pip dependencies.
- Existing tests must keep passing; all commands run from `dashboard/` or repo root as stated.
- Webhooks keep working before the migration is applied (retry upsert without `plan`).
- Downgrades apply immediately (team limit changes now) while paid time stacks; dashboard must warn.

## Review Focus

1. A payment webhook arriving before the SQL migration must still upgrade the guild (fallback upsert without `plan`).
2. Lifetime premium (`premium_ends_at = NULL`) must never show the expired paywall or be treated as inactive.
3. Buying a cheaper plan mid-term must lower the team limit immediately, extend the end date from the current end, and the billing page must warn before checkout.
4. Elite must be effectively infinite in the bot/dashboard (`1000000`), displayed as "Unlimited", never as "1000000".
5. Legacy rows: `plan` NULL with `max_teams` 1/3/99 resolve correctly; expired guilds get effective limit 1 regardless of stored capacity.
6. After the RLS grant change, the dashboard's Server setup save (roles + maze channel) must still work, while an anon-key update of `premium_status` must fail.

---

### Task 1: Pure plan helpers + offline checks

**Files:**
- Create: `dashboard/lib/plans.ts`
- Create: `dashboard/scripts/check-plans.cjs`
- Modify: `dashboard/package.json` (add `check:plans` script after `check:setup`)

**Interfaces:**
- Consumes: `PRICING_PLANS` / `PlanId` from `dashboard/lib/pricing.ts` (existing).
- Produces (all exported from `dashboard/lib/plans.ts`):
  - `UNLIMITED_TEAMS: number` (1000000)
  - `PLAN_TEAMS: Record<PlanId, number>`
  - `planById(id: string | null | undefined): PlanId | null`
  - `planForGuild(guild: { plan?: string | null; max_teams?: number | null }): PlanId | null`
  - `isPremiumActive(guild: { premium_status?: string | null; premium_ends_at?: string | null }, now?: Date): boolean`
  - `hasActiveAccess(guild: { premium_status?: string | null; premium_ends_at?: string | null; trial_ends_at?: string | null }, now?: Date): boolean`
  - `effectiveTeamLimit(guild: { plan?: string | null; max_teams?: number | null; premium_status?: string | null; premium_ends_at?: string | null; trial_ends_at?: string | null }, now?: Date): number`
  - `planLabel(guild: { plan?: string | null; max_teams?: number | null }): string`
  - `teamLimitLabel(limit: number): string` ("Unlimited" when `>= UNLIMITED_TEAMS`)
  - `planFromPaddleItems(items: Array<{ price?: { id?: string } | null }>, customDataPlanId?: string | null): PlanId | null`
  - `interface SubscriptionState { premium_ends_at?: string | null; last_order_id?: string | null }`
  - `interface SubscriptionUpdate { plan: PlanId; max_teams: number; premium_status: 'premium'; premium_ends_at: string; last_order_id: string; last_renewal_ping: 0 }`
  - `buildSubscriptionUpsert(existing: SubscriptionState | null, planId: PlanId, orderId: string, now?: Date): SubscriptionUpdate`

- [ ] **Step 1: Write the failing check script** `dashboard/scripts/check-plans.cjs`

Follow the structure of `scripts/check-setup.cjs` (compile `lib/plans.ts` with local `tsc` to `.tmp-plans-check`, then `require` the compiled module and run fixtures). Fixtures and expected values:

```js
// isPremiumActive / lifetime
assert.equal(isPremiumActive({ premium_status: 'premium', premium_ends_at: null }), true)          // lifetime
assert.equal(isPremiumActive({ premium_status: 'premium', premium_ends_at: '2020-01-01T00:00:00Z' }, NOW), false)
assert.equal(isPremiumActive({ premium_status: 'expired', premium_ends_at: null }), false)

// effectiveTeamLimit
assert.equal(effectiveTeamLimit({ premium_status: 'trial', trial_ends_at: '2099-01-01T00:00:00Z', plan: null, max_teams: 1 }, NOW), 1)
assert.equal(effectiveTeamLimit({ premium_status: 'premium', premium_ends_at: '2099-01-01T00:00:00Z', plan: 'pro_monthly', max_teams: 3 }, NOW), 3)
assert.equal(effectiveTeamLimit({ premium_status: 'premium', premium_ends_at: null, plan: 'elite_yearly', max_teams: UNLIMITED_TEAMS }, NOW), UNLIMITED_TEAMS)
assert.equal(effectiveTeamLimit({ premium_status: 'expired', premium_ends_at: '2020-01-01T00:00:00Z', plan: 'elite_yearly', max_teams: UNLIMITED_TEAMS }, NOW), 1)
assert.equal(effectiveTeamLimit({ premium_status: 'premium', premium_ends_at: '2099-01-01T00:00:00Z', plan: null, max_teams: 3 }, NOW), 3) // legacy

// plan inference / labels
assert.equal(planForGuild({ plan: null, max_teams: 1 }), 'starter_monthly')
assert.equal(planForGuild({ plan: null, max_teams: 3 }), 'pro_monthly')
assert.equal(planForGuild({ plan: null, max_teams: 99 }), 'elite_yearly')
assert.equal(planForGuild({ plan: null, max_teams: 10 }), null)
assert.equal(planForGuild({ plan: 'elite_yearly', max_teams: 1 }), 'elite_yearly')
assert.equal(planLabel({ plan: 'elite_yearly' }), 'Elite Yearly')
assert.equal(teamLimitLabel(UNLIMITED_TEAMS), 'Unlimited')
assert.equal(teamLimitLabel(3), '3')

// Paddle plan resolution: paid price wins, customData is fallback only
assert.equal(planFromPaddleItems([{ price: { id: PRICING_PLANS[0].paddlePriceId } }], 'elite_yearly'), 'starter_monthly')
assert.equal(planFromPaddleItems([{ price: { id: 'unknown' } }], 'elite_yearly'), 'elite_yearly')
assert.equal(planFromPaddleItems([{ price: { id: 'unknown' } }], null), null)

// Upsert: stacks from a future end; downgrade is immediate + stacks; expired restarts from now
const now = new Date('2026-11-12T00:00:00Z')
const active = { premium_ends_at: '2026-12-01T00:00:00Z', last_order_id: 'old' }
assert.equal(buildSubscriptionUpsert(active, 'pro_monthly', 'new', now).premium_ends_at, '2026-12-31T00:00:00.000Z')
const downgraded = buildSubscriptionUpsert({ premium_ends_at: '2026-12-01T00:00:00Z' }, 'starter_monthly', 'new', now)
assert.equal(downgraded.plan, 'starter_monthly')
assert.equal(downgraded.max_teams, 1)
assert.equal(downgraded.premium_ends_at, '2026-12-31T00:00:00.000Z') // end keeps stacking
const expired = buildSubscriptionUpsert({ premium_ends_at: '2026-01-01T00:00:00Z' }, 'elite_yearly', 'new', now)
assert.equal(expired.premium_ends_at, '2027-11-12T00:00:00.000Z') // now + 365 days
assert.equal(expired.premium_status, 'premium')
assert.equal(expired.last_renewal_ping, 0)
```

Also add `"check:plans": "node scripts/check-plans.cjs"` to `dashboard/package.json`.

- [ ] **Step 2: Run it to verify it fails**

Run from `dashboard/`: `npm run check:plans`
Expected: FAIL — `lib/plans.ts` does not exist / compile error.

- [ ] **Step 3: Implement `dashboard/lib/plans.ts`**

Rules: `isPremiumActive` requires status `premium` and (`premium_ends_at` null OR parseable and > now); an unparseable date is inactive (matches bot). `hasActiveAccess` = premium active OR (`trial` and `trial_ends_at` future). `effectiveTeamLimit`: if `hasActiveAccess` is false → 1; else plan = `planForGuild`; return `PLAN_TEAMS[plan]` when plan is known, else `max_teams ?? 1` for legacy. `buildSubscriptionUpsert` base date = later of now and existing future `premium_ends_at`; add plan term days (`cadence === 'year' ? 365 : 30`); return the exact `SubscriptionUpdate` shape.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run check:plans` → PASS (exit 0, no FAIL lines).

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/plans.ts dashboard/scripts/check-plans.cjs dashboard/package.json
git commit -m "feat: shared plan/team-limit helpers"
```

---

### Task 2: Schema migration, Guild type, README

**Files:**
- Modify: `shared/schema.sql` (append a new migration block at end)
- Modify: `dashboard/lib/types.ts` (`Guild` gains `plan: string | null`)
- Modify: `README.md` (security-model paragraph + deploy step mentioning migration)

**Interfaces:**
- Produces: `guilds.plan TEXT` (nullable), Elite rows `max_teams = 1000000`, subscription columns writable only by service role.

- [ ] **Step 1: Append the migration block to `shared/schema.sql`**

```sql
-- ----------------------------------------------------------------------------
-- MIGRATION 2026-12: plan tiers, unlimited Elite, locked subscription columns.
-- Run the whole block in the Supabase SQL editor. Idempotent; safe to re-run.
-- ----------------------------------------------------------------------------
ALTER TABLE guilds ADD COLUMN IF NOT EXISTS plan TEXT; -- 'starter_monthly' | 'pro_monthly' | 'elite_yearly'

-- Backfill legacy paid guilds from the old team cap (99 was Elite).
UPDATE guilds
   SET plan = CASE
         WHEN max_teams IS NULL OR max_teams <= 1 THEN 'starter_monthly'
         WHEN max_teams <= 3 THEN 'pro_monthly'
         ELSE 'elite_yearly'
       END
 WHERE plan IS NULL AND premium_status = 'premium';

UPDATE guilds SET max_teams = 1000000 WHERE plan = 'elite_yearly' AND (max_teams IS NULL OR max_teams < 1000000);

-- Subscription columns are written only by the service role (webhooks/bot/SQL editor).
-- The dashboard keeps writing the server-config columns from the browser.
REVOKE UPDATE ON public.guilds FROM authenticated, anon;
REVOKE INSERT, DELETE ON public.guilds FROM authenticated, anon;
GRANT UPDATE (war_channel_id, race_channel_id, maze_channel_id, absence_channel_id,
              leader_role_id, colead_role_id, staff_role_id, member_role_id)
  ON public.guilds TO authenticated;
```

- [ ] **Step 2: Add `plan` to the `Guild` type**

In `dashboard/lib/types.ts`, after `max_teams: number | null`, add `plan: string | null`.

- [ ] **Step 3: Update README security + deploy notes**

In the "Deploying this version" numbered list, note that step 1 must include the 2026-12 migration block (it is inside the MIGRATIONS section the README already tells operators to paste). In the Security model paragraph, add one sentence: plan/subscription columns are service-role only; a signed-in user can still edit server config columns but cannot change premium status, plan, team cap or blacklist.

- [ ] **Step 4: Verify**

Run from `dashboard/`: `npx tsc --noEmit`
Expected: exit 0 (no output). Review the SQL block by eye for `IF NOT EXISTS` / idempotent `UPDATE`s.

- [ ] **Step 5: Commit**

```bash
git add shared/schema.sql dashboard/lib/types.ts README.md
git commit -m "feat: plan column, unlimited elite, locked subscription columns"
```

---

### Task 3: Webhooks persist the plan

**Files:**
- Create: `dashboard/lib/subscription.ts`
- Modify: `dashboard/app/api/cashfree/webhook/route.ts`
- Modify: `dashboard/app/api/paddle/webhook/route.ts`

**Interfaces:**
- Consumes from Task 1: `planById`, `planFromPaddleItems`, `buildSubscriptionUpsert`, `SubscriptionUpdate`.
- Produces: `upsertGuildSubscription(client: SupabaseClient, guildId: string, update: SubscriptionUpdate): Promise<void>` in `dashboard/lib/subscription.ts`.

- [ ] **Step 1: Write the fallback helper (no separate test runner; covered by typecheck + review)**

`upsertGuildSubscription` calls `client.from('guilds').upsert({ guild_id: guildId, ...update }, { onConflict: 'guild_id' })`. If the error message mentions `'plan'` (PostgREST `PGRST204` before the migration), retry once with `plan` removed and log a warning. Rethrow any other error.

- [ ] **Step 2: Rewrite the Cashfree webhook's plan handling**

Delete the local `PLAN_CODES`; parse `planCode` from the order id as today, map with `planById`, and on a valid plan use `buildSubscriptionUpsert(existing, planId, orderId)` then `upsertGuildSubscription(...)`. Keep signature verification, `PAYMENT_SUCCESS_WEBHOOK` filter, and `last_order_id` idempotency exactly as they are.

- [ ] **Step 3: Rewrite the Paddle webhook's plan handling**

Resolve the plan with `planFromPaddleItems(transaction.items, customData?.planId) ?? 'starter_monthly'`; if the result came from the fallback (not from a matched price), `console.error` it. Use `buildSubscriptionUpsert(existing, planId, transaction.id)` + `upsertGuildSubscription(...)`. Keep the existing guild-id validation and idempotency.

- [ ] **Step 4: Verify**

Run from `dashboard/`: `npx tsc --noEmit` → exit 0; `npm run check:plans` → PASS.
Manual review: both webhooks no longer set `premium_status`/`max_teams` inline; both write `plan`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/subscription.ts dashboard/app/api/cashfree/webhook/route.ts dashboard/app/api/paddle/webhook/route.ts
git commit -m "fix: webhooks persist plan and derive paddle plan from paid price"
```

---

### Task 4: Dashboard shows and enforces the plan

**Files:**
- Modify: `dashboard/app/dashboard/[guildId]/billing/page.tsx`
- Modify: `dashboard/app/dashboard/[guildId]/page.tsx`
- Modify: `dashboard/components/team-setup.tsx`
- Modify: `dashboard/lib/setup.ts`
- Modify: `dashboard/scripts/check-setup.cjs`

**Interfaces:**
- Consumes from Task 1: `isPremiumActive`, `effectiveTeamLimit`, `planForGuild`, `planLabel`, `teamLimitLabel`, `PLAN_TEAMS`, `UNLIMITED_TEAMS`.

- [ ] **Step 1: Billing page — lifetime fix, plan display, downgrade warning, psychology copy**

Replace `const isPremium = status === 'premium' && premiumEnd !== null && ...` with `const isPremium = isPremiumActive(guild ?? {})` (and use `effectiveTeamLimit(guild ?? {})` / `planLabel(guild ?? {})` so the first render before the guild row arrives does not throw). In the active card, show `planLabel(guild)` and `teamLimitLabel(effectiveTeamLimit(guild))` (e.g. "Elite Yearly · Unlimited teams"). When `premiumEnd` is null and `isPremium`, show a "Lifetime access (manual grant)" chip instead of the expiry bar; otherwise show the absolute pause date with `formatDate(premiumEnd)` next to the existing remaining-time chip, plus one muted line: "Reminders 3 days and 1 day before; tracking pauses on {date}."

In both plan-card maps, when `isPremium` and the card's plan has fewer teams than the current effective limit, render one line under the button: "Switching to {plan.name} lowers this server to {n} team(s) immediately; paid time still stacks." Change the action button labels to carry the exact total: `{isPremium ? 'Extend' : 'Select'} · {formatPrice(plan.price[currency], currency)}` (no ranges, no arithmetic).

Apply the UX guide's transparency/loss-aversion patterns: on the expired panel add "Tracking paused since {formatDate(premiumEnd)}", state exactly what pauses and that history/teams/aliases are kept, and label the CTA with the cost of inaction ("Reactivate — one click, nothing to re-enter"). In the trial "What happens next" ordered list add a "Day 5" milestone: "Reminder that the trial ends in 2 days — bot keeps running until Day 7." Keep the existing expired paywall condition (`!isPremium && (!isTrial || trialExpired)`), which now only fires for genuinely expired guilds.

- [ ] **Step 2: Overview page — effective limit, Unlimited label in checklist**

Replace `maxTeams: guild.max_teams` with `maxTeams: effectiveTeamLimit(guild)` in the `buildSetupSummary` call. In `lib/setup.ts`, import `UNLIMITED_TEAMS` from `./plans` and format the Teams value as `${teamCount} of ${maxTeams >= UNLIMITED_TEAMS ? 'Unlimited' : maxTeams}`. Add one fixture to `scripts/check-setup.cjs`: `buildSetupSummary({ teamCount: 0, maxTeams: UNLIMITED_TEAMS })` yields value `'0 of Unlimited'`. Leave the `PLAN_META` status chip as is.

- [ ] **Step 3: Server setup — effective limit + Unlimited label**

In `team-setup.tsx`, replace `const maxTeams = guild.max_teams ?? 1` with `const maxTeams = effectiveTeamLimit(guild)`; `atTeamLimit` stays `teams.length >= maxTeams` (1000000 is effectively never reached). Render the badge as `{teams.length}/{teamLimitLabel(maxTeams)}` and the "up to N teams" sentence using `teamLimitLabel(maxTeams)` (lowercase "unlimited" in prose is fine: `teamLimitLabel(limit).toLowerCase()` when limit is unlimited, otherwise the number).

- [ ] **Step 4: Verify**

Run from `dashboard/`:
- `npx tsc --noEmit` → exit 0
- `npm run check:plans && npm run check:setup && npm run check:rating && npm run check:attendance` → all PASS

- [ ] **Step 5: Commit**

```bash
git add "dashboard/app/dashboard/[guildId]/billing/page.tsx" "dashboard/app/dashboard/[guildId]/page.tsx" dashboard/components/team-setup.tsx
git commit -m "feat: dashboard shows plan and enforces effective team limit"
```

---

### Task 5: Bot knows the plan

**Files:**
- Modify: `bot/main.py` (`force_command`, `PLAN_TIERS` constant)
- Modify: `bot/cogs/war.py` (`check_team_limit` + call site)
- Modify: `bot/cogs/race.py` (`check_team_limit` + call site)
- Modify: `tests/test_bot.py`

**Interfaces:**
- Produces: `PLAN_TIERS = {"starter": ("starter_monthly", 1), "pro": ("pro_monthly", 3), "elite": ("elite_yearly", 1000000)}` in `bot/main.py`; both `check_team_limit` functions return `tuple[bool, str, int]` = `(allowed, plan_or_empty, limit)`.

- [ ] **Step 1: Write failing bot tests in `tests/test_bot.py`**

```python
def test_force_premium_sets_the_requested_tier_with_a_term(clean_db):
    db = clean_db
    db.reset()
    db.seed("guilds", {"guild_id": GUILD, "premium_status": "expired",
                       "premium_ends_at": "2020-01-01T00:00:00+00:00"})
    import main as botmain
    ctx = make_ctx(author_id=botmain.DEVELOPER_ID)
    before = datetime.now(timezone.utc)
    run(botmain.force_command.callback(ctx, "premium", "starter"))
    row = db.one("guilds", guild_id=GUILD)
    assert row["plan"] == "starter_monthly"
    assert row["max_teams"] == 1
    ends = datetime.fromisoformat(row["premium_ends_at"].replace("Z", "+00:00"))
    assert timedelta(days=29) < ends - before < timedelta(days=31)

def test_force_premium_defaults_to_elite_unlimited_with_a_year(clean_db):
    db = clean_db
    db.reset()
    db.seed("guilds", {"guild_id": GUILD, "premium_status": "expired"})
    import main as botmain
    ctx = make_ctx(author_id=botmain.DEVELOPER_ID)
    before = datetime.now(timezone.utc)
    run(botmain.force_command.callback(ctx, "premium"))
    row = db.one("guilds", guild_id=GUILD)
    assert row["plan"] == "elite_yearly"
    assert row["max_teams"] == 1_000_000
    ends = datetime.fromisoformat(row["premium_ends_at"].replace("Z", "+00:00"))
    assert timedelta(days=364) < ends - before < timedelta(days=366)

def test_team_limit_message_names_the_plan(clean_db):
    db = clean_db
    db.one("guilds", guild_id=GUILD)["max_teams"] = 1
    db.one("guilds", guild_id=GUILD)["plan"] = "starter_monthly"
    db.seed("race_state", {"channel_id": 20, "guild_id": GUILD,
                           "task_description": "Team A", "is_event_active": False})
    ctx = make_ctx(channel_id=CHANNEL)
    run(call(RaceTracker.race_group, race_cog(), ctx, "set", args="desc Team B"))
    assert any("Starter" in text and "1" in text for text in ctx.texts)

def test_elite_team_limit_is_unlimited(clean_db):
    db = clean_db
    db.one("guilds", guild_id=GUILD)["max_teams"] = 1_000_000
    db.seed("race_state", {"channel_id": 20, "guild_id": GUILD,
                           "task_description": "Team A", "is_event_active": False})
    assert run(race.check_team_limit(GUILD))[0] is True

def test_trial_reminder_sends_once_at_two_days(clean_db):
    db = clean_db
    bot, guild, _channel = _maze_bot()
    manager = object.__new__(BillingManager)
    manager.bot = bot
    row = db.one("guilds", guild_id=GUILD)
    row.update({"premium_status": "trial",
                "trial_ends_at": (datetime.now(timezone.utc) + timedelta(hours=30)).isoformat(),
                "last_renewal_ping": 0})
    run(manager._process_trial_guild(dict(row), datetime.now(timezone.utc)))
    assert db.one("guilds", guild_id=GUILD)["last_renewal_ping"] == 1
    assert guild.owner.dms, "owner should get a trial-ending DM"

def test_billing_embeds_use_absolute_timestamps(clean_db):
    db = clean_db
    bot, guild, _channel = _maze_bot()
    manager = object.__new__(BillingManager)
    manager.bot = bot
    row = db.one("guilds", guild_id=GUILD)
    row.update({"premium_status": "premium",
                "premium_ends_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
                "last_renewal_ping": 0})
    run(manager._process_guild(dict(row), datetime.now(timezone.utc)))
    embed = guild.owner.dms[-1]
    joined = " ".join(str(getattr(embed, "description", "")) + " " + str(getattr(embed, "title", "")))
    assert "<t:" in joined
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m pytest tests/test_bot.py -q -k "force_premium or team_limit_message or elite_team_limit"`
Expected: FAIL (force tier arg not accepted; message has no plan; `check_team_limit` returns bool not tuple).

- [ ] **Step 3: Implement bot changes**

- `main.py`: `PLAN_TIERS` as above; `async def force_command(ctx, action: str = None, tier: str = None)`. On `action.lower() == "premium"`, resolve `tier_name = (tier or "elite").lower()`; `usage` message lists `starter|pro|elite`; unknown tier → error message. Update payload with `plan`, `max_teams`, and an **expiring** `premium_ends_at` = now + plan days (30 for starter/pro, 365 for elite), `last_renewal_ping: 0`. Keep the guild-row existence guard and the permission check.

In `cogs/billing.py`, rewrite the reminder copy per the UX guide: every embed includes a Discord timestamp (`<t:{int(ends_at.timestamp())}:F>` and `:R>`), names what pauses (war timers, missing lists, race nodes, maze pings) and what is kept (history, teams, aliases), and ends with a one-click reactivate link. Add `._process_trial_guild(row, now)` (trial status, end <= 48h → send once, marker 1; already ended → send once, marker -1) and extend `check_expirations` to also query `premium_status = "trial"` and call it per row with the same per-row try/except. The `_update_if_unchanged` guard applies to trial writes too.
- `war.py` / `race.py`: select `plan, max_teams`; `limit = row.get("max_teams") or 1`; return `(len(active) < limit, row.get("plan") or "", limit)`. At the call sites, unpack and build the message: `f"❌ **Team limit reached!** The {PLAN_NAMES.get(plan, 'current')} plan allows {limit} team(s). Upgrade on the dashboard to add more."` with `PLAN_NAMES = {"starter_monthly": "Starter", "pro_monthly": "Pro", "elite_yearly": "Elite"}` (define in each cog or a tiny shared import; keep it local to avoid new modules).

- [ ] **Step 4: Run the focused tests, then the full suite**

Run: `python3 -m pytest tests -q`
Expected: all pass (0 failed), including the four new tests and the existing `test_team_limit_blocks_second_team_via_set_desc` / `test_force_premium_clears_a_past_expiry`.

- [ ] **Step 5: Commit**

```bash
git add bot/main.py bot/cogs/war.py bot/cogs/race.py tests/test_bot.py
git commit -m "feat: bot persists plan tier and shows plan-aware team limits"
```

---

### Task 6: Final verification, operator SQL, graph refresh

**Files:**
- Modify: `docs/superpowers/specs/2026-11-12-plan-tiers-design.md` (status → approved)
- Produces: final report with the exact SQL the operator must run

- [ ] **Step 1: Run every check fresh**

From `dashboard/`: `npx tsc --noEmit && npm run check:plans && npm run check:setup && npm run check:rating && npm run check:attendance`
From repo root: `python3 -m pytest tests -q`
Expected: tsc exit 0; every check exits 0; pytest 0 failed.

- [ ] **Step 2: Re-read the spec and tick each goal**

Check: plan stored (Task 3), dashboard plan display (Task 4), bot plan display (Task 5), unlimited Elite (Tasks 1/2/4/5), lifetime active (Task 4), expired effective limit 1 (Task 1/4), subscription columns locked (Task 2), Paddle price-derived plan (Task 3). Report any gap instead of claiming completion.

- [ ] **Step 3: Refresh the graph**

Run: `graphify update .` (repo root). If graphify is unavailable, say so in the report.

- [ ] **Step 4: Commit the docs/plan**

```bash
git add docs/superpowers/plans/2026-11-12-plan-tiers.md docs/superpowers/specs/2026-11-12-plan-tiers-design.md
git commit -m "docs: plan tiers design and implementation plan"
```

- [ ] **Step 5: Hand the operator the migration**

Report the exact `shared/schema.sql` 2026-12 block (or tell them to run from the `MIGRATIONS` heading to end of file), the verification query `select guild_id, premium_status, plan, max_teams, premium_ends_at from guilds where guild_id = <id>;`, and the two grants to test manually (`!force premium elite`; dashboard Server setup save still works).
