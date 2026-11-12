#!/usr/bin/env node
/**
 * Offline check for the pure subscription-plan helpers (`lib/plans.ts`).
 *
 * Compiles the helper with the local TypeScript compiler, then runs fixtures over the compiled
 * module. No Supabase, no network, no test framework — same approach as `scripts/check-setup.cjs`.
 *
 * Run with `npm run check:plans` from `dashboard/`.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TMP_DIR = path.join(ROOT, '.tmp-plans-check')
const ENTRY = 'lib/plans.ts'

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exitCode = 1
}

function compile() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
  let tscPath
  try {
    tscPath = require.resolve('typescript/bin/tsc')
  } catch {
    console.error('FAIL typescript is not installed (run npm install first)')
    process.exit(1)
  }

  const result = spawnSync(
    process.execPath,
    [
      tscPath,
      ENTRY,
      '--outDir',
      TMP_DIR,
      '--module',
      'commonjs',
      '--target',
      'es2019',
      '--moduleResolution',
      'node',
      '--lib',
      'es2019,dom',
      '--strict',
      '--esModuleInterop',
      '--skipLibCheck',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )

  if (result.status !== 0) {
    console.error('FAIL lib/plans.ts did not compile')
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }

  const direct = path.join(TMP_DIR, 'plans.js')
  const nested = path.join(TMP_DIR, 'lib', 'plans.js')
  const compiled = fs.existsSync(direct) ? direct : nested
  if (!fs.existsSync(compiled)) {
    console.error(`FAIL compiled helper not found under ${TMP_DIR}`)
    process.exit(1)
  }
  return require(compiled)
}

const {
  UNLIMITED_TEAMS,
  PLAN_TEAMS,
  planById,
  planForGuild,
  isPremiumActive,
  hasActiveAccess,
  effectiveTeamLimit,
  planLabel,
  teamLimitLabel,
  planFromPaddleItems,
  buildSubscriptionUpsert,
  planFromCashfreeCode,
  CASHFREE_PLAN_CODE,
} = compile()

const { PRICING_PLANS } = require(path.join(TMP_DIR, 'pricing.js'))

const NOW = new Date('2026-11-12T00:00:00Z')

function check(label, fn) {
  try {
    const problems = fn() || []
    if (problems.length > 0) {
      for (const problem of problems) fail(`${label}: ${problem}`)
    } else {
      console.log(`ok   ${label}`)
    }
  } catch (error) {
    fail(`${label}: threw ${error && error.message ? error.message : error}`)
  }
}

/* ------------------------------------------------------------------- checks */

check('plan catalog maps the three sold plans to exact team limits', () => {
  const problems = []
  if (UNLIMITED_TEAMS !== 1000000) problems.push(`UNLIMITED_TEAMS is ${UNLIMITED_TEAMS}`)
  if (PLAN_TEAMS.starter_monthly !== 1) problems.push('starter limit is not 1')
  if (PLAN_TEAMS.pro_monthly !== 3) problems.push('pro limit is not 3')
  if (PLAN_TEAMS.elite_yearly !== UNLIMITED_TEAMS) problems.push('elite limit is not unlimited')
  if (planById('starter_monthly') !== 'starter_monthly') problems.push('planById rejected a valid id')
  if (planById('nope') !== null) problems.push('planById accepted an unknown id')
  return problems
})

check('isPremiumActive treats a manual lifetime grant as active', () => {
  const problems = []
  if (!isPremiumActive({ premium_status: 'premium', premium_ends_at: null }, NOW)) {
    problems.push('lifetime premium reported inactive')
  }
  if (isPremiumActive({ premium_status: 'premium', premium_ends_at: '2020-01-01T00:00:00Z' }, NOW)) {
    problems.push('past end date reported active')
  }
  if (isPremiumActive({ premium_status: 'expired', premium_ends_at: null }, NOW)) {
    problems.push('expired status reported active')
  }
  if (!isPremiumActive({ premium_status: 'premium', premium_ends_at: '2099-01-01T00:00:00Z' }, NOW)) {
    problems.push('future end date reported inactive')
  }
  return problems
})

check('hasActiveAccess includes an unexpired trial', () => {
  const problems = []
  if (!hasActiveAccess({ premium_status: 'trial', trial_ends_at: '2099-01-01T00:00:00Z' }, NOW)) {
    problems.push('unexpired trial has no access')
  }
  if (hasActiveAccess({ premium_status: 'trial', trial_ends_at: '2020-01-01T00:00:00Z' }, NOW)) {
    problems.push('expired trial still has access')
  }
  return problems
})

check('effectiveTeamLimit follows the plan while access is active, 1 after expiry', () => {
  const problems = []
  const trial = effectiveTeamLimit(
    { premium_status: 'trial', trial_ends_at: '2099-01-01T00:00:00Z', plan: null, max_teams: 1 },
    NOW,
  )
  if (trial !== 1) problems.push(`trial limit is ${trial}`)
  const pro = effectiveTeamLimit(
    { premium_status: 'premium', premium_ends_at: '2099-01-01T00:00:00Z', plan: 'pro_monthly', max_teams: 3 },
    NOW,
  )
  if (pro !== 3) problems.push(`pro limit is ${pro}`)
  const elite = effectiveTeamLimit(
    { premium_status: 'premium', premium_ends_at: null, plan: 'elite_yearly', max_teams: UNLIMITED_TEAMS },
    NOW,
  )
  if (elite !== UNLIMITED_TEAMS) problems.push(`elite limit is ${elite}`)
  const expired = effectiveTeamLimit(
    { premium_status: 'expired', premium_ends_at: '2020-01-01T00:00:00Z', plan: 'elite_yearly', max_teams: UNLIMITED_TEAMS },
    NOW,
  )
  if (expired !== 1) problems.push(`expired limit is ${expired}`)
  const legacy = effectiveTeamLimit(
    { premium_status: 'premium', premium_ends_at: '2099-01-01T00:00:00Z', plan: null, max_teams: 3 },
    NOW,
  )
  if (legacy !== 3) problems.push(`legacy limit is ${legacy}`)
  return problems
})

