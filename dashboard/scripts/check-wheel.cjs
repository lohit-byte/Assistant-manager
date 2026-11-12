#!/usr/bin/env node
/**
 * Offline check for the infinite wheel's index math (`lib/wheel-math.ts`).
 *
 * Compiles the helper with the local TypeScript compiler and runs fixtures over it. No browser,
 * no Supabase, no test framework — same approach as `scripts/check-plans.cjs`.
 *
 * Run with `npm run check:wheel` from `dashboard/`.
 */

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TMP_DIR = path.join(ROOT, '.tmp-wheel-check')
const ENTRY = 'lib/wheel-math.ts'

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
      'es2019,dom',
      '--strict',
      '--skipLibCheck',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    console.error('FAIL lib/wheel-math.ts did not compile')
    if (result.stdout) console.error(result.stdout)
    if (result.stderr) console.error(result.stderr)
    process.exit(1)
  }

  const candidates = [
    path.join(TMP_DIR, 'wheel-math.js'),
    path.join(TMP_DIR, 'lib', 'wheel-math.js'),
  ]
  const compiled = candidates.find((candidate) => fs.existsSync(candidate))
  if (!compiled) {
    console.error(`FAIL compiled helper not found under ${TMP_DIR}`)
    process.exit(1)
  }
  return require(compiled)
}

const {
  wrapIndex,
  valueAtIndex,
  indexForValue,
  indexAtOffset,
  recenterTarget,
  valueFromTyped,
} = compile()

const minutes = Array.from({ length: 60 }, (_, index) => index)
const hours = Array.from({ length: 24 }, (_, index) => index)
const COPIES = 5

// The wheel loops: after 59 comes 00, before 00 comes 59.
check('wrap -1 into the minutes list', wrapIndex(-1, 60), 59)
check('wrap 60 into the minutes list', wrapIndex(60, 60), 0)
check('wrap -61 into the minutes list', wrapIndex(-61, 60), 59)
check('value at -1 is 59', valueAtIndex(minutes, -1), 59)
check('value at 60 is 0', valueAtIndex(minutes, 60), 0)
check('empty list has no value', valueAtIndex([], 3), null)

// The controlled value always maps to a row in the middle copy, never at an edge.
check('hours value 0 sits at the middle copy', indexForValue(hours, 0, COPIES), 2 * 24)
check('hours value 23 sits at the middle copy', indexForValue(hours, 23, COPIES), 2 * 24 + 23)
check('missing value falls back to the first', indexForValue(hours, 99, COPIES), 2 * 24)

// Scroll offset -> row, clamped to the rendered rows.
check('offset 0 is row 0', indexAtOffset(0, 44, 120), 0)
check('offset 132 is row 3', indexAtOffset(132, 44, 120), 3)
check('offset 133 is still row 3', indexAtOffset(133, 44, 120), 3)
check('offset beyond the end clamps', indexAtOffset(99999, 44, 120), 119)

// Recentring happens only outside the middle copy, and keeps the same value centred.
check('middle copy needs no recentre', recenterTarget(2 * 24 + 5, 24, COPIES), null)
check('first copy jumps to the middle', recenterTarget(7, 24, COPIES), 2 * 24 + 7)
check('last copy jumps back to the middle', recenterTarget(4 * 24 + 9, 24, COPIES), 2 * 24 + 9)
check('recentre keeps the value', valueAtIndex(hours, recenterTarget(7, 24, COPIES)), 7)

// Typed digits pick the nearest available value (the calendar has no minutes above 59).
check('typed 07 is 7', valueFromTyped(minutes, '07'), 7)
check('typed 3 on a day column is 3', valueFromTyped([0, 1, 2, 3], '3'), 3)
check('typed 99 snaps to 59', valueFromTyped(minutes, '99'), 59)
check('non-digits are ignored', valueFromTyped(minutes, 'x'), null)

fs.rmSync(TMP_DIR, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} wheel math check(s) failed`)
  process.exit(1)
}
console.log('\nPASS wheel math: wrap, recentre and typed-input handling')
