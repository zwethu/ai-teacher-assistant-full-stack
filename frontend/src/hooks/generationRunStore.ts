import type { Chat } from '../entity/Chat'

// Module-level store so a standalone generation run survives navigation. The run
// itself continues server-side (backend background task streaming to RTDB); we
// only persist the identifiers needed to reconnect and re-render progress when
// the user returns to the page. Keyed by `${batchId}:${workflowKey}`.

export type GenerationPhase = 'outline' | 'full' | 'refine' | null

export type PersistedGenerationRun = {
  chat: Chat | null
  currentRunId: string | null
  activePhase: GenerationPhase
}

const store = new Map<string, PersistedGenerationRun>()

export function readGenerationRun(key: string): PersistedGenerationRun | undefined {
  return store.get(key)
}

export function writeGenerationRun(key: string, patch: Partial<PersistedGenerationRun>): void {
  const prev = store.get(key) ?? { chat: null, currentRunId: null, activePhase: null }
  store.set(key, { ...prev, ...patch })
}

export function clearGenerationRun(key: string): void {
  store.delete(key)
}
