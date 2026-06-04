import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout.jsx'
import ProtectedRoute from './components/layout/ProtectedRoute.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Assessments from './pages/Assessments.jsx'
import LessonPlans from './pages/LessonPlans.jsx'
import Batches from './pages/Batches.jsx'
import Email from './pages/Email.jsx'
import Timetable from './pages/Timetable.jsx'
import Wellness from './pages/Wellness.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/assessments" element={<Assessments />} />
            <Route path="/lesson-plans" element={<LessonPlans />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/email" element={<Email />} />
            <Route path="/timetable" element={<Timetable />} />
            <Route path="/wellness" element={<Wellness />} />
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
