import { useCallback, useEffect, useRef, useState } from 'react'
import { listBatches } from '../services/batchService'
import { listChats } from '../services/chatService'
import { CHAT_CREATED_EVENT } from '../utils/chatEvents'

export type SessionItem = {
  chat_id: string
  batch_id: string
  batch_name: string
  title: string
  updated_at: string | null
  preview: string
}

const CACHE_TTL_MS = 30_000

type CacheEntry = {
  data: SessionItem[]
  fetchedAt: number
}

let sessionsCache: CacheEntry | null = null

async function buildSessions(): Promise<SessionItem[]> {
  const batches = await listBatches()
  const results: SessionItem[] = []

  await Promise.all(
    batches.map(async (batch) => {
      const chats = await listChats(batch.id)
      for (const chat of chats) {
        results.push({
          chat_id: chat.chat_id,
          batch_id: batch.id,
          batch_name: batch.batch_name,
          title: chat.title,
          updated_at: chat.updated_at ?? chat.created_at,
          // Written onto the chat doc with the first user message. Chats that
          // predate the field have none, and fall back to the title.
          preview: chat.preview ?? '',
        })
      }
    }),
  )

  results.sort((a, b) => {
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
    return bTime - aTime
  })

  return results
}

// Previews now ride along on the chat document, so there is no longer an
// `includePreviews` opt-in — they cost nothing to include.
export function useAllSessions(options?: { limit?: number }) {
  const limit = options?.limit
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const refresh = useCallback(
    async (force = false) => {
      if (
        !force &&
        sessionsCache &&
        Date.now() - sessionsCache.fetchedAt < CACHE_TTL_MS
      ) {
        const cached = limit ? sessionsCache.data.slice(0, limit) : sessionsCache.data
        setSessions(cached)
        setLoading(false)
        return
      }

      setLoading(true)
      try {
        const data = await buildSessions()
        sessionsCache = { data, fetchedAt: Date.now() }
        if (mountedRef.current) {
          setSessions(limit ? data.slice(0, limit) : data)
        }
      } catch (err) {
        console.error(err)
        if (mountedRef.current) setSessions([])
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    },
    [limit],
  )

  useEffect(() => {
    mountedRef.current = true
    void refresh()

    function onChatCreated() {
      void refresh(true)
    }
    window.addEventListener(CHAT_CREATED_EVENT, onChatCreated)
    return () => {
      mountedRef.current = false
      window.removeEventListener(CHAT_CREATED_EVENT, onChatCreated)
    }
  }, [refresh])

  return { sessions, loading, refresh }
}

export function invalidateSessionsCache(): void {
  sessionsCache = null
}
