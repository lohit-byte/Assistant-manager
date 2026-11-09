#!/usr/bin/env node
/**
 * Offline check for the pure rating helper (`lib/rating.ts`).
 *
 * Compiles the helper (and its type/constants imports) to a temp directory with the local
 * TypeScript compiler, then runs a fixture table over the compiled module. No Supabase, no
 * network, no test framework dependency — mirrors how the dashboard verifies pure helpers.
 *
 * Run with `npm run check:rating` from `dashboard/`.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TMP_DIR = path.join(ROOT, '.tmp-rating-check')
const ENTRY = 'lib/rating.ts'

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
      'es2019',
      '--strict',
      '--esModuleInterop',
      '--skipLibCheck',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )

  if (result.status !== 0) {
    console.error('FAIL lib/rating.ts did not compile')
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }

  const direct = path.join(TMP_DIR, 'rating.js')
  const nested = path.join(TMP_DIR, 'lib', 'rating.js')
  const compiled = fs.existsSync(direct) ? direct : nested
  if (!fs.existsSync(compiled)) {
    console.error(`FAIL compiled helper not found under ${TMP_DIR}`)
    process.exit(1)
  }
  return require(compiled)
}

const { computeRatings, gradeFor } = compile()

/* ------------------------------------------------------------------ fixtures */

const ALIASES = [
  { id: 1, guild_id: '1', discord_id: '900', alias_name: 'sam' },
  { id: 2, guild_id: '1', discord_id: '901', alias_name: 'bob' },
  { id: 3, guild_id: '1', discord_id: '902', alias_name: 'amy' },
  { id: 4, guild_id: '1', discord_id: '903', alias_name: 'kate' },
]

const MULTI_ALIASES = [
  ...ALIASES,
  // Same Discord user as `sam`, second alias row: must fold into one rating row.
  { id: 5, guild_id: '1', discord_id: '900', alias_name: 'sammy' },
]

const SETTINGS = { guild_id: '1', attacks_required: 6, exempt_absent: true }

function makeWar(overrides = {}) {
  return {
    guild_id: '1',
    channel_id: '10',
    war_start: '2026-11-10T00:00:00Z',
    phase: 'attack',
    missing_list: [],
    absent_list: [],
    attack_counts: {},
    is_active: true,
    status_message_id: null,
    team_role_id: null,
    ...overrides,
  }
}

function raceLogs({ player = 'sam', discordId = '900', channelId = '11', count = 1, action = 'dyp_done', lap = 1, startNode = 1, name = player } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    guild_id: '1',
    channel_id: channelId,
    lap,
    node: startNode + index,
    discord_id: discordId,
    player_name: name,
    action_type: action,
    created_at: '2026-11-10T01:00:00Z',
  }))
}

function rowsFor(input) {
  return computeRatings(input)
}

