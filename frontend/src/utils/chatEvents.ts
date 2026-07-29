export const CHAT_CREATED_EVENT = 'chat-created'

export function emitChatCreated(): void {
  window.dispatchEvent(new CustomEvent(CHAT_CREATED_EVENT))
}
