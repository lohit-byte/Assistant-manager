#!/usr/bin/env node
/**
 * Offline check for the alias-first display helpers in `lib/format.ts`
 * (`aliasForDiscordId`, `playerLabel`).
 *
 * Compiles the helper with the local TypeScript compiler and runs fixtures over it. No browser,
 * no Supabase, no test framework — same approach as `scripts/check-rating.cjs`.
 *
 * Run with `npm run check:labels` from `dashboard/`.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TMP_DIR = path.join(ROOT, '.tmp-labels-check')
const ENTRY = 'lib/format.ts'

let failures = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    console.error(`FAIL ${name}: expected ${e}, got ${a}`)
    failures += 1
    return
  }
  console.log(`ok   ${name}`)
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
    console.error('FAIL lib/format.ts did not compile')
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }

  const direct = path.join(TMP_DIR, 'format.js')
  const nested = path.join(TMP_DIR, 'lib', 'format.js')
  const compiled = fs.existsSync(direct) ? direct : nested
  if (!fs.existsSync(compiled)) {
    console.error(`FAIL compiled helper not found under ${TMP_DIR}`)
    process.exit(1)
  }
  return require(compiled)
}

const { aliasForDiscordId, playerLabel } = compile()

if (typeof aliasForDiscordId !== 'function' || typeof playerLabel !== 'function') {
  console.error('FAIL lib/format.ts must export aliasForDiscordId and playerLabel')
  fs.rmSync(TMP_DIR, { recursive: true, force: true })
  process.exit(1)
}

/* ------------------------------------------------------------------ fixtures */

const SNOWFLAKE = '123456789012345678'
const OTHER = '987654321098765432'

const ALIASES = [
  { id: 1, guild_id: '1', discord_id: SNOWFLAKE, alias_name: 'sam' },
  { id: 2, guild_id: '1', discord_id: OTHER, alias_name: 'bob' },
  // Second alias of the same Discord user: the first row stays the display name.
  { id: 3, guild_id: '1', discord_id: SNOWFLAKE, alias_name: 'sammy' },
  // Numeric ids (bigint columns can arrive as numbers) must still match.
  { id: 4, guild_id: '1', discord_id: 4242, alias_name: 'numeric' },
]

/* -------------------------------------------------------- aliasForDiscordId */

check('aliasForDiscordId: finds the alias by id', aliasForDiscordId(ALIASES, SNOWFLAKE), 'sam')
check('aliasForDiscordId: multi-alias player returns the first alias', aliasForDiscordId(ALIASES, SNOWFLAKE), 'sam')
check('aliasForDiscordId: second player', aliasForDiscordId(ALIASES, OTHER), 'bob')
check('aliasForDiscordId: number id matches string lookup', aliasForDiscordId(ALIASES, '4242'), 'numeric')
check('aliasForDiscordId: string id matches number alias', aliasForDiscordId(ALIASES, 4242), 'numeric')
check('aliasForDiscordId: unknown id is null', aliasForDiscordId(ALIASES, '555555555555555555'), null)
check('aliasForDiscordId: null id is null', aliasForDiscordId(ALIASES, null), null)
check('aliasForDiscordId: undefined id is null', aliasForDiscordId(ALIASES, undefined), null)
check('aliasForDiscordId: empty id is null', aliasForDiscordId(ALIASES, ''), null)
check('aliasForDiscordId: empty alias list is null', aliasForDiscordId([], SNOWFLAKE), null)
check('aliasForDiscordId: null alias list is null', aliasForDiscordId(null, SNOWFLAKE), null)
check(
  'aliasForDiscordId: blank alias name is skipped',
  aliasForDiscordId([{ id: 9, guild_id: '1', discord_id: SNOWFLAKE, alias_name: '  ' }], SNOWFLAKE),
  null,
)

/* -------------------------------------------------------------- playerLabel */

check('playerLabel: stored real name wins over an alias lookup', playerLabel('Sammy', ALIASES, SNOWFLAKE), 'Sammy')
check('playerLabel: stored name is trimmed', playerLabel('  Sammy  ', ALIASES, SNOWFLAKE), 'Sammy')
check('playerLabel: null name falls back to alias by id', playerLabel(null, ALIASES, OTHER), 'bob')
check('playerLabel: undefined name falls back to alias by id', playerLabel(undefined, ALIASES, OTHER), 'bob')
check('playerLabel: blank name falls back to alias by id', playerLabel('   ', ALIASES, OTHER), 'bob')
check('playerLabel: snowflake-only name is not a name', playerLabel(SNOWFLAKE, ALIASES, OTHER), 'bob')
check('playerLabel: snowflake with whitespace is not a name', playerLabel(`  ${SNOWFLAKE} `, ALIASES, OTHER), 'bob')
check('playerLabel: <@id> mention is not a name', playerLabel(`<@${SNOWFLAKE}>`, ALIASES, SNOWFLAKE), 'sam')
check('playerLabel: <@!id> mention is not a name', playerLabel(`<@!${SNOWFLAKE}>`, ALIASES, SNOWFLAKE), 'sam')
check('playerLabel: mention with no resolvable alias is No alias', playerLabel(`<@${SNOWFLAKE}>`, [], SNOWFLAKE), 'No alias')
check('playerLabel: snowflake name, unknown id is No alias', playerLabel(SNOWFLAKE, ALIASES, '555555555555555555'), 'No alias')
check('playerLabel: null name and null id is No alias', playerLabel(null, ALIASES, null), 'No alias')
check('playerLabel: undefined everything is No alias', playerLabel(undefined, undefined, undefined), 'No alias')
check('playerLabel: unknown id is No alias', playerLabel(null, ALIASES, '555555555555555555'), 'No alias')
check('playerLabel: multi-alias id with no stored name shows the first alias', playerLabel(null, ALIASES, SNOWFLAKE), 'sam')
check('playerLabel: a name that merely contains digits is a real name', playerLabel('Team 12345', ALIASES, null), 'Team 12345')
check('playerLabel: a short numeric name is a real name', playerLabel('007', ALIASES, null), '007')
check('playerLabel: never returns a 17+ digit run', /\d{17,}/.test(playerLabel(SNOWFLAKE, [], SNOWFLAKE)), false)
check('playerLabel: never returns a User <id> string', /^User\b/.test(playerLabel(null, [], SNOWFLAKE)), false)

fs.rmSync(TMP_DIR, { recursive: true, force: true })

if (failures > 0) {
  console.error(`check:labels FAILED (${failures})`)
  process.exit(1)
}
console.log('check:labels passed')
