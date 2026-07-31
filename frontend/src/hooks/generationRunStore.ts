import type { Chat } from '../entity/Chat'

// Store so a standalone generation run survives navigation AND full page reloads.
// The run itself continues server-side (backend background task streaming to RTDB);
// we only persist the identifiers needed to reconnect and re-render progress when
// the user returns. Keyed by `${batchId}:${workflowKey}`. Backed by localStorage:
// before persistence, a hard reload minted a brand-new workflow chat (and thus a
// new agent session), orphaning an outline that was mid-approval.

export type GenerationPhase = 'outline' | 'full' | 'refine' | null

export type PersistedGenerationRun = {
  chat: Chat | null
  currentRunId: string | null
  activePhase: GenerationPhase
}

const STORAGE_PREFIX = 'pnai.generationRun.'

const store = new Map<string, PersistedGenerationRun>()

function loadFromStorage(key: string): PersistedGenerationRun | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as PersistedGenerationRun
    if (!parsed || typeof parsed !== 'object') return undefined
    return {
      chat: parsed.chat ?? null,
      currentRunId: parsed.currentRunId ?? null,
      activePhase: parsed.activePhase ?? null,
    }
  } catch {
    return undefined
  }
}

function saveToStorage(key: string, value: PersistedGenerationRun): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full/unavailable — in-memory behavior still works for this tab.
  }
}

export function readGenerationRun(key: string): PersistedGenerationRun | undefined {
  const inMemory = store.get(key)
  if (inMemory) return inMemory
  const persisted = loadFromStorage(key)
  if (persisted) store.set(key, persisted)
  return persisted
}

export function writeGenerationRun(key: string, patch: Partial<PersistedGenerationRun>): void {
  const prev =
    store.get(key) ??
    loadFromStorage(key) ??
    ({ chat: null, currentRunId: null, activePhase: null } as PersistedGenerationRun)
  const next = { ...prev, ...patch }
  store.set(key, next)
  saveToStorage(key, next)
}

export function clearGenerationRun(key: string): void {
  store.delete(key)
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    // ignore
  }
}