function byAlias(rows, alias) {
  return rows.find((row) => row.alias === alias)
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

function expectRow(rows, alias, expected) {
  const row = byAlias(rows, alias)
  if (!row) return [`missing row for ${alias}`]
  const problems = []
  for (const [key, value] of Object.entries(expected)) {
    if (!same(row[key], value)) problems.push(`${alias}.${key} = ${JSON.stringify(row[key])}, want ${JSON.stringify(value)}`)
  }
  return problems
}

/* ------------------------------------------------------------------- checks */

check('dedupe: repeated je_add on the same node counts once', () => {
  const rows = rowsFor({
    war: null,
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: [
      { id: 1, guild_id: '1', channel_id: '11', lap: 2, node: 3, discord_id: '900', player_name: 'sam', action_type: 'je_add', created_at: null },
      { id: 2, guild_id: '1', channel_id: '11', lap: 2, node: 3, discord_id: '900', player_name: 'sam', action_type: 'je_add', created_at: null },
      { id: 3, guild_id: '1', channel_id: '11', lap: 2, node: 3, discord_id: '900', player_name: 'sam', action_type: 'je_done', created_at: null },
    ],
    raceChannelId: '11',
  })
  return expectRow(rows, 'sam', { raceTasks: 1 })
})

check('dedupe: claim + done on one node is one OFA task, claim alone is none', () => {
  const rows = rowsFor({
    war: null,
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: [
      { id: 1, guild_id: '1', channel_id: '11', lap: 1, node: 1, discord_id: '900', player_name: 'sam', action_type: 'ofa_claim', created_at: null },
      { id: 2, guild_id: '1', channel_id: '11', lap: 1, node: 1, discord_id: '900', player_name: 'sam', action_type: 'ofa_done', created_at: null },
      { id: 3, guild_id: '1', channel_id: '11', lap: 1, node: 2, discord_id: '900', player_name: 'sam', action_type: 'dyp_done', created_at: null },
    ],
    raceChannelId: '11',
  })
  return expectRow(rows, 'sam', { raceTasks: 2 })
})

check('claim-only player gets no race task', () => {
  const rows = rowsFor({
    war: null,
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: [
      { id: 1, guild_id: '1', channel_id: '11', lap: 1, node: 1, discord_id: '901', player_name: 'bob', action_type: 'ofa_claim', created_at: null },
    ],
    raceChannelId: '11',
  })
  const row = byAlias(rows, 'bob')
  if (!row) return ['missing bob row']
  const problems = []
  if (row.raceTasks !== 0) problems.push(`raceTasks = ${row.raceTasks}, want 0`)
  if (row.score !== 0) problems.push(`score = ${row.score}, want 0`)
  return problems
})

check('excused on: unranked, listed last, keeps race task count', () => {
  const rows = rowsFor({
    war: makeWar({
      attack_counts: { sam: 6, bob: 6 },
      absent_list: [{ name: 'amy' }],
    }),
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: raceLogs({ player: 'amy', discordId: '902', count: 6 }),
    raceChannelId: '11',
    warChannelId: '10',
  })
  const problems = []
  const amy = byAlias(rows, 'amy')
  if (!amy) return ['missing amy row']
  if (!amy.excused) problems.push('amy is ranked instead of excused')
  if (rows[rows.length - 1].alias !== 'amy') problems.push(`excused row not last (last = ${rows[rows.length - 1].alias})`)
  if (amy.raceTasks !== 6) problems.push(`amy.raceTasks = ${amy.raceTasks}, want 6`)
  if (rows.filter((row) => row.excused).length !== 1) problems.push('ranked/excused split is wrong')
  return problems
})

check('excused off: absent player ranks normally with no war credit', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 6 }, absent_list: [{ name: 'amy' }] }),
    warSettings: { ...SETTINGS, exempt_absent: false },
    aliases: ALIASES,
    raceLogs: [],
    warChannelId: '10',
    raceChannelId: '11',
  })
  const problems = []
  if (rows.some((row) => row.excused)) problems.push('someone is still excused')
  return problems.concat(expectRow(rows, 'amy', { excused: false, score: 0, grade: 'D' }))
})

check('war-only team renormalizes: 3/6 attacks is 50 C', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 3 } }),
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: [],
    warChannelId: '10',
    raceChannelId: null,
  })
  return expectRow(rows, 'sam', { attacks: 3, score: 50, grade: 'C' })
})

check('war-only team caps at required: 9/6 attacks is 100 A+', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 9 } }),
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: [],
    warChannelId: '10',
    raceChannelId: null,
  })
  return expectRow(rows, 'sam', { score: 100, grade: 'A+' })
})

check('race-only team renormalizes: 10 tasks is 100 A+, 5 tasks is 50 C', () => {
  const full = rowsFor({
    war: null,
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: raceLogs({ count: 10 }),
    warChannelId: null,
    raceChannelId: '11',
  })
  const half = rowsFor({
    war: null,
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: raceLogs({ count: 5 }),
    warChannelId: null,
    raceChannelId: '11',
  })
  return expectRow(full, 'sam', { score: 100, grade: 'A+' }).concat(
    expectRow(half, 'sam', { score: 50, grade: 'C' }),
  )
})

check('both channels, no race activity: capped at 60 C (not renormalized)', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 6 } }),
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: [],
    warChannelId: '10',
    raceChannelId: '11',
  })
  return expectRow(rows, 'sam', { score: 60, grade: 'C' })
})

