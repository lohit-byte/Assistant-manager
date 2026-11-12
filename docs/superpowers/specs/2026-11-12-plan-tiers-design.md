# Subscription plan tiers — design

**Date:** 2026-11-12
**Status:** approved and implemented (2026-11-12)
**Size:** small change (short design)

## Intent

Today the database records only `premium_status` (trial/premium/expired) plus a numeric
`max_teams`. The three paid plans differ only by `max_teams` and term; the plan itself is thrown
away after the webhook. Result: the dashboard cannot say which plan a guild bought, a lifetime
manual grant shows the expired paywall, any signed-in user can rewrite the subscription fields
through the anon key, and Paddle trusts a client-supplied `planId`, so a cheaper price can be
credited as Elite.

Goal: one stored plan per guild, one shared definition of "active premium" and "team limit" used
by bot and dashboard, and subscription writes that normal users cannot perform.

## Goals

- Store the purchased plan (`starter_monthly` / `pro_monthly` / `elite_yearly`) on the guild row.
- Dashboard shows the plan name and the plan's team allowance (1 / 3 / unlimited).
- Bot shows the plan in its team-limit message and grants `!force premium <tier>`.
- Elite is genuinely unlimited (numeric sentinel `1000000`, displayed as "Unlimited").
- Normal paid grants always expire (webhook and `!force` set an end date). A NULL
  `premium_ends_at` remains supported only for a **manual** lifetime grant made in the SQL editor;
  when present it is treated as active everywhere (fixes the paywall bug).
- An expired term does not keep premium team capacity on the dashboard (effective limit = 1).
- Subscription columns are writable only by the service role; `guilds` rows cannot be inserted or
  deleted by signed-in dashboard users.
- Paddle plan is derived from the price actually paid, not only from client `customData`.

## Non-goals

- No invoices/payment-history table (provider dashboards stay the record).
- No deferred/segmented downgrade of an active term (see decision below).
- No server-side enforcement of the `teams` row count (bot + dashboard UI stay the enforcement;
  this is team capacity, not billing).
- No change to staff scoping of non-billing guild config (existing trust model stays).
- No new checkout flow; the UX copy goes on the existing billing page and bot embeds.

## Approaches considered

**Plan storage.** (a) store a plan column and derive `max_teams` from it — chosen; (b) keep only
`max_teams` and infer — cannot distinguish a 3-team legacy row from Pro vs a manual grant.

**Unlimited representation.** (a) numeric sentinel `1000000` — chosen: every existing
`len(used) < max_teams` check keeps working, no NULL/default ambiguity; (b) `NULL` = unlimited —
smaller DB semantics but forces the bot to distinguish "missing row" from "unlimited" and risks
legacy rows becoming unlimited; (c) keep 99 — rejected, user asked for unlimited.

**Subscription write protection.** (a) column-level privileges on `guilds` (revoke table UPDATE,
grant the config columns) + revoke INSERT/DELETE — chosen, smallest change; dashboard keeps
saving roles/channels client-side, webhooks keep using the service role; (b) move every guild
write behind an API route — larger, would change the dashboard's write model.

**Paddle plan source.** (a) map `transaction.items[].price.id` → plan from `PRICING_PLANS`, then
fall back to `customData.planId` — chosen; (b) keep trusting `customData` — rejected, lets a
$10 price be credited as Elite.

**Downgrade while a paid term is active** (buying Starter while Elite is running):
- A. Apply immediately and warn on the plan card — smallest, end date still stacks. **Recommended.**
- B. Keep the higher team cap until the current end, then apply — needs pending fields, sweep
  changes, and interacts badly with stacked renewals.
- C. Reject downgrade until the term ends — new checkout validation and a worse support story.

## UX psychology applied (from the operator's UX Psychology & Conversion Design Guide)

- **Transparency / exact figures:** show the absolute pause date (not only "in 3 days") and a
  reminder timeline on the billing page: `Starts → 3-day reminder → 1-day reminder → pauses`.
- **Loss aversion, ethically:** expiry copy names what pauses (war timers, missing lists, race
  nodes, maze pings) and what is kept (history, setup, teams) instead of only "upgrade".
- **Single exact price in the action:** plan buttons carry the total (`Select Plan · $84`), no
  ranges, no arithmetic.
- **Goal gradient / no zero state:** keep the trial timeline and credit the existing setup head
  start; add the Day-5 reminder milestone.
- **Effort quantification / risk reversal:** "one click, nothing to re-enter; all history stays"
  next to the reactivate action.
- **Reminder messages:** premium reminders at 3 days and 1 day, plus a trial reminder at 2 days and
  a trial-ended notice; every embed uses Discord localized timestamps (`<t:UNIX:F>` / `<t:UNIX:R>`)
  so each user sees their own exact deadline.

