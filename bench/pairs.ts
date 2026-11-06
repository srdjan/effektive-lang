// The A/B alternation of the paired measurements. Side A runs first on an even
// turn and side B runs first on an odd turn. The same function maps the
// results of the first and second run of a turn back to the order [A, B], so
// the A/A noise floor of `stats.ts` depends on this one rule.

/**
 * `[x, y]` on an even turn and `[y, x]` on an odd turn. With the two sides
 * `[a, b]` the result is the run order `[first, second]`. With the results
 * `[first, second]` the result is the pair `[a, b]`.
 */
export function byTurn<T>(turn: number, x: T, y: T): readonly [T, T] {
  return turn % 2 === 0 ? [x, y] : [y, x];
}
