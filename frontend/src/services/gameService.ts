import api from '../lib/api'

export type GameItem = {
  /** Backend-assigned, stable per game — the player app keys per-item progress on it. */
  id: string
  term: string
  definition: string
}

/** Play counter per mode, keyed by the stored spellings: bucket, matching, ropelink. */
export type GameModeStats = Record<string, number>

/**
 * A created, playable game. Field names are camelCase because the backend writes the
 * gameSessions document in the shape the player client consumes.
 */
export type GameSession = {
  gameId: string
  batchId: string
  lecturerId: string
  chatId: string
  runId: string
  title: string
  items: GameItem[]
  itemCount: number
  modes: string[]
  gameModeStats: GameModeStats
  status: string
  contentHash: string
  createdAt?: string | null
  updatedAt?: string | null
  expiresAt?: string | null
  idempotent?: boolean
}

/**
 * Terminal action for the game.generate workflow. The content is not sent — the backend
 * reads it from the run's pending artifact, so this can only create the game the agent
 * actually staged. `contentHash` guards against a stale preview card.
 */
export async function createGameFromRun(
  batchId: string,
  chatId: string,
  runId: string,
  contentHash?: string,
): Promise<GameSession> {
  const res = await api.post<GameSession>(`/batches/${batchId}/games/from-run`, {
    chat_id: chatId,
    run_id: runId,
    content_hash: contentHash || '',
  })
  return res.data
}

/**
 * The link a lecturer hands to students. `/play/:id` is a public route — students
 * sign in there with Google and are checked against the batch roster — so this is
 * an absolute URL, meant to be pasted into an email or an LMS.
 */
export function gamePlayUrl(gameId: string): string {
  return `${window.location.origin}/play/${gameId}`
}

export async function listGames(batchId: string): Promise<GameSession[]> {
  const res = await api.get<GameSession[]>(`/batches/${batchId}/games`)
  return res.data
}

export async function getGame(batchId: string, gameId: string): Promise<GameSession> {
  const res = await api.get<GameSession>(`/batches/${batchId}/games/${gameId}`)
  return res.data
}

export async function deleteGame(batchId: string, gameId: string): Promise<void> {
  await api.delete(`/batches/${batchId}/games/${gameId}`)
}
