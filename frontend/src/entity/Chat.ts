export type ChatMessage = {
  message_id: string
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string | null
}

export type Chat = {
  chat_id: string
  batch_id: string
  lecturer_id: string
  title: string
  created_at: string | null
  updated_at: string | null
}
