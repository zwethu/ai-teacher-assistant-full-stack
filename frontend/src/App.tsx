import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ConfirmHost } from './components/ui/ConfirmDialog'
import { UndoHost } from './components/ui/UndoToast'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/layout/ProtectedRoute'
import AuthCallback from './pages/AuthCallback'
import Login from './pages/Login'
import Chat from './pages/chat'
import Assessments from './pages/Assessments'
import LessonPlans from './pages/LessonPlans'
import Batches from './pages/batches'
import Email from './pages/Email'
import CatGamePage from './pages/CatGamePage'
import CatThemePickerPage from './pages/CatThemePickerPage'
import CatPreviewPage from './pages/CatPreviewPage'
import PlayEntryPage from './pages/PlayEntryPage'
import Games from './pages/Games'
import ChatHistory from './pages/ChatHistory'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ─── Public auth routes ─── */}
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* ─── Student game routes (standalone, no layout, no teacher auth) ─── */}
        <Route path="/play/:assessmentId" element={<PlayEntryPage />} />
        <Route path="/play/:assessmentId/game" element={<CatGamePage />} />

        {/* ─── Dev/preview routes ─── */}
        <Route path="/cat-themes" element={<CatThemePickerPage />} />
        <Route path="/play-preview" element={<CatPreviewPage />} />

        {/* ─── Teacher app (protected + layout) ─── */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/chat" element={<Chat />} />
            <Route path="/batches/:batchId/chats/:chatId" element={<Chat />} />
            <Route path="/chat-history" element={<ChatHistory />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/assessments" element={<Assessments />} />
            <Route path="/lesson-plans" element={<LessonPlans />} />
            <Route path="/email" element={<Email />} />
            <Route path="/games" element={<Games />} />
            <Route path="/cat-game" element={<CatGamePage />} />
          </Route>
        </Route>

        {/* Chat is the product's front door — every workflow starts from the
            composer — so it is where an unrouted visit lands. */}
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>

      {/* Outside `<Routes>` so a pending undo survives navigation — the whole
          point of holding the delete is that leaving the page must not quietly
          cancel it, nor lose the way back. */}
      <ConfirmHost />
      <UndoHost />
    </BrowserRouter>
  )
}
