import type { Chat, ChatMessage } from '../entity/Chat'
import api from '../lib/api'

// ---------------------------------------------------------------------------
// Chat CRUD
// ---------------------------------------------------------------------------

export async function createChat(batchId: string, title: string = 'New Chat'): Promise<Chat> {
  const res = await api.post<Chat>(`/batches/${batchId}/chats`, { title })
  return res.data
}

export async function listChats(batchId: string): Promise<Chat[]> {
  const res = await api.get<Chat[]>(`/batches/${batchId}/chats`)
  return res.data
}

export async function deleteChat(batchId: string, chatId: string): Promise<void> {
  await api.delete(`/batches/${batchId}/chats/${chatId}`)
}

export async function updateChatTitle(
  batchId: string,
  chatId: string,
  title: string,
): Promise<void> {
  await api.patch(`/batches/${batchId}/chats/${chatId}/title`, { title })
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function listMessages(batchId: string, chatId: string): Promise<ChatMessage[]> {
  const res = await api.get<ChatMessage[]>(`/batches/${batchId}/chats/${chatId}/messages`)
  return res.data
}

export async function sendMessage(
  batchId: string,
  chatId: string,
  content: string,
): Promise<{ user_message: ChatMessage; assistant_message: ChatMessage }> {
  const res = await api.post<{
    user_message: ChatMessage
    assistant_message: ChatMessage
  }>(`/batches/${batchId}/chats/${chatId}/messages`, { content })
  return res.data
}
