import { child, onChildAdded, onValue, ref } from 'firebase/database'
import type { ChatMessage } from '../entity/Chat'
import { rtdb } from '../lib/firebase'

export type AgentRunStatus = 'running' | 'done' | 'failed'

type SubscribeAgentRunOptions = {
  onStatus?: (status: AgentRunStatus) => void
  onMessage?: (message: Omit<ChatMessage, 'chat_id'>) => void
  onError?: (error: Error) => void
}

export function subscribeAgentRun(
  runId: string,
  options: SubscribeAgentRunOptions,
): () => void {
  const runRef = ref(rtdb, `agentRuns/${runId}`)
  const unsubscribers = [
    onValue(
      child(runRef, 'status'),
      (snapshot) => {
        const status = snapshot.val()
        if (status === 'running' || status === 'done' || status === 'failed') {
          options.onStatus?.(status)
        }
      },
      options.onError,
    ),
    onChildAdded(
      child(runRef, 'messages'),
      (snapshot) => {
        const value = snapshot.val() as Partial<ChatMessage> | null
        if (!value) return
        options.onMessage?.({
          message_id: String(value.message_id || snapshot.key || `rtdb-${runId}`),
          role: value.role === 'user' ? 'user' : 'assistant',
          content: String(value.content || ''),
          created_at: value.created_at ? String(value.created_at) : new Date().toISOString(),
          status: 'done',
          run_id: runId,
        })
      },
      options.onError,
    ),
    onChildAdded(child(runRef, 'steps'), () => undefined, options.onError),
    onChildAdded(child(runRef, 'events'), () => undefined, options.onError),
  ]

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe())
  }
}
