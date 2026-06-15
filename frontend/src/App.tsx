import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/layout/ProtectedRoute'
import AuthCallback from './pages/AuthCallback'
import Login from './pages/Login'
import Chat from './pages/chat'
import Assessments from './pages/Assessments'
import LessonPlans from './pages/LessonPlans'
import Batches from './pages/batches'
import Email from './pages/Email'
import ChatHistory from './pages/ChatHistory'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/chat" element={<Chat />} />
            <Route path="/chat-history" element={<ChatHistory />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/assessments" element={<Assessments />} />
            <Route path="/lesson-plans" element={<LessonPlans />} />
            <Route path="/email" element={<Email />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/assessments" replace />} />
        <Route path="*" element={<Navigate to="/assessments" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
