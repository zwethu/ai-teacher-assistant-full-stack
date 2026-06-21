import { useNavigate } from 'react-router-dom'
import { Loader2, MessageCircle } from 'lucide-react'
import { useAllSessions } from '../hooks/useAllSessions'
import { formatDateTime } from '../utils/formatDate'

export default function ChatHistory() {
  const navigate = useNavigate()
  const { sessions, loading } = useAllSessions({ includePreviews: true })

  const grouped = sessions.reduce<
    Record<string, { batch_name: string; chats: typeof sessions }>
  >((acc, session) => {
    if (!acc[session.batch_id]) {
      acc[session.batch_id] = { batch_name: session.batch_name, chats: [] }
    }
    acc[session.batch_id].chats.push(session)
    return acc
  }, {})

  const batchGroups = Object.entries(grouped)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Sessions</h1>
        <p className="text-sm text-slate-500 mt-1">
          All chat sessions across your batches.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            <p className="text-sm text-slate-500">Loading sessions…</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <MessageCircle className="w-8 h-8 text-slate-300 mb-3" />
            <h3 className="text-sm font-medium text-slate-900">No sessions yet</h3>
            <p className="mt-1 text-sm text-slate-500">
              Start a chat from a batch to see your session history here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {batchGroups.map(([batchId, group]) => (
              <section key={batchId}>
                <div className="px-6 py-3 bg-slate-50/90 border-b border-slate-100">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {group.batch_name}
                  </h2>
                </div>
                <ul className="divide-y divide-slate-50">
                  {group.chats.map((chat) => (
                    <li key={chat.chat_id}>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/batches/${chat.batch_id}/chats/${chat.chat_id}`)
                        }
                        className="w-full text-left px-6 py-4 hover:bg-emerald-50/60 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-900 truncate">
                              {chat.title}
                            </div>
                            {chat.preview && (
                              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                                {chat.preview}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-slate-400 whitespace-nowrap flex-shrink-0">
                            {chat.updated_at ? formatDateTime(chat.updated_at) : '—'}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
