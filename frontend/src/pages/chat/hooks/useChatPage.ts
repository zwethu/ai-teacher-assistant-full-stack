import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { Batch } from '../../../entity/Batch'
import type { Chat, ChatMessage } from '../../../entity/Chat'
import { useAuth } from '../../../hooks/useAuth'
import { listBatches } from '../../../services/batchService'
import {
  createChat,
  deleteChat,
  listChats,
  listMessages,
  sendMessage,
  updateChatTitle,
} from '../../../services/chatService'

export function useChatPage() {
  const { user } = useAuth()

  const [batches, setBatches] = useState<Batch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null)

  const [chats, setChats] = useState<Chat[]>([])
  const [chatsLoading, setChatsLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [activeChat, setActiveChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    setBatchesLoading(true)
    listBatches()
      .then((data) => setBatches(data))
      .catch(console.error)
      .finally(() => setBatchesLoading(false))
  }, [user])

  const loadChats = useCallback(async (batchId: string) => {
    setChatsLoading(true)
    try {
      const data = await listChats(batchId)
      setChats(data)
    } catch (err) {
      console.error(err)
    } finally {
      setChatsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedBatch) {
      setChats([])
      setActiveChat(null)
      setMessages([])
      return
    }
    void loadChats(selectedBatch.id)
  }, [selectedBatch, loadChats])

  useEffect(() => {
    if (!activeChat || !selectedBatch) {
      setMessages([])
      return
    }
    setMessagesLoading(true)
    listMessages(selectedBatch.id, activeChat.chat_id)
      .then(setMessages)
      .catch(console.error)
      .finally(() => setMessagesLoading(false))
  }, [activeChat, selectedBatch])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function handleNewChat() {
    if (!selectedBatch) return
    const chat = await createChat(selectedBatch.id, 'New Chat')
    setChats((prev) => [chat, ...prev])
    setActiveChat(chat)
    setMessages([])
  }

  async function handleSend(text?: string) {
    const content = (text ?? input).trim()
    if (!content || !activeChat || !selectedBatch || sending) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)

    const optimisticUser: ChatMessage = {
      message_id: crypto.randomUUID(),
      chat_id: activeChat.chat_id,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimisticUser])

    try {
      const { assistant_message } = await sendMessage(
        selectedBatch.id,
        activeChat.chat_id,
        content,
      )
      setMessages((prev) => [...prev, assistant_message])

      if (activeChat.title === 'New Chat') {
        const newTitle = content.slice(0, 50)
        void updateChatTitle(selectedBatch.id, activeChat.chat_id, newTitle).then(() => {
          setChats((prev) =>
            prev.map((c) =>
              c.chat_id === activeChat.chat_id ? { ...c, title: newTitle } : c,
            ),
          )
          setActiveChat((prev) => (prev ? { ...prev, title: newTitle } : prev))
        })
      }
    } catch (err) {
      console.error(err)
      const errMsg: ChatMessage = {
        message_id: crypto.randomUUID(),
        chat_id: activeChat.chat_id,
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, errMsg])
    } finally {
      setSending(false)
    }
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  function handleTextareaInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function startRename(chat: Chat) {
    setRenamingId(chat.chat_id)
    setRenameValue(chat.title)
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }

  async function commitRename() {
    if (!renamingId || !selectedBatch) return
    const title = renameValue.trim() || 'New Chat'
    await updateChatTitle(selectedBatch.id, renamingId, title).catch(console.error)
    setChats((prev) => prev.map((c) => (c.chat_id === renamingId ? { ...c, title } : c)))
    if (activeChat?.chat_id === renamingId) {
      setActiveChat((prev) => (prev ? { ...prev, title } : prev))
    }
    setRenamingId(null)
  }

  async function handleDeleteChat(chat: Chat) {
    if (!selectedBatch) return
    if (!window.confirm(`Delete "${chat.title}"?`)) return
    await deleteChat(selectedBatch.id, chat.chat_id).catch(console.error)
    setChats((prev) => prev.filter((c) => c.chat_id !== chat.chat_id))
    if (activeChat?.chat_id === chat.chat_id) {
      setActiveChat(null)
      setMessages([])
    }
  }

  const showWelcome =
    !!activeChat && messages.length === 0 && !messagesLoading && !sending

  return {
    batches,
    batchesLoading,
    selectedBatch,
    setSelectedBatch,
    chats,
    chatsLoading,
    sidebarOpen,
    setSidebarOpen,
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    activeChat,
    setActiveChat,
    messages,
    messagesLoading,
    input,
    setInput,
    sending,
    messagesEndRef,
    textareaRef,
    renameInputRef,
    handleNewChat,
    handleSend,
    handleInputKeyDown,
    handleTextareaInput,
    startRename,
    commitRename,
    handleDeleteChat,
    showWelcome,
  }
}

export type ChatPageState = ReturnType<typeof useChatPage>
