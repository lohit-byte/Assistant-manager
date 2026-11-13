#!/usr/bin/env node
/**
 * Offline check for the pure attendance helper (`lib/attendance.ts`).
 *
 * Compiles the helper (and its type-only `lib/types.ts` import) to a temp directory with the
 * local TypeScript compiler, then runs a fixture table over the compiled module. No Supabase,
 * no network, no test framework dependency — same approach as `scripts/check-rating.cjs`.
 *
 * Run with `npm run check:attendance` from `dashboard/`.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TMP_DIR = path.join(ROOT, '.tmp-attendance-check')
const ENTRY = 'lib/attendance.ts'

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
    console.error('FAIL lib/attendance.ts did not compile')
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }

  const direct = path.join(TMP_DIR, 'attendance.js')
  const nested = path.join(TMP_DIR, 'lib', 'attendance.js')
  const compiled = fs.existsSync(direct) ? direct : nested
  if (!fs.existsSync(compiled)) {
    console.error(`FAIL compiled helper not found under ${TMP_DIR}`)
    process.exit(1)
  }
  return require(compiled)
}

const { computeAttendance, addToMissingBlockReason } = compile()

/* ------------------------------------------------------------------ fixtures */

const ALIASES = [
  { id: 1, guild_id: '1', discord_id: '900', alias_name: 'sam' },
  { id: 2, guild_id: '1', discord_id: '901', alias_name: 'bob' },
  { id: 3, guild_id: '1', discord_id: '902', alias_name: 'amy' },
  { id: 4, guild_id: '1', discord_id: '903', alias_name: 'kate' },
]

const MULTI_ALIASES = [
  ...ALIASES,
  // Same Discord user as `sam`, second alias row: must fold into one attendance row.
  { id: 5, guild_id: '1', discord_id: '900', alias_name: 'sammy' },
]

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

function resultFor(input) {
  return computeAttendance({ required: 6, aliases: ALIASES, rosterIds: [], exemptAbsent: true, ...input })
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
    if (!same(row[key], value)) {
      problems.push(`${alias}.${key} = ${JSON.stringify(row[key])}, want ${JSON.stringify(value)}`)
    }
  }
  return problems
}

/* ------------------------------------------------------------------- checks */

check('roster universe: only aliases of rostered players are listed', () => {
  const { rows, summary } = resultFor({
    war: makeWar({}),
    rosterIds: ['900', '901'],
  })
  const problems = []
  if (same(rows.map((row) => row.alias), ['bob', 'sam'])) {
    // expected alphabetical inside the same status bucket
  } else {
    problems.push(`aliases = ${JSON.stringify(rows.map((row) => row.alias))}, want ["bob","sam"]`)
  }
  if (summary.total !== 2) problems.push(`total = ${summary.total}, want 2`)
  if (byAlias(rows, 'amy')) problems.push('non-rostered amy is listed')
  return problems
})

check('all-aliases fallback when the team has no roster', () => {
  const { rows, summary } = resultFor({ war: makeWar({}), rosterIds: [] })
  const problems = []
  if (rows.length !== ALIASES.length) problems.push(`rows = ${rows.length}, want ${ALIASES.length}`)
  if (summary.total !== 4) problems.push(`total = ${summary.total}, want 4`)
  if (!['amy', 'bob', 'kate', 'sam'].every((alias) => byAlias(rows, alias))) {
    problems.push('fallback list is not every alias')
  }
  return problems
})

check('folding: two alias rows make one player row with summed attacks', () => {
  const { rows, summary } = resultFor({
    war: makeWar({ attack_counts: { sam: 3, sammy: 3 } }),
    aliases: MULTI_ALIASES,
    rosterIds: [900],
  })
  if (rows.length !== 1) return [`rows = ${rows.length}, want 1`]
  const problems = expectRow(rows, 'sam', {
    discordId: '900',
    attacks: 6,
    required: 6,
    status: 'done',
    onMissingList: false,
  })
  if (summary.done !== 1) problems.push(`done = ${summary.done}, want 1`)
  return problems
})

check('folding: the alias with reports becomes the display name', () => {
  const { rows } = resultFor({
    war: makeWar({ attack_counts: { sammy: 2 } }),
    aliases: MULTI_ALIASES,
    rosterIds: ['900'],
  })
  if (rows.length !== 1) return [`rows = ${rows.length}, want 1`]
  return expectRow(rows, 'sammy', { attacks: 2, status: 'partial' })
})

check('statuses: done / partial / none / excused with a summary', () => {
  const { rows, summary } = resultFor({
    war: makeWar({
      attack_counts: { sam: 6, bob: 2 },
      absent_list: [{ name: 'amy' }],
    }),
    rosterIds: ['900', '901', '902', '903'],
  })
  const problems = []
  problems.push(...expectRow(rows, 'sam', { attacks: 6, status: 'done' }))
  problems.push(...expectRow(rows, 'bob', { attacks: 2, status: 'partial' }))
  problems.push(...expectRow(rows, 'kate', { attacks: 0, status: 'none' }))
  problems.push(...expectRow(rows, 'amy', { attacks: 0, status: 'excused' }))
  if (!same(summary, { total: 4, done: 1, partial: 1, none: 1, excused: 1 })) {
    problems.push(`summary = ${JSON.stringify(summary)}`)
  }
  return problems
})

