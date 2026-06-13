import { useState } from 'react'

interface ModalBackdropProps {
  onClose: () => void
}

interface ModalProps {
  open: boolean
  onClose: () => void
}

import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import PageSpinner from '../components/ui/PageSpinner'

function ModalBackdrop({ onClose }: ModalBackdropProps) {
  return (
    <div
      className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      aria-hidden="true"
    />
  )
}

function TermsModal({ open, onClose }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999]">
      <ModalBackdrop onClose={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6 md:p-8 pointer-events-none">
        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto border border-white/20">
          <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-gradient-to-r from-emerald-50/50 to-white shrink-0">
            <div>
              <h3 className="text-xl font-bold text-slate-900">PNai – Terms & Conditions</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-1">
                Last updated: 2025
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition p-2 hover:bg-slate-100 rounded-xl"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-6 text-slate-700 text-sm leading-relaxed no-scrollbar">
            <p className="font-semibold text-slate-800 italic border-l-4 border-emerald-500 pl-4 bg-emerald-50/30 py-4 rounded-r-xl">
              By using PNai (Pyin Nyar AI), you agree to the following terms. Please read
              them carefully before continuing.
            </p>
            <section className="space-y-2">
              <h4 className="font-bold text-slate-900 text-base">1. Purpose of the Service</h4>
              <p>
                PNai is an AI-powered teaching assistant designed to help educators plan
                lessons, create assessments, manage student batches, and communicate with
                students using Google Workspace tools.
              </p>
            </section>
            <section className="space-y-2">
              <h4 className="font-bold text-slate-900 text-base">2. Account Access</h4>
              <p>
                To use PNai, you must sign in using a valid Google account. You are
                responsible for maintaining the security of your account.
              </p>
            </section>
            <section className="space-y-2">
              <h4 className="font-bold text-slate-900 text-base">3. Google Services & Permissions</h4>
              <p className="text-slate-600 italic">
                PNai may request permission to access selected Google services such as Gmail,
                Google Forms, and Google Calendar to support classroom workflows.
              </p>
            </section>
            <div className="bg-green-50 border-l-4 border-green-500 p-5 rounded-r-xl">
              <p className="text-sm font-bold text-green-800">
                By continuing to use PNai, you confirm that you understand and agree to these
                Terms & Conditions.
              </p>
            </div>
          </div>
          <div className="p-6 border-t border-slate-200 bg-slate-50 shrink-0 flex gap-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 text-sm font-bold text-slate-600 bg-white border border-slate-300 rounded-2xl hover:bg-slate-50 transition shadow-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-2xl transition shadow-md"
            >
              Accept & Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AboutModal({ open, onClose }: ModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999]">
      <ModalBackdrop onClose={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6 md:p-8 pointer-events-none">
        <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto border border-white/20">
          <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-gradient-to-r from-emerald-50/50 to-white shrink-0">
            <div>
              <h3 className="text-xl font-bold text-slate-900">About & Contact PNai</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-1">
                Educator-First AI Assistant
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 transition p-2 hover:bg-slate-100 rounded-xl"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-6 text-slate-700 text-sm leading-relaxed no-scrollbar">
            <p>
              PNai (Pyin Nyar AI) is an AI-powered teaching assistant created to support
              educators in planning lessons, creating assessments, managing classes, and
              communicating with students more efficiently.
            </p>
            <p>
              The platform is designed <strong>by educators, for educators</strong>, with a
              focus on practical classroom workflows.
            </p>
            <div className="bg-emerald-50 border-l-4 border-emerald-500 p-5 rounded-r-xl">
              <p className="text-sm font-semibold text-emerald-800">
                PNai is continuously improved based on educator feedback.
              </p>
            </div>
          </div>
          <div className="p-6 border-t border-slate-200 bg-slate-50 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="w-full px-6 py-3 text-sm font-bold text-slate-600 bg-white border border-slate-300 rounded-2xl hover:bg-slate-50 transition shadow-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Login() {
  const { user, loading, signInWithGoogle } = useAuth()
  const [termsOpen, setTermsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  if (loading) {
    return <PageSpinner label="Checking sign-in status…" />
  }

  if (user) {
    return <Navigate to="/chat" replace />
  }

  function handleSignIn() {
    signInWithGoogle()
  }

  return (
    <div className="academic-bg h-screen overflow-hidden no-scrollbar relative font-sans">
      <TermsModal open={termsOpen} onClose={() => setTermsOpen(false)} />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

      <div className="flex h-full w-full">
        {/* Left: branding */}
        <div className="hidden lg:flex flex-1 flex-col justify-between p-12 xl:p-20 hero-left-branding h-full">
          <div>
            <div className="mb-10">
              <span className="px-4 py-1.5 text-[10px] font-bold tracking-[0.2em] text-emerald-700 uppercase border border-emerald-200 rounded-full bg-emerald-50/80">
                Your teaching companion
              </span>
            </div>

            <div className="mb-8">
              <div className="inline-flex bg-white/70 backdrop-blur-md p-3 rounded-3xl border border-white/50 shadow-lg">
                <span className="text-2xl xl:text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-emerald-400">
                  PNai
                </span>
              </div>
            </div>

            <div className="mb-14 max-w-2xl">
              <h2 className="text-4xl xl:text-5xl font-extrabold tracking-tight mb-2">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-emerald-400">
                  Pyin Nyar AI
                </span>
              </h2>
              <p className="text-xl xl:text-2xl text-slate-700 font-medium">
                Smart support for{' '}
                <span className="text-emerald-700 font-bold">educators</span> by{' '}
                <span className="text-emerald-700 font-bold">educators</span>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-10">
              <div className="space-y-4 bg-white/50 backdrop-blur-sm p-6 rounded-3xl border border-white/60 shadow-md">
                <h3 className="text-xl font-bold text-slate-900">AI-Powered Assessments</h3>
                <p className="text-sm text-slate-700 font-medium">
                  Generate quizzes and tests from your course materials, then distribute
                  them via Google Forms.
                </p>
              </div>
              <div className="space-y-4 bg-white/50 backdrop-blur-sm p-6 rounded-3xl border border-white/60 shadow-md">
                <h3 className="text-xl font-bold text-slate-900">Lesson Plans & Scheduling</h3>
                <p className="text-sm text-slate-700 font-medium">
                  Create structured lesson plans, manage student batches, and schedule
                  classes in Google Calendar.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-slate-300/60">
            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-bold mb-4">
              Works Seamlessly With
            </p>
            <div className="flex flex-wrap gap-6 text-slate-700 font-semibold text-sm">
              <span>Google Docs</span>
              <span>Google Forms</span>
              <span>Google Calendar</span>
              <span>Gmail</span>
            </div>
          </div>
        </div>

        {/* Right: login card */}
        <div className="w-full lg:w-[480px] xl:w-[520px] h-full flex flex-col justify-center p-10 lg:p-12 login-card overflow-y-auto no-scrollbar">
          <div className="mb-12">
            <h2 className="text-4xl font-bold text-slate-900 mb-4 tracking-tight">
              Log in to{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-500 to-emerald-600">
                PNai
              </span>
            </h2>
            <p className="text-slate-600 text-lg font-medium">
              Sign in to plan lessons, create assessments, and send them to your students.
            </p>
          </div>

          <div className="space-y-6">
            <button
              type="button"
              onClick={handleSignIn}
              className="group flex items-center justify-center gap-4 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-5 px-6 rounded-2xl transition shadow-xl"
            >
              Sign in with Google
            </button>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <p className="text-sm font-bold text-slate-900">Privacy & Data Use</p>
              <p className="text-xs text-slate-600 leading-relaxed">
                To use PNai, you may be asked to grant access to selected Google services.
                This supports lesson planning and classroom workflows.
              </p>
              <ul className="text-xs text-slate-600 list-disc list-inside space-y-1">
                <li>
                  <strong>Google Docs</strong> – lesson plans
                </li>
                <li>
                  <strong>Google Forms</strong> – assessments
                </li>
                <li>
                  <strong>Google Calendar</strong> – schedules
                </li>
                <li>
                  <strong>Gmail</strong> – communications
                </li>
              </ul>
            </div>

            <div className="mt-8 flex items-center justify-center gap-4 flex-wrap">
              <button
                type="button"
                onClick={() => setTermsOpen(true)}
                className="px-5 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm"
              >
                Terms & Conditions
              </button>
              <button
                type="button"
                onClick={() => setAboutOpen(true)}
                className="px-5 py-2.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm"
              >
                Contact & About Us
              </button>
            </div>
          </div>

          <footer className="mt-auto pt-8 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row justify-between gap-2">
            <span>&copy; 2026 Pyin Nyar AI</span>
            <span>Built to support real classroom teaching</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
