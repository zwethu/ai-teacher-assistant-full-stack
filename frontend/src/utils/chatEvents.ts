export const CHAT_CREATED_EVENT = 'chat-created'

/**
 * "A batch's chat list changed" — despite the name, deletions fire it too
 * (`useChatPage` has always done so), because every listener wants the same
 * thing from both: re-read the list. Listeners: `useAllSessions`, and the batch
 * page's Chats tab count.
 */
export function emitChatCreated(): void {
  window.dispatchEvent(new CustomEvent(CHAT_CREATED_EVENT))
}
