import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ConfirmHost } from './components/ui/ConfirmDialog'
import { UndoHost } from './components/ui/UndoToast'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoadingScreen from './components/ui/LoadingScreen'

/**
 * Every page is a lazy chunk. Before this, the whole product shipped as one
 * 4.3MB file — a student opening a game link downloaded the entire teacher
 * app, and a lecturer downloaded the cat game's Lottie player. Splitting at
 * the route level is what separates them: the game routes carry
 * lottie/phosphor, the chat route carries markdown/KaTeX, and none of it
 * loads until its URL does.
 *
 * The shell (router, auth, layout, dialogs) stays eager — it is small and
 * every route needs it.
 */
const AuthCallback = lazy(() => import('./pages/AuthCallback'))
const Login = lazy(() => import('./pages/Login'))
const Chat = lazy(() => import('./pages/chat'))
const Assessments = lazy(() => import('./pages/Assessments'))
const LessonPlans = lazy(() => import('./pages/LessonPlans'))
const Batches = lazy(() => import('./pages/batches'))
const Email = lazy(() => import('./pages/Email'))
const CatGamePage = lazy(() => import('./pages/CatGamePage'))
const CatThemePickerPage = lazy(() => import('./pages/CatThemePickerPage'))
const CatPreviewPage = lazy(() => import('./pages/CatPreviewPage'))
const PlayEntryPage = lazy(() => import('./pages/PlayEntryPage'))
const Games = lazy(() => import('./pages/Games'))
const ChatHistory = lazy(() => import('./pages/ChatHistory'))

export default function App() {
  return (
    <BrowserRouter>
      {/* One Suspense above Routes: a chunk loading looks exactly like the
          auth check that precedes it — same canvas, same garland — so the
          hand-off between the two reads as one continuous load. */}
      <Suspense fallback={<LoadingScreen label="Loading…" />}>
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
      </Suspense>

      {/* Outside `<Routes>` so a pending undo survives navigation — the whole
          point of holding the delete is that leaving the page must not quietly
          cancel it, nor lose the way back. */}
      <ConfirmHost />
      <UndoHost />
    </BrowserRouter>
  )
}
