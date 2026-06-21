import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/layout/ProtectedRoute'
import AuthCallback from './pages/AuthCallback'
import Login from './pages/Login'
import Chat from './pages/Chat'
import Assessments from './pages/Assessments'
import LessonPlans from './pages/LessonPlans'
import Batches from './pages/Batches'
import Email from './pages/Email'
import CatGamePage from './pages/CatGamePage'
import CatThemePickerPage from './pages/CatThemePickerPage'
import PlayEntryPage from './pages/PlayEntryPage'

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

        {/* ─── Teacher app (protected + layout) ─── */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/chat" element={<Chat />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/assessments" element={<Assessments />} />
            <Route path="/lesson-plans" element={<LessonPlans />} />
            <Route path="/email" element={<Email />} />
            <Route path="/cat-game" element={<CatGamePage />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/assessments" replace />} />
        <Route path="*" element={<Navigate to="/assessments" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
