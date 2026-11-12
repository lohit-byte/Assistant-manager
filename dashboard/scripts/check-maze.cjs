#!/usr/bin/env node
/**
 * Offline check for the maze discount windows.
 *
 * The ladder exists twice: `bot/maze_timing.py` (the bot that pings) and
 * `dashboard/lib/constants.ts` (the timeline the dashboard draws). A drift between them means the
 * dashboard shows times the bot does not ping, so this compiles the TypeScript helper and compares
 * it with the Python table, then checks the table's own shape.
 *
 * No network, no Supabase. Run with `npm run check:maze` from `dashboard/`.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const REPO = path.resolve(ROOT, '..')
const TMP_DIR = path.join(ROOT, '.tmp-maze-check')
const ENTRY = 'lib/constants.ts'

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
      '--skipLibCheck',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    console.error('FAIL lib/constants.ts did not compile')
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }

  const candidates = [
    path.join(TMP_DIR, 'constants.js'),
    path.join(TMP_DIR, 'lib', 'constants.js'),
  ]
  const compiled = candidates.find((candidate) => fs.existsSync(candidate))
  if (!compiled) {
    console.error(`FAIL compiled constants not found under ${TMP_DIR}`)
    process.exit(1)
  }
  return require(compiled)
}

function pythonLadder() {
  const code = [
    'import json, sys',
    "sys.path.insert(0, 'bot')",
    'from maze_timing import MAZE_DURATION, WINDOWS_7D',
    "print(json.dumps({'days': MAZE_DURATION.days, 'windows': [list(w) for w in WINDOWS_7D]}))",
  ].join('\n')
  const result = spawnSync('python3', ['-c', code], { cwd: REPO, encoding: 'utf8' })
  if (result.status !== 0) {
    console.error('FAIL could not read bot/maze_timing.py with python3')
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }
  return JSON.parse(result.stdout)
}

const { MAZE_WINDOWS, MAZE_DURATION_DAYS } = compile()
const bot = pythonLadder()

// 1. The bot and the dashboard must describe the same ladder.
if (bot.days !== MAZE_DURATION_DAYS) {
  fail(`duration differs: bot ${bot.days} d, dashboard ${MAZE_DURATION_DAYS} d`)
}

const dashboard = MAZE_WINDOWS.map((window) => [window.start, window.end, window.percent])
if (JSON.stringify(dashboard) !== JSON.stringify(bot.windows)) {
  fail(
    `ladder differs:\n  bot       ${JSON.stringify(bot.windows)}\n  dashboard ${JSON.stringify(dashboard)}`,
  )
}

// 2. The ladder must be ordered, inside the event, and gaps-only (no overlapping windows).
let previousEnd = 0
for (const [start, end, percent] of bot.windows) {
  if (!(start >= previousEnd)) fail(`window ${percent} starts at ${start} h, before the previous end ${previousEnd} h`)
  if (!(end > start)) fail(`window ${percent} ends at ${end} h, not after its start ${start} h`)
  if (!(end <= bot.days * 24)) fail(`window ${percent} ends at ${end} h, after the ${bot.days}-day event`)
  if (!/^\d{1,3}%$/.test(percent)) fail(`window percent ${JSON.stringify(percent)} is not a percentage`)
  previousEnd = end
}
if (bot.windows.length === 0) fail('the ladder is empty')
if (bot.windows[bot.windows.length - 1][1] !== bot.days * 24) {
  fail('the last window must end with the event')
}

// 3. The four real state changes from the 5-12 Nov 2026 maze (screenshots) must be present.
const expectedStarts = [0, 5, 24, 72, 120, 164]
if (JSON.stringify(bot.windows.map((window) => window[0])) !== JSON.stringify(expectedStarts)) {
  fail('window starts no longer match the observed 5-12 Nov 2026 maze')
}

fs.rmSync(TMP_DIR, { recursive: true, force: true })

if (!process.exitCode) console.log(`PASS maze ladder: ${bot.windows.length} windows over ${bot.days} days, bot and dashboard agree`)
