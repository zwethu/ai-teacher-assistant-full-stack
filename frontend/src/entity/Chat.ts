export type ChatMessage = {
  message_id: string
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string | null
  status?: 'pending' | 'done' | 'failed'
  run_id?: string
  pending?: boolean
}

export type Chat = {
  chat_id: string
  batch_id: string
  lecturer_id: string
  title: string
  agent_session_id?: string
  agent_user_id?: string
  active_run_id?: string
  last_run_id?: string
  last_run_status?: string
  agent_engine_resource_name?: string
  created_at: string | null
  updated_at: string | null
}