check('planForGuild prefers the stored plan and infers legacy rows', () => {
  const problems = []
  if (planForGuild({ plan: 'pro_monthly', max_teams: 1 }) !== 'pro_monthly') problems.push('stored plan ignored')
  if (planForGuild({ plan: null, max_teams: 1 }) !== 'starter_monthly') problems.push('1-team legacy not starter')
  if (planForGuild({ plan: null, max_teams: 3 }) !== 'pro_monthly') problems.push('3-team legacy not pro')
  if (planForGuild({ plan: null, max_teams: 99 }) !== 'elite_yearly') problems.push('99-team legacy not elite')
  if (planForGuild({ plan: null, max_teams: 10 }) !== null) problems.push('unknown legacy cap should be null')
  return problems
})

check('labels never show the unlimited sentinel', () => {
  const problems = []
  if (planLabel({ plan: 'elite_yearly' }) !== 'Elite Yearly') problems.push('elite label wrong')
  if (planLabel({ plan: 'starter_monthly' }) !== 'Starter Monthly') problems.push('starter label wrong')
  if (teamLimitLabel(UNLIMITED_TEAMS) !== 'Unlimited') problems.push('unlimited label wrong')
  if (teamLimitLabel(3) !== '3') problems.push('numeric label wrong')
  return problems
})

check('Paddle plan comes from the paid price, customData only as fallback', () => {
  const problems = []
  const starterPrice = PRICING_PLANS.find((plan) => plan.id === 'starter_monthly').paddlePriceId
  if (planFromPaddleItems([{ price: { id: starterPrice } }], 'elite_yearly') !== 'starter_monthly') {
    problems.push('customData overrode the paid price')
  }
  if (planFromPaddleItems([{ price: { id: 'unknown' } }], 'elite_yearly') !== 'elite_yearly') {
    problems.push('customData fallback did not apply')
  }
  if (planFromPaddleItems([{ price: { id: 'unknown' } }], null) !== null) {
    problems.push('unknown price should be null without customData')
  }
  return problems
})

check('Cashfree short codes resolve to the same three plans', () => {
  const problems = []
  if (planFromCashfreeCode('s') !== 'starter_monthly') problems.push('s did not map to starter')
  if (planFromCashfreeCode('p') !== 'pro_monthly') problems.push('p did not map to pro')
  if (planFromCashfreeCode('e') !== 'elite_yearly') problems.push('e did not map to elite')
  if (planFromCashfreeCode('x') !== null) problems.push('unknown code should be null')
  if (CASHFREE_PLAN_CODE.elite_yearly !== 'e') problems.push('the create-order map is not shared')
  return problems
})

check('buildSubscriptionUpsert stacks terms and keeps the plan exact', () => {
  const problems = []
  const active = { premium_ends_at: '2026-12-01T00:00:00Z', last_order_id: 'old' }
  const pro = buildSubscriptionUpsert(active, 'pro_monthly', 'new', NOW)
  if (pro.premium_ends_at !== '2026-12-31T00:00:00.000Z') problems.push(`stacked end is ${pro.premium_ends_at}`)
  if (pro.plan !== 'pro_monthly') problems.push('plan not stored')
  if (pro.max_teams !== 3) problems.push('pro team cap wrong')
  if (pro.premium_status !== 'premium') problems.push('status not premium')
  if (pro.last_order_id !== 'new') problems.push('order id not stored')
  if (pro.last_renewal_ping !== 0) problems.push('renewal marker not reset')

  const downgraded = buildSubscriptionUpsert({ premium_ends_at: '2026-12-01T00:00:00Z' }, 'starter_monthly', 'new', NOW)
  if (downgraded.plan !== 'starter_monthly') problems.push('downgrade plan not stored')
  if (downgraded.max_teams !== 1) problems.push('downgrade cap not applied immediately')
  if (downgraded.premium_ends_at !== '2026-12-31T00:00:00.000Z') problems.push('downgrade did not stack time')

  const expired = buildSubscriptionUpsert({ premium_ends_at: '2026-01-01T00:00:00Z' }, 'elite_yearly', 'new', NOW)
  if (expired.premium_ends_at !== '2027-11-12T00:00:00.000Z') problems.push(`expired restart is ${expired.premium_ends_at}`)
  if (expired.max_teams !== UNLIMITED_TEAMS) problems.push('elite cap wrong')
  return problems
})

check('normal (non-manual) grants always carry an expiry date', () => {
  const problems = []
  const paid = buildSubscriptionUpsert(null, 'starter_monthly', 'order', NOW)
  if (!paid.premium_ends_at) problems.push('paid grant has no end date')
  return problems
})

fs.rmSync(TMP_DIR, { recursive: true, force: true })

if (process.exitCode) {
  console.error('check:plans FAILED')
} else {
  console.log('check:plans passed')
}
