import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  Mail,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase.js'
import { useAuth } from '../hooks/useAuth.js'
import {
  checkGooglePermissions,
  startGoogleOAuth,
} from '../services/authService.js'
import { fromFirestore, toFirestore } from '../entity/Email.js'
import { sendEmailNow } from '../services/emailService.js'
import { formatDateTime, timeAgo } from '../utils/formatDate.js'

const NOTES_PREVIEW_LEN = 120

const INITIAL_FORM = {
  to: '',
  subject: '',
  body: '',
  sendAt: '',
}

function Toast({ toast, onDismiss }) {
  if (!toast) return null
  const isError = toast.type === 'error'
  return (
    <div
      className={`fixed bottom-6 right-6 z-[100] max-w-sm rounded-xl border px-4 py-3 shadow-lg flex items-start gap-3 ${
        isError
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
      }`}
      role="status"
    >
      <p className="text-sm font-medium flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="p-1 rounded-md hover:bg-black/5"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

function minScheduleLocal() {
  const d = new Date(Date.now() + 60_000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function truncateText(text, max = NOTES_PREVIEW_LEN) {
  const t = (text || '').trim()
  if (!t) return 'No message preview'
  if (t.length <= max) return t
  return `${t.slice(0, max).trim()}…`
}

function statusBadgeClass(status) {
  if (status === 'sent') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
  return 'bg-amber-50 text-amber-800 border-amber-200'
}

export default function Email() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [emails, setEmails] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [hasGoogleScopes, setHasGoogleScopes] = useState(false)
  const [permissionsLoading, setPermissionsLoading] = useState(true)

  const [modalMode, setModalMode] = useState(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState(null)

  function showToast(type, message) {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }

  async function refreshPermissions() {
    setPermissionsLoading(true)
    try {
      const { has_google_scopes: ok } = await checkGooglePermissions()
      setHasGoogleScopes(ok)
    } catch (err) {
      console.error(err)
      setHasGoogleScopes(false)
    } finally {
      setPermissionsLoading(false)
    }
  }

  useEffect(() => {
    refreshPermissions()
  }, [])

  useEffect(() => {
    const oauthResult = searchParams.get('google_scopes')
    if (!oauthResult) return

    if (oauthResult === 'success') {
      showToast('success', 'Google account connected successfully.')
      refreshPermissions()
    } else if (oauthResult === 'error') {
      showToast('error', 'Could not connect Google account. Please try again.')
    }

    searchParams.delete('google_scopes')
    setSearchParams(searchParams, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (!user?.uid) {
      setEmails([])
      setListLoading(false)
      return undefined
    }

    setListLoading(true)
    const q = query(
      collection(db, 'emails'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEmails(
          snapshot.docs.map((d) => fromFirestore(d)).filter(Boolean),
        )
        setListLoading(false)
      },
      (err) => {
        console.error('Failed to load emails:', err)
        setListLoading(false)
      },
    )

    return unsubscribe
  }, [user?.uid])

  function openSendModal() {
    setModalMode('send')
    setForm({ ...INITIAL_FORM })
    setFormError('')
  }

  function openScheduleModal() {
    setModalMode('schedule')
    setForm({
      ...INITIAL_FORM,
      sendAt: minScheduleLocal(),
    })
    setFormError('')
  }

  function closeModal() {
    if (saving) return
    setModalMode(null)
    setFormError('')
  }

  async function handleConnectGoogle() {
    try {
      await startGoogleOAuth()
    } catch (err) {
      showToast('error', err.message || 'Could not start Google sign-in.')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!user) return

    setSaving(true)
    setFormError('')

    const payload = {
      to: form.to.trim(),
      subject: form.subject.trim(),
      body: form.body.trim(),
    }

    try {
      if (modalMode === 'send') {
        const { has_google_scopes: ok } = await checkGooglePermissions()
        if (!ok) {
          await startGoogleOAuth()
          return
        }

        await sendEmailNow(payload)

        await addDoc(
          collection(db, 'emails'),
          toFirestore({
            uid: user.uid,
            to: payload.to,
            subject: payload.subject,
            body: payload.body,
            status: 'sent',
            sentAt: serverTimestamp(),
            createdAt: serverTimestamp(),
          }),
        )

        closeModal()
        showToast('success', 'Email sent successfully.')
      } else if (modalMode === 'schedule') {
        if (!form.sendAt) {
          setFormError('Please choose a send date and time.')
          return
        }
        const sendDate = new Date(form.sendAt)
        if (sendDate <= new Date()) {
          setFormError('Scheduled time must be in the future.')
          return
        }

        await addDoc(
          collection(db, 'emails'),
          toFirestore({
            uid: user.uid,
            to: payload.to,
            subject: payload.subject,
            body: payload.body,
            status: 'pending',
            sendAt: sendDate.toISOString(),
            createdAt: serverTimestamp(),
          }),
        )

        closeModal()
        showToast('success', 'Email scheduled successfully')
      }
    } catch (err) {
      console.error(err)
      const detail = err.response?.data?.detail
      let message = err.message
      if (typeof detail === 'string') message = detail
      else if (Array.isArray(detail)) {
        message = detail.map((x) => x.msg || x).join(', ')
      } else if (!message) {
        message =
          modalMode === 'send'
            ? 'Failed to send email.'
            : 'Failed to schedule email.'
      }
      setFormError(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleCancelScheduled(item) {
    if (!window.confirm(`Cancel scheduled email to ${item.to}?`)) return
    try {
      await deleteDoc(doc(db, 'emails', item.id))
      showToast('success', 'Scheduled email cancelled.')
    } catch (err) {
      console.error(err)
      showToast('error', 'Failed to cancel scheduled email.')
    }
  }

  const showGoogleBanner = !permissionsLoading && !hasGoogleScopes

  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Mail className="w-6 h-6 text-emerald-600" />
            Emails
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Send messages now or schedule them for later.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={openScheduleModal}
            className="inline-flex items-center justify-center px-4 py-2 border border-emerald-200 text-sm font-medium rounded-md text-emerald-700 bg-emerald-50 hover:bg-emerald-100 shadow-sm transition-colors"
          >
            <CalendarClock className="w-4 h-4 mr-2" />
            Schedule Email
          </button>
          <button
            type="button"
            onClick={openSendModal}
            className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
          >
            <Send className="w-4 h-4 mr-2" />
            Send Now
          </button>
        </div>
      </div>

      {showGoogleBanner && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-start gap-3 flex-1">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-900">
              Connect your Google account to send emails
            </p>
          </div>
          <button
            type="button"
            onClick={handleConnectGoogle}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm shrink-0"
          >
            Connect Google
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {listLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            <p className="text-sm text-slate-500">Loading emails…</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="h-16 w-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <Mail className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-sm font-medium text-slate-900">
              No emails yet. Send your first email!
            </h3>
            <p className="mt-1 text-sm text-slate-500 mb-6 max-w-sm">
              Deliver instantly with Gmail or schedule a message for later.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                type="button"
                onClick={openSendModal}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm"
              >
                <Send className="w-4 h-4 mr-2" />
                Send Now
              </button>
              <button
                type="button"
                onClick={openScheduleModal}
                className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
              >
                <CalendarClock className="w-4 h-4 mr-2" />
                Schedule Email
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {emails.map((item) => {
              const isPending = item.status === 'pending'
              return (
                <article
                  key={item.id}
                  className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-emerald-200/80 transition-all"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500 truncate">To</p>
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {item.to || '—'}
                      </p>
                    </div>
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${statusBadgeClass(item.status)}`}
                    >
                      {item.status === 'sent' ? 'Sent' : 'Pending'}
                    </span>
                  </div>

                  <h3 className="font-semibold text-slate-800 truncate mb-2">
                    {item.subject || 'No subject'}
                  </h3>

                  <p className="text-sm text-slate-600 line-clamp-3 mb-4 leading-relaxed">
                    {truncateText(item.body)}
                  </p>

                  <dl className="text-xs text-slate-500 space-y-1 border-t border-slate-100 pt-3">
                    {isPending ? (
                      <div className="flex justify-between gap-2">
                        <dt>Scheduled for</dt>
                        <dd className="text-slate-700 font-medium text-right">
                          {formatDateTime(item.sendAt)}
                        </dd>
                      </div>
                    ) : (
                      <div className="flex justify-between gap-2">
                        <dt>Sent at</dt>
                        <dd className="text-slate-700 font-medium text-right">
                          {formatDateTime(item.sentAt)}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <dt>Created</dt>
                      <dd className="text-slate-700 font-medium text-right">
                        {timeAgo(item.createdAt)}
                      </dd>
                    </div>
                  </dl>

                  {isPending && (
                    <button
                      type="button"
                      onClick={() => handleCancelScheduled(item)}
                      className="mt-4 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 border border-red-200 text-xs font-medium rounded-md text-red-700 bg-white hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={closeModal}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div
              className={`px-6 py-4 border-b flex items-center justify-between ${
                modalMode === 'send'
                  ? 'bg-emerald-50 border-emerald-100'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <h3 className="text-lg font-semibold text-slate-800">
                {modalMode === 'send' ? 'Send Email Now' : 'Schedule Email'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  To
                </label>
                <input
                  type="email"
                  required
                  value={form.to}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, to: e.target.value }))
                  }
                  placeholder="student@example.com"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  value={form.subject}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, subject: e.target.value }))
                  }
                  placeholder="e.g. Assignment reminder"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Body
                </label>
                <textarea
                  rows={6}
                  required
                  value={form.body}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, body: e.target.value }))
                  }
                  placeholder="Write your message…"
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500 resize-y"
                />
              </div>

              {modalMode === 'schedule' && (
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Send at
                  </label>
                  <input
                    type="datetime-local"
                    required
                    min={minScheduleLocal()}
                    value={form.sendAt}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sendAt: e.target.value }))
                    }
                    className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-emerald-500 focus:ring-emerald-500"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Uses your local timezone. Must be in the future.
                  </p>
                </div>
              )}

              {saving && modalMode === 'send' && (
                <div className="flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3">
                  <Loader2 className="w-5 h-5 text-emerald-600 animate-spin flex-shrink-0" />
                  <p className="text-sm text-emerald-800">Sending email…</p>
                </div>
              )}

              {formError && (
                <p className="text-sm text-red-600 font-medium">{formError}</p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm disabled:opacity-70 min-w-[120px]"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {modalMode === 'send' ? 'Sending…' : 'Saving…'}
                    </>
                  ) : modalMode === 'send' ? (
                    <>
                      <Send className="w-4 h-4" />
                      Send
                    </>
                  ) : (
                    <>
                      <CalendarClock className="w-4 h-4" />
                      Schedule
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