check('pre-migration rows (no lap/node) count one task per row', () => {
  const rows = rowsFor({
    war: null,
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: [
      { id: 1, guild_id: '1', channel_id: null, lap: null, node: null, discord_id: '900', player_name: 'sam', action_type: 'je_add', created_at: null },
      { id: 2, guild_id: '1', channel_id: null, lap: null, node: null, discord_id: '900', player_name: 'sam', action_type: 'je_add', created_at: null },
      { id: 3, guild_id: '1', channel_id: null, lap: null, node: null, discord_id: '900', player_name: 'sam', action_type: 'dyp_done', created_at: null },
    ],
    warChannelId: null,
    raceChannelId: '11',
  })
  return expectRow(rows, 'sam', { raceTasks: 3 })
})

check('multi-alias player folds into one row with combined attacks', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 3, sammy: 3 } }),
    warSettings: SETTINGS,
    aliases: MULTI_ALIASES,
    raceLogs: raceLogs({ player: 'Sammy', name: 'sammy', count: 10 }),
    warChannelId: '10',
    raceChannelId: '11',
  })
  const samRows = rows.filter((row) => String(row.discordId) === '900')
  const problems = []
  if (samRows.length !== 1) problems.push(`expected 1 row for discord id 900, got ${samRows.length}`)
  if (samRows.length === 1) {
    if (samRows[0].attacks !== 6) problems.push(`attacks = ${samRows[0].attacks}, want 6`)
    if (samRows[0].raceTasks !== 10) problems.push(`raceTasks = ${samRows[0].raceTasks}, want 10`)
    if (samRows[0].score !== 100) problems.push(`score = ${samRows[0].score}, want 100`)
    if (samRows[0].grade !== 'A+') problems.push(`grade = ${samRows[0].grade}, want A+`)
  }
  return problems
})

check('multi-alias dedupes race nodes by discord id', () => {
  const rows = rowsFor({
    war: makeWar({}),
    warSettings: SETTINGS,
    aliases: MULTI_ALIASES,
    raceLogs: [
      { id: 1, guild_id: '1', channel_id: '11', lap: 1, node: 1, discord_id: '900', player_name: 'sam', action_type: 'dyp_done', created_at: null },
      { id: 2, guild_id: '1', channel_id: '11', lap: 1, node: 1, discord_id: '900', player_name: 'sammy', action_type: 'dyp_done', created_at: null },
    ],
    warChannelId: '10',
    raceChannelId: '11',
  })
  const samRows = rows.filter((row) => String(row.discordId) === '900')
  if (samRows.length !== 1) return [`expected 1 row, got ${samRows.length}`]
  return samRows[0].raceTasks === 1 ? [] : [`raceTasks = ${samRows[0].raceTasks}, want 1`]
})

check('legacy plain-string lists still create rows', () => {
  const rows = rowsFor({
    war: makeWar({ missing_list: ['bob'], absent_list: ['amy'], attack_counts: { sam: 6 } }),
    warSettings: SETTINGS,
    aliases: ALIASES,
    raceLogs: [],
    warChannelId: '10',
    raceChannelId: null,
  })
  const problems = []
  if (!byAlias(rows, 'sam')) problems.push('missing sam row')
  if (!byAlias(rows, 'bob') || byAlias(rows, 'bob').excused) problems.push('bob should be a ranked missing row')
  if (!byAlias(rows, 'amy') || !byAlias(rows, 'amy').excused) problems.push('amy should be an excused row')
  return problems
})

check('grade thresholds', () => {
  const expected = [
    [95, 'A+'],
    [90, 'A+'],
    [89, 'A'],
    [80, 'A'],
    [79, 'B'],
    [65, 'B'],
    [64, 'C'],
    [50, 'C'],
    [49, 'D'],
  ]
  const problems = []
  for (const [score, grade] of expected) {
    if (gradeFor(score) !== grade) problems.push(`gradeFor(${score}) = ${gradeFor(score)}, want ${grade}`)
  }
  return problems
})

fs.rmSync(TMP_DIR, { recursive: true, force: true })

if (process.exitCode) {
  console.error('check:rating FAILED')
} else {
  console.log('check:rating passed')
}
