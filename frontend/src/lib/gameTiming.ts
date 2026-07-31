/**
 * How long a game round lasts. The engine owns this (methodology: timing is
 * defined by the app, never by the AI), but the lecturer needs the same number
 * while choosing how many pairs to generate — so it lives here rather than
 * inside the player, where the two could silently drift apart.
 *
 * 30 seconds a pair makes the standard 30-pair game a 15-minute round.
 */
export const SECONDS_PER_ITEM = 30

/** Even a tiny game gets a usable clock. */
export const MIN_LIMIT_MS = 60_000

export function gameTimeLimitMs(itemCount: number): number {
  return Math.max(MIN_LIMIT_MS, itemCount * SECONDS_PER_ITEM * 1000)
}

/** The round length as a lecturer-facing estimate, in whole minutes. */
export function gameTimeLimitMinutes(itemCount: number): number {
  return Math.round(gameTimeLimitMs(itemCount) / 60_000)
}
