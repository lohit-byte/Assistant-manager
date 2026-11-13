#!/usr/bin/env node
/**
 * Offline check for the pure war rating helper (`lib/rating.ts`).
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

check('excused on: unranked and listed last', () => {
  const rows = rowsFor({
    war: makeWar({
      attack_counts: { sam: 6, bob: 6 },
      absent_list: [{ name: 'amy' }],
    }),
    warSettings: SETTINGS,
    aliases: ALIASES,
  })
  const problems = []
  const amy = byAlias(rows, 'amy')
  if (!amy) return ['missing amy row']
  if (!amy.excused) problems.push('amy is ranked instead of excused')
  if (rows[rows.length - 1].alias !== 'amy') problems.push(`excused row not last (last = ${rows[rows.length - 1].alias})`)
  if (rows.filter((row) => row.excused).length !== 1) problems.push('ranked/excused split is wrong')
  return problems
})

check('excused off: absent player ranks normally with no war credit', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 6 }, absent_list: [{ name: 'amy' }] }),
    warSettings: { ...SETTINGS, exempt_absent: false },
    aliases: ALIASES,
  })
  const problems = []
  if (rows.some((row) => row.excused)) problems.push('someone is still excused')
  return problems.concat(expectRow(rows, 'amy', { excused: false, score: 0, grade: 'D' }))
})

check('3/6 attacks is 50 C', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 3 } }),
    warSettings: SETTINGS,
    aliases: ALIASES,
  })
  return expectRow(rows, 'sam', { attacks: 3, score: 50, grade: 'C' })
})

check('score caps at required: 9/6 attacks is 100 A+', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 9 } }),
    warSettings: SETTINGS,
    aliases: ALIASES,
  })
  return expectRow(rows, 'sam', { score: 100, grade: 'A+' })
})

check('no war and no requirement: nobody is scored', () => {
  const rows = rowsFor({
    war: null,
    warSettings: { ...SETTINGS, attacks_required: 0 },
    aliases: ALIASES,
  })
  return rows.length === 0 ? [] : [`expected no rows, got ${rows.length}`]
})

check('rows carry only the war score fields', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 3 } }),
    warSettings: SETTINGS,
    aliases: ALIASES,
  })
  const keys = Object.keys(rows[0] || {}).sort()
  return same(keys, ['alias', 'attacks', 'discordId', 'excused', 'grade', 'required', 'score'])
    ? []
    : [`unexpected row keys: ${keys.join(',')}`]
})

check('multi-alias player folds into one row with combined attacks', () => {
  const rows = rowsFor({
    war: makeWar({ attack_counts: { sam: 3, sammy: 3 } }),
    warSettings: SETTINGS,
    aliases: MULTI_ALIASES,
  })
  const samRows = rows.filter((row) => String(row.discordId) === '900')
  const problems = []
  if (samRows.length !== 1) problems.push(`expected 1 row for discord id 900, got ${samRows.length}`)
  if (samRows.length === 1) {
    if (samRows[0].attacks !== 6) problems.push(`attacks = ${samRows[0].attacks}, want 6`)
    if (samRows[0].score !== 100) problems.push(`score = ${samRows[0].score}, want 100`)
    if (samRows[0].grade !== 'A+') problems.push(`grade = ${samRows[0].grade}, want A+`)
  }
  return problems
})

check('legacy plain-string lists still create rows', () => {
  const rows = rowsFor({
    war: makeWar({ missing_list: ['bob'], absent_list: ['amy'], attack_counts: { sam: 6 } }),
    warSettings: SETTINGS,
    aliases: ALIASES,
  })
  const problems = []
  if (!byAlias(rows, 'sam')) problems.push('missing sam row')
  if (!byAlias(rows, 'bob') || byAlias(rows, 'bob').excused) problems.push('bob should be a ranked missing row')
  if (!byAlias(rows, 'amy') || !byAlias(rows, 'amy').excused) problems.push('amy should be an excused row')
  return problems
})

check('list entry with only a Discord id resolves to its alias', () => {
  const rows = rowsFor({
    war: makeWar({ missing_list: [{ id: '901' }] }),
    warSettings: SETTINGS,
    aliases: ALIASES,
  })
  return rows.length === 1 && rows[0].alias === 'bob' ? [] : [`rows = ${JSON.stringify(rows.map((r) => r.alias))}, want [bob]`]
})

check('unresolved list entry shows "No alias", never an id', () => {
  const rows = rowsFor({
    war: makeWar({ missing_list: [{ id: '123456789012345678' }] }),
    warSettings: SETTINGS,
    aliases: ALIASES,
  })
  const problems = []
  if (rows.length !== 1) return [`expected 1 row, got ${rows.length}`]
  if (rows[0].alias !== 'No alias') problems.push(`alias = ${JSON.stringify(rows[0].alias)}, want "No alias"`)
  if (/\d{17,}/.test(rows[0].alias)) problems.push('alias contains a snowflake')
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
