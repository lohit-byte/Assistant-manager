/**
 * Index math for the infinite wheel picker (`components/wheel-picker.tsx`).
 *
 * The wheel renders `copies` repeats of the value list and keeps the centred row inside the
 * middle copy, so the scroll never reaches an end. The helpers are pure so `npm run check:wheel`
 * verifies the wrap / recentre behaviour without a browser (same pattern as check:plans).
 */

/** Wrap into [0, length). JavaScript's `%` keeps the sign of the dividend, this does not. */
export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

/** Value shown at an absolute row index, or null for an empty list. */
export function valueAtIndex(values: number[], index: number): number | null {
  if (values.length === 0) return null
  return values[wrapIndex(index, values.length)]
}

/** Absolute row index of `value` inside the middle copy of the repeated list. */
export function indexForValue(values: number[], value: number, copies: number): number {
  const length = values.length
  if (length === 0) return 0
  const position = values.indexOf(value)
  return Math.floor(copies / 2) * length + (position >= 0 ? position : 0)
}

/** Nearest row index for a scroll offset, clamped to the rows actually rendered. */
export function indexAtOffset(scrollTop: number, rowHeight: number, rowCount: number): number {
  if (rowHeight <= 0 || rowCount <= 0) return 0
  return Math.min(rowCount - 1, Math.max(0, Math.round(scrollTop / rowHeight)))
}

/**
 * Where to jump after the scroll settles, or null when the centred row is already inside the
 * middle copy. Jumping by whole copies changes nothing visually — the repeated values are equal.
 */
export function recenterTarget(index: number, length: number, copies: number): number | null {
  if (length <= 0) return null
  const middleStart = Math.floor(copies / 2) * length
  if (index >= middleStart && index < middleStart + length) return null
  return middleStart + wrapIndex(index, length)
}

/** Digits typed on the keyboard ("07") mapped to the nearest available value. */
export function valueFromTyped(values: number[], typed: string): number | null {
  if (values.length === 0 || !/^\d{1,3}$/.test(typed)) return null
  const parsed = Number.parseInt(typed, 10)
  let best = values[0]
  for (const candidate of values) {
    if (Math.abs(candidate - parsed) < Math.abs(best - parsed)) best = candidate
  }
  return best
}