check('excused wins over done when exempt_absent is on', () => {
  const { rows, summary } = resultFor({
    war: makeWar({ attack_counts: { amy: 6 }, absent_list: [{ name: 'amy' }] }),
    rosterIds: ['900', '901', '902', '903'],
  })
  const problems = expectRow(rows, 'amy', { attacks: 6, status: 'excused' })
  if (summary.excused !== 1 || summary.done !== 0) {
    problems.push(`summary = ${JSON.stringify(summary)}, want excused 1 / done 0`)
  }
  return problems
})

check('excused off: absent players keep their attack-based status', () => {
  const { rows, summary } = resultFor({
    war: makeWar({ absent_list: [{ name: 'amy' }] }),
    rosterIds: ['900', '901', '902', '903'],
    exemptAbsent: false,
  })
  const problems = expectRow(rows, 'amy', { status: 'none' })
  if (summary.excused !== 0) problems.push(`excused = ${summary.excused}, want 0`)
  return problems
})

check('legacy plain-string entries still get rows', () => {
  const { rows, summary } = resultFor({
    war: makeWar({
      attack_counts: { legacy: 1 },
      missing_list: ['ghost'],
      absent_list: ['gone'],
    }),
    rosterIds: [],
  })
  const problems = []
  if (rows.length !== ALIASES.length + 3) problems.push(`rows = ${rows.length}, want ${ALIASES.length + 3}`)
  problems.push(...expectRow(rows, 'ghost', { attacks: 0, status: 'none', onMissingList: true, discordId: null }))
  problems.push(...expectRow(rows, 'gone', { status: 'excused' }))
  problems.push(...expectRow(rows, 'legacy', { attacks: 1, status: 'partial' }))
  if (summary.total !== ALIASES.length + 3) problems.push(`summary.total = ${summary.total}`)
  return problems
})

check('legacy object entries with an unknown name get a name-only row', () => {
  const { rows } = resultFor({
    war: makeWar({ missing_list: [{ name: 'OldGuy', id: 999 }] }),
    rosterIds: ['900', '901', '902', '903'],
  })
  return expectRow(rows, 'OldGuy', { discordId: null, status: 'none', onMissingList: true })
})

check('onMissingList matches by Discord id even when the stored name differs', () => {
  const { rows } = resultFor({
    war: makeWar({ missing_list: [{ name: 'Robin', id: '901' }] }),
    rosterIds: ['900', '901', '902', '903'],
  })
  const problems = expectRow(rows, 'bob', { onMissingList: true })
  if (byAlias(rows, 'Robin')) problems.push('legacy Robin row should not exist for a known id')
  return problems
})

check('onMissingList matches a secondary alias name of a folded player', () => {
  const { rows } = resultFor({
    war: makeWar({ missing_list: [{ name: 'sammy' }] }),
    aliases: MULTI_ALIASES,
    rosterIds: ['900'],
  })
  return expectRow(rows, 'sam', { onMissingList: true, status: 'none' })
})

check('sort: none, partial, done, excused, alphabetical inside each bucket', () => {
  const { rows } = resultFor({
    war: makeWar({
      attack_counts: { bob: 2, kate: 6 },
      absent_list: [{ name: 'amy' }],
    }),
    rosterIds: ['900', '901', '902', '903'],
  })
  const expected = ['sam', 'bob', 'kate', 'amy']
  const actual = rows.map((row) => row.alias)
  return same(actual, expected) ? [] : [`order = ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`]
})

check('empty war: every aliased player shows as not reported', () => {
  const { rows, summary } = resultFor({ war: null, rosterIds: [] })
  const problems = []
  if (rows.length !== 4) problems.push(`rows = ${rows.length}, want 4`)
  if (!rows.every((row) => row.status === 'none' && row.attacks === 0)) {
    problems.push('a player without a war row is not "none"')
  }
  if (summary.none !== 4) problems.push(`none = ${summary.none}, want 4`)
  return problems
})

check('addToMissing refusal: excused, enough attacks and already-listed rows are blocked', () => {
  const problems = []
  const row = (over) => ({ alias: 'sam', discordId: '900', attacks: 0, required: 6, status: 'none', onMissingList: false, ...over })
  if (typeof addToMissingBlockReason !== 'function') return ['addToMissingBlockReason is not exported']
  if (addToMissingBlockReason(row({})) !== null) problems.push('a short player should be addable')
  if (addToMissingBlockReason(row({ attacks: 3, status: 'partial' })) !== null) problems.push('a partial player should be addable')
  if (!/excused/i.test(addToMissingBlockReason(row({ status: 'excused' })) || '')) problems.push('excused is not refused')
  if (!/6\/6/.test(addToMissingBlockReason(row({ attacks: 6, status: 'done' })) || '')) problems.push('enough attacks is not refused with the count')
  if (!/already on the missing list/i.test(addToMissingBlockReason(row({ onMissingList: true })) || '')) problems.push('already listed is not refused')
  if (addToMissingBlockReason(row({ attacks: 2, required: 0, status: 'none' })) !== null) problems.push('required 0 must not refuse on attacks')
  if (/\d{17,}/.test(addToMissingBlockReason(row({ status: 'excused' })) || '')) problems.push('reason leaks an id')
  return problems
})

fs.rmSync(TMP_DIR, { recursive: true, force: true })

if (process.exitCode) {
  console.error('check:attendance FAILED')
} else {
  console.log('check:attendance passed')
}
