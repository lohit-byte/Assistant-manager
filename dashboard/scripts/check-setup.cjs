#!/usr/bin/env node
/**
 * Offline check for the pure Server setup helpers (`lib/setup.ts`).
 *
 * Compiles the helper (and its `lib/format.ts` import) to a temp directory with the local
 * TypeScript compiler, then runs a fixture table over the compiled module. No Supabase, no
 * network, no test framework dependency — same approach as `scripts/check-rating.cjs`.
 *
 * Run with `npm run check:setup` from `dashboard/`.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TMP_DIR = path.join(ROOT, '.tmp-setup-check')
const ENTRY = 'lib/setup.ts'

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
    console.error('FAIL lib/setup.ts did not compile')
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }

  const direct = path.join(TMP_DIR, 'setup.js')
  const nested = path.join(TMP_DIR, 'lib', 'setup.js')
  const compiled = fs.existsSync(direct) ? direct : nested
  if (!fs.existsSync(compiled)) {
    console.error(`FAIL compiled helper not found under ${TMP_DIR}`)
    process.exit(1)
  }
  return require(compiled)
}

const {
  normalizeId,
  parseRoleId,
  parseChannelId,
  validateGuildSetup,
  buildSetupSummary,
  MAX_TEAM_CAPTAINS,
  captainLimitError,
} = compile()

const LEADER = '111111111111111111'
const COLEAD = '222222222222222222'
const STAFF = '333333333333333333'
const MAZE = '444444444444444444'

const EMPTY = {
  leader_role_id: '',
  colead_role_id: '',
  staff_role_id: '',
  maze_channel_id: '',
}

function same(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

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

check('normalizeId trims and treats empty / null / undefined as not set', () => {
  const problems = []
  if (normalizeId('  123456789012345678  ') !== '123456789012345678') problems.push('did not trim')
  if (normalizeId('') !== null) problems.push('empty string should be null')
  if (normalizeId('   ') !== null) problems.push('whitespace-only should be null')
  if (normalizeId(null) !== null) problems.push('null should stay null')
  if (normalizeId(undefined) !== null) problems.push('undefined should stay null')
  if (normalizeId(1234567890123456) !== '1234567890123456') problems.push('number ids should become strings')
  return problems
})

check('parseRoleId accepts 17–20 digit snowflakes and empty as not set', () => {
  const problems = []
  const valid = parseRoleId(LEADER, 'Leader role ID')
  if (!valid.ok || valid.value !== LEADER || valid.error !== null) problems.push('valid id rejected')
  const empty = parseRoleId('', 'Leader role ID')
  if (!empty.ok || empty.value !== null) problems.push('empty id should be ok with null value')
  const trimmed = parseRoleId(`  ${COLEAD} `, 'Staff role ID')
  if (trimmed.value !== COLEAD) problems.push('trimmed value not returned')
  return problems
})

check('parseRoleId rejects short, long and non-numeric ids with a role message', () => {
  const problems = []
  const short = parseRoleId('12345', 'Staff role ID')
  if (short.ok) problems.push('short id accepted')
  if (!short.error || !short.error.includes('Staff role ID') || !short.error.includes('17–20')) {
    problems.push(`short id error is unclear: ${short.error}`)
  }
  if (!short.error || !short.error.includes('role')) problems.push('role wording missing')
  for (const bad of ['1234567890123456', '123456789012345678901', 'abcdefghijklmnopqrs', '12 345 678 901 234 567']) {
    if (parseRoleId(bad, 'Leader role ID').ok) problems.push(`accepted invalid id ${bad}`)
  }
  return problems
})

check('parseChannelId says "channel" and keeps the same snowflake rule', () => {
  const problems = []
  const bad = parseChannelId('nope', 'Maze channel ID')
  if (bad.ok) problems.push('bad channel accepted')
  if (!bad.error || !bad.error.includes('channel')) problems.push('channel wording missing')
  if (!parseChannelId(MAZE, 'Maze channel ID').ok) problems.push('valid channel rejected')
  return problems
})

check('validateGuildSetup with everything empty is ok and clears every field', () => {
  const result = validateGuildSetup({ ...EMPTY })
  const problems = []
  if (!result.ok) problems.push('all-empty form should be valid')
  if (!same(result.errors, {})) problems.push(`unexpected errors: ${JSON.stringify(result.errors)}`)
  if (!same(result.update, {
    leader_role_id: null,
    colead_role_id: null,
    staff_role_id: null,
    maze_channel_id: null,
  })) problems.push(`update not cleared: ${JSON.stringify(result.update)}`)
  return problems
})

check('validateGuildSetup normalises a full valid form for one update call', () => {
  const result = validateGuildSetup({
    leader_role_id: ` ${LEADER} `,
    colead_role_id: COLEAD,
    staff_role_id: STAFF,
    maze_channel_id: MAZE,
  })
  const problems = []
  if (!result.ok) problems.push('valid form rejected')
  if (!same(result.update, {
    leader_role_id: LEADER,
    colead_role_id: COLEAD,
    staff_role_id: STAFF,
    maze_channel_id: MAZE,
  })) problems.push(`update payload wrong: ${JSON.stringify(result.update)}`)
  return problems
})

check('validateGuildSetup blocks a bad field but keeps the good ones', () => {
  const result = validateGuildSetup({
    leader_role_id: 'not-an-id',
    colead_role_id: COLEAD,
    staff_role_id: '',
    maze_channel_id: '999',
  })
  const problems = []
  if (result.ok) problems.push('invalid form reported ok')
  if (!result.errors.leader_role_id) problems.push('leader error missing')
  if (!result.errors.maze_channel_id) problems.push('maze error missing')
  if (result.errors.colead_role_id) problems.push('valid helper role got an error')
  if (result.update.leader_role_id !== null) problems.push('invalid leader id leaked into the update')
  if (result.update.colead_role_id !== COLEAD) problems.push('valid helper role dropped')
  return problems
})

check('buildSetupSummary starts from a head start, never 0%', () => {
  const summary = buildSetupSummary({ teamCount: 0, maxTeams: 3 })
  const problems = []
  if (summary.total !== 5) problems.push(`total = ${summary.total}, want 5`)
  if (summary.configured !== 0) problems.push(`configured = ${summary.configured}, want 0`)
  if (summary.percent !== 17) problems.push(`percent = ${summary.percent}, want 17 (bot head start)`)
  if (summary.complete) problems.push('empty setup marked complete')
  if (!summary.next || summary.next.key !== 'teams') problems.push(`next = ${summary.next && summary.next.key}, want teams`)
  if (summary.next && summary.next.value !== '0 of 3') problems.push(`teams value = ${summary.next && summary.next.value}`)
  return problems
})

check('buildSetupSummary prints Unlimited instead of the Elite sentinel', () => {
  const summary = buildSetupSummary({ teamCount: 0, maxTeams: 1000000 })
  const problems = []
  const teams = summary.tasks.find((task) => task.key === 'teams')
  if (!teams || teams.value !== '0 of Unlimited') problems.push(`teams value = ${teams && teams.value}`)
  return problems
})

check('buildSetupSummary counts teams and roles, with a monotonic percent', () => {
  const summary = buildSetupSummary({
    teamCount: 2,
    maxTeams: 2,
    leaderRoleId: LEADER,
    staffRoleId: STAFF,
  })
  const problems = []
  if (summary.configured !== 3) problems.push(`configured = ${summary.configured}, want 3`)
  if (summary.percent !== 67) problems.push(`percent = ${summary.percent}, want 67`)
  const tasks = Object.fromEntries(summary.tasks.map((task) => [task.key, task]))
  if (!tasks.teams.configured || tasks.teams.value !== '2 of 2') problems.push('teams task wrong')
  if (!tasks.leader_role_id.configured || tasks.leader_role_id.value !== 'Set') problems.push('leader task wrong')
  if (tasks.colead_role_id.configured) problems.push('helper role reported configured')
  if (!tasks.staff_role_id.configured) problems.push('staff role reported unset')
  if (tasks.colead_role_id.value !== 'Not set') problems.push('unset task value wrong')
  if (!summary.next || summary.next.key !== 'colead_role_id') problems.push(`next = ${summary.next && summary.next.key}, want colead_role_id`)
  return problems
})

check('buildSetupSummary is complete at 100% only when every task is set', () => {
  const summary = buildSetupSummary({
    teamCount: 1,
    maxTeams: 5,
    leaderRoleId: LEADER,
    coleadRoleId: COLEAD,
    staffRoleId: STAFF,
    mazeChannelId: MAZE,
  })
  const problems = []
  if (!summary.complete) problems.push('full setup not marked complete')
  if (summary.percent !== 100) problems.push(`percent = ${summary.percent}, want 100`)
  if (summary.next !== null) problems.push('next should be null when complete')
  if (summary.configured !== summary.total) problems.push('configured/total mismatch')
  return problems
})

check('buildSetupSummary treats whitespace-only ids as not set', () => {
  const summary = buildSetupSummary({
    teamCount: 0,
    maxTeams: 1,
    leaderRoleId: '   ',
    coleadRoleId: '',
    staffRoleId: ' ',
    mazeChannelId: '',
  })
  const problems = []
  if (summary.configured !== 0) problems.push(`configured = ${summary.configured}, want 0`)
  const leader = summary.tasks.find((task) => task.key === 'leader_role_id')
  if (!leader || leader.configured) problems.push('whitespace id counted as configured')
  return problems
})

check('buildSetupSummary without a plan limit still gives a readable team value', () => {
  const summary = buildSetupSummary({ teamCount: 1, maxTeams: null })
  const problems = []
  const teams = summary.tasks.find((task) => task.key === 'teams')
  if (!teams) return ['missing teams task']
  if (teams.value !== '1 team') problems.push(`teams value = ${teams.value}, want "1 team"`)
  if (!teams.configured) problems.push('one team should count as configured')
  return problems
})

check('captainLimitError caps a team at 4 staff (1 leader + 3 co-leads)', () => {
  const problems = []
  if (MAX_TEAM_CAPTAINS !== 4) problems.push(`MAX_TEAM_CAPTAINS = ${MAX_TEAM_CAPTAINS}, want 4`)
  const four = ['111111111111111111', '222222222222222222', '333333333333333333', '444444444444444444']
  if (captainLimitError(four, '555555555555555555') === null) problems.push('a fifth captain was allowed')
  if (captainLimitError(four.slice(0, 3), '555555555555555555') !== null) problems.push('a fourth captain was refused')
  if (captainLimitError([], '555555555555555555') !== null) problems.push('the first captain was refused')
  return problems
})

check('captainLimitError lets an existing captain re-add (a no-op, not a limit)', () => {
  const problems = []
  const four = ['111111111111111111', '222222222222222222', '333333333333333333', '444444444444444444']
  if (captainLimitError(four, '<@222222222222222222>') !== null) problems.push('mention form of an existing captain refused')
  if (captainLimitError(four, '222222222222222222') !== null) problems.push('plain id of an existing captain refused')
  return problems
})

fs.rmSync(TMP_DIR, { recursive: true, force: true })

if (process.exitCode) {
  console.error('check:setup FAILED')
} else {
  console.log('check:setup passed')
}