## Design

**Schema** (`shared/schema.sql`, new migration block at the end, idempotent):

- `ALTER TABLE guilds ADD COLUMN IF NOT EXISTS plan TEXT`.
- Backfill legacy premium rows: `max_teams <= 1` → starter, `<= 3` → pro, else elite.
- Elite rows: `max_teams = 1000000`.
- `REVOKE UPDATE ON guilds` from `authenticated`/`anon`, then
  `GRANT UPDATE (war_channel_id, race_channel_id, maze_channel_id, absence_channel_id,
  leader_role_id, colead_role_id, staff_role_id, member_role_id)` to `authenticated`.
- `REVOKE INSERT, DELETE ON guilds` from `authenticated`/`anon`.

**Shared helpers** — new `dashboard/lib/plans.ts` (pure, imported by both browser and route code):

- `UNLIMITED_TEAMS = 1_000_000`, `PLAN_TEAMS` per plan id.
- `planForGuild(guild)` — stored plan, else inferred from `max_teams` (legacy).
- `isPremiumActive(guild, now)` — `premium` and (`premium_ends_at` NULL or in the future).
- `hasActiveAccess(guild, now)` — active premium or unexpired trial.
- `effectiveTeamLimit(guild, now)` — plan limit while access is active, otherwise 1.
- `planLabel(guild)` — "Starter Monthly"/"Pro Monthly"/"Elite Yearly", plus legacy/trial labels.
- `buildSubscriptionUpsert(existing, plan, orderId, now)` — returns the exact `guilds` upsert
  payload: `plan`, `max_teams`, `premium_status='premium'`, stacked `premium_ends_at`,
  `last_order_id`, `last_renewal_ping: 0`.
- `upsertSubscription(client, payload)` — service-role upsert with a one-retry fallback that
  drops `plan` if the column is missing (deploy-before-migration safety).

**Webhooks** — both write `plan`; Paddle resolves the plan from the paid price first, then
`customData`; unknown prices log an error and fall back to the customData/starter as today.

**Dashboard** — `Guild.plan` added to `lib/types.ts`; billing page uses `isPremiumActive`, shows the
plan name and allowance, and warns when a selected plan lowers the current team limit; Overview
and Server setup use `effectiveTeamLimit` (display "Unlimited", expired shows 1); the paywall no
longer appears for a lifetime grant.

**Bot** — `!force premium [starter|pro|elite]` writes plan + limit + lifetime end; team-limit
messages name the plan and allowance (both war and race).

## Tests / verification

- Python TDD: `!force premium` tier mapping, Elite unlimited, plan-aware limit message; full
  `python3 -m pytest tests -q`.
- TS offline checks in the existing style: new `scripts/check-plans.cjs` (activity/lifetime/
  effective limit/plan inference + upsert payload) and wire it into the repo scripts; run all
  `check:*` scripts plus `npx tsc --noEmit`.
- Manual SQL verification for the RLS grants is documented for the operator (cannot be exercised
  offline here): dashboard setup save still works, an anon-key update of `premium_status` fails.

## Implementation notes

- 2026-12 migration added at the end of `shared/schema.sql`; the webhooks and bot tolerate a
  deploy before it runs (upsert retry without `plan`, `select("*")` reads).
- Cashfree order ids keep the short s/p/e codes; `CASHFREE_PLAN_CODE` in `lib/plans.ts` is the
  single map shared by create-order and the webhook.
- `!force premium [starter|pro|elite]` grants an expiring term (30/365 days). A lifetime grant is
  still a manual SQL edit (`premium_ends_at = NULL`) and shows "Lifetime access (manual grant)".
- Reminder copy now uses Discord localized timestamps; a trial reminder runs at <= 48 hours plus
  an ended-trial notice. `last_renewal_ping` records both.

## Rollout

1. Run the new migration block in Supabase SQL editor.
2. Deploy dashboard (webhooks fall back safely even if step 1 is missed).
3. Deploy bot.
4. Grant yourself Elite: `!force premium elite` in the server, or the SQL upsert in the README.

## Rollback

Code revert is safe; the `plan` column and RLS grants can stay (they are additive). To undo the
privilege change: `GRANT UPDATE, INSERT, DELETE ON public.guilds TO authenticated;` (returns to the
old, weaker model).

## Calls made (check these)

- Unlimited sentinel is `1000000`, not `NULL`.
- Downgrades are immediate, with a dashboard warning (pending your answer).
- Bot keeps `premium_status`/`premium_ends_at` as the access gate; `plan` only drives capacity and
  display. Paid grants expire; only a manual SQL grant sets `premium_ends_at = NULL`, which is
  treated as active everywhere and labelled "Lifetime" in the UI.
- The dashboard still edits guild config client-side; only subscription columns are locked.
