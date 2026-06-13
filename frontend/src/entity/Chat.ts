export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date | null
}

export type Chat = {
  id: string
  uid: string
  batchId: string
  batchLabel: string
  title: string
  createdAt: Date | null
}
