import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ToastMessage } from '../types'
import type { Email as EmailRecord } from '../entity/Email'
import type { Batch, BatchStudent } from '../entity/Batch'
import Toast from '../components/ui/Toast'
import axios from 'axios'
import { getErrorMessage } from '../utils/errors'

import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronRight,
  ExternalLink,
  Mail,
  Plus,
  Send,
  Trash2,
  Users,
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
  Timestamp,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import {
  checkGooglePermissions,
  startGoogleOAuth,
} from '../services/authService'
import { fromFirestore, toFirestore } from '../entity/Email'
import { sendEmailNow } from '../services/emailService'
import { listBatches, listBatchStudents } from '../services/batchService'
import { increaseStress } from '../services/wellnessService'
import { formatDateTime, timeAgo } from '../utils/formatDate'
import { Spinner, Button } from '../design-system'

const NOTES_PREVIEW_LEN = 120

/** Persisted so the batch survives the Google OAuth full-page redirect. */
const SELECTED_BATCH_KEY = 'email:selectedBatchId'

const INITIAL_FORM = {
  subject: '',
  body: '',
  sendAt: '',
}

function minScheduleLocal() {
  const d = new Date(Date.now() + 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function truncateText(text: string, max = NOTES_PREVIEW_LEN) {
  const t = (text || '').trim()
  if (!t) return 'No message preview'
  if (t.length <= max) return t
  return `${t.slice(0, max).trim()}…`
}

function statusBadgeClass(status: string) {
  if (status === 'sent') {
    return 'bg-violet-50 text-violet-700 border-violet-200'
  }
  return 'bg-amber-50 text-amber-800 border-amber-200'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(value: string) {
  return EMAIL_RE.test(value.trim())
}

export default function Email() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [emails, setEmails] = useState<EmailRecord[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [hasGoogleScopes, setHasGoogleScopes] = useState(false)
  const [permissionsLoading, setPermissionsLoading] = useState(true)

  // Batch ("space") selection gates the whole page.
  const [batches, setBatches] = useState<Batch[]>([])
  const [batchesLoading, setBatchesLoading] = useState(true)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(() =>
    sessionStorage.getItem(SELECTED_BATCH_KEY),
  )
  const [students, setStudents] = useState<BatchStudent[]>([])
  const [studentsLoading, setStudentsLoading] = useState(false)

  const [modalMode, setModalMode] = useState<'send' | 'schedule' | null>(null)
  const [form, setForm] = useState(INITIAL_FORM)
  const [recipients, setRecipients] = useState<string[]>([])
  const [recipientDraft, setRecipientDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  )

  function showToast(type: ToastMessage['type'], message: string) {
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

  // Load batches; drop a stale persisted selection that no longer exists.
  useEffect(() => {
    if (!user) return undefined
    let cancelled = false
    setBatchesLoading(true)
    listBatches()
      .then((data) => {
        if (cancelled) return
        setBatches(data)
        setSelectedBatchId((prev) =>
          prev && data.some((b) => b.id === prev) ? prev : null,
        )
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setBatchesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // Load the selected batch's students for the recipient picker.
  useEffect(() => {
    if (!selectedBatch) {
      setStudents([])
      return undefined
    }
    let cancelled = false
    setStudentsLoading(true)
    listBatchStudents(selectedBatch.id)
      .then((data) => {
        if (!cancelled) setStudents(data)
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setStudents([])
      })
      .finally(() => {
        if (!cancelled) setStudentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedBatch])

  useEffect(() => {
    const connected = searchParams.get('connected')
    if (connected === null) return

    if (connected === 'true') {
      showToast('success', 'Google account connected successfully.')
      refreshPermissions()
    } else {
      showToast('error', 'Could not connect Google account. Please try again.')
    }

    searchParams.delete('connected')
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
          snapshot.docs.map((d) => fromFirestore(d)).filter((d): d is EmailRecord => d !== null),
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

  function handleSelectBatch(batch: Batch) {
    setSelectedBatchId(batch.id)
    sessionStorage.setItem(SELECTED_BATCH_KEY, batch.id)
  }

  function handleChangeBatch() {
    setSelectedBatchId(null)
    sessionStorage.removeItem(SELECTED_BATCH_KEY)
  }

  function openSendModal() {
    setModalMode('send')
    setForm({ ...INITIAL_FORM })
    setRecipients([])
    setRecipientDraft('')
    setFormError('')
  }

  function openScheduleModal() {
    setModalMode('schedule')
    setForm({ ...INITIAL_FORM, sendAt: minScheduleLocal() })
    setRecipients([])
    setRecipientDraft('')
    setFormError('')
  }

  function closeModal() {
    if (saving) return
    setModalMode(null)
    setFormError('')
  }

  function addRecipient(email: string): boolean {
    const value = email.trim()
    if (!value) return false
    if (!isValidEmail(value)) {
      setFormError(`"${value}" is not a valid email address.`)
      return false
    }
    setRecipients((prev) =>
      prev.some((r) => r.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value],
    )
    setFormError('')
    return true
  }

  function removeRecipient(email: string) {
    setRecipients((prev) => prev.filter((r) => r !== email))
  }

  function addAllStudents() {
    const emails = students.map((s) => s.email).filter(isValidEmail)
    setRecipients((prev) => {
      const seen = new Set(prev.map((r) => r.toLowerCase()))
      const next = [...prev]
      for (const e of emails) {
        if (!seen.has(e.toLowerCase())) {
          seen.add(e.toLowerCase())
          next.push(e)
        }
      }
      return next
    })
    setFormError('')
  }

  function handleRecipientKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (addRecipient(recipientDraft)) setRecipientDraft('')
    } else if (e.key === 'Backspace' && !recipientDraft && recipients.length > 0) {
      removeRecipient(recipients[recipients.length - 1])
    }
  }

  async function handleConnectGoogle() {
    try {
      await startGoogleOAuth()
    } catch (err) {
      showToast('error', getErrorMessage(err, 'Could not start Google sign-in.'))
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user || !selectedBatch) return

    // Fold any half-typed recipient still sitting in the input into the list.
    const pending = recipientDraft.trim()
    let finalRecipients = recipients
    if (pending) {
      if (!isValidEmail(pending)) {
        setFormError(`"${pending}" is not a valid email address.`)
        return
      }
      if (!finalRecipients.some((r) => r.toLowerCase() === pending.toLowerCase())) {
        finalRecipients = [...finalRecipients, pending]
      }
    }

    if (finalRecipients.length === 0) {
      setFormError('Add at least one recipient.')
      return
    }

    setRecipients(finalRecipients)
    setRecipientDraft('')
    setSaving(true)
    setFormError('')

    const subject = form.subject.trim()
    const body = form.body.trim()
    const batchMeta = { batchId: selectedBatch.id, batchName: selectedBatch.batch_name }

    try {
      if (modalMode === 'send') {
        const { has_google_scopes: ok } = await checkGooglePermissions()
        if (!ok) {
          await startGoogleOAuth()
          return
        }

        // Send one message per recipient so the class roster is never exposed
        // in the To header (mirrors the backend's chat-email dispatch).
        const sent: string[] = []
        const failed: string[] = []
        for (const to of finalRecipients) {
          try {
            await sendEmailNow({ to, subject, body })
            sent.push(to)
          } catch (err) {
            console.error('Failed to send to', to, err)
            failed.push(to)
          }
        }

        if (sent.length === 0) {
          setFormError('Failed to send email. Please try again.')
          return
        }

        await addDoc(
          collection(db, 'emails'),
          toFirestore({
            uid: user.uid,
            to: sent.join(', '),
            recipients: sent,
            subject,
            body,
            status: 'sent',
            sentAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            ...batchMeta,
          }),
        )

        closeModal()
        showToast(
          'success',
          failed.length === 0
            ? `Email sent to ${sent.length} recipient${sent.length > 1 ? 's' : ''}.`
            : `Sent to ${sent.length}, but ${failed.length} failed. Check the addresses and retry.`,
        )
        increaseStress(user.uid, 3)
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

        await addDoc(collection(db, 'emails'), {
          ...toFirestore({
            uid: user.uid,
            to: finalRecipients.join(', '),
            // The send cron sends one message per entry in `recipients`.
            recipients: finalRecipients,
            subject,
            body,
            status: 'pending',
            sendAt: sendDate.toISOString(),
            createdAt: serverTimestamp(),
            ...batchMeta,
          }),
          // The send cron (check_and_send_emails) filters on send_at as a Firestore
          // Timestamp; the camelCase sendAt above is only for the card's display.
          send_at: Timestamp.fromDate(sendDate),
        })

        closeModal()
        showToast(
          'success',
          `Email scheduled for ${finalRecipients.length} recipient${finalRecipients.length > 1 ? 's' : ''}.`,
        )
        increaseStress(user.uid, 3)
      }
    } catch (err) {
      console.error(err)
      let message = getErrorMessage(err, '')
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail
        if (typeof detail === 'string') message = detail
        else if (Array.isArray(detail)) {
          message = detail.map((x: { msg?: string } | string) =>
            typeof x === 'string' ? x : x.msg || String(x),
          ).join(', ')
        }
      }
      if (!message) {
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

  async function handleCancelScheduled(item: EmailRecord) {
    if (!item.id) return
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
  const recipientKeys = useMemo(
    () => new Set(recipients.map((r) => r.toLowerCase())),
    [recipients],
  )

  return (
    <div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Mail className="w-6 h-6 text-violet-600" />
            Emails
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {selectedBatch
              ? 'Send messages now or schedule them for later.'
              : 'Choose a batch to start emailing your students.'}
          </p>
        </div>
        {selectedBatch && (
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={openScheduleModal}
              className="inline-flex items-center justify-center px-4 py-2 border border-violet-200 text-sm font-medium rounded-md text-violet-700 bg-violet-50 hover:bg-violet-100 shadow-sm transition-colors"
            >
              <CalendarClock className="w-4 h-4 mr-2" />
              Schedule Email
            </button>
            <Button type="button" onClick={openSendModal} className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500">
              <Send className="w-4 h-4 mr-2" />
              Send Now
            </Button>
          </div>
        )}
      </div>

      {!selectedBatch ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-10">
            <div className="text-center mb-8">
              <div className="h-14 w-14 mx-auto bg-violet-50 rounded-2xl flex items-center justify-center mb-4">
                <Users className="w-7 h-7 text-violet-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-800">
                Which batch are you emailing?
              </h2>
              <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
                Pick a batch first. You can then add its students as recipients in
                one click.
              </p>
            </div>

            {batchesLoading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <Spinner size={28} />
                <p className="text-sm text-slate-500">Loading your batches…</p>
              </div>
            ) : batches.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-sm text-slate-500 mb-5 max-w-sm">
                  You don't have any batches yet. Create one to add students and
                  start emailing.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/batches')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md text-white bg-violet-600 hover:bg-violet-700 shadow-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  Go to Batches
                </button>
              </div>
            ) : (
              <div className="max-w-md mx-auto space-y-2">
                {batches.map((batch) => (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => handleSelectBatch(batch)}
                    className="w-full flex items-center gap-3 p-4 rounded-xl border border-slate-100 hover:border-violet-200 hover:bg-violet-50/40 transition-all text-left"
                  >
                    <div className="h-10 w-10 rounded-lg bg-slate-50 flex items-center justify-center flex-shrink-0">
                      <Users className="w-5 h-5 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">
                        {batch.batch_name}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {batch.course_name}
                        {batch.academic_year ? ` · ${batch.academic_year}` : ''}
                        {` · ${batch.student_count} student${batch.student_count === 1 ? '' : 's'}`}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-white border border-violet-100 flex items-center justify-center flex-shrink-0">
                <Users className="w-4.5 h-4.5 text-violet-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Emailing batch</p>
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {selectedBatch.batch_name}
                  <span className="font-normal text-slate-400">
                    {' · '}
                    {selectedBatch.course_name}
                    {` · ${selectedBatch.student_count} student${selectedBatch.student_count === 1 ? '' : 's'}`}
                  </span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleChangeBatch}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-violet-200 text-violet-700 bg-white hover:bg-violet-50 shrink-0 self-start sm:self-auto"
            >
              Change batch
            </button>
          </div>

          {showGoogleBanner && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-start gap-3 flex-1">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-900">
                  Connect your Google account to send emails
                </p>
              </div>
              <Button type="button" onClick={handleConnectGoogle} className="shrink-0">
                Connect Google
              </Button>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            {listLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Spinner size={32} />
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
                  <Button type="button" onClick={openSendModal}>
                    <Send className="w-4 h-4 mr-2" />
                    Send Now
                  </Button>
                  <button
                    type="button"
                    onClick={openScheduleModal}
                    className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100"
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
                  const recipientCount = item.recipients?.length ?? 0
                  return (
                    <article
                      key={item.id}
                      className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-violet-200/80 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-500 truncate">To</p>
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {item.to || '—'}
                          </p>
                          {recipientCount > 1 && (
                            <p className="text-xs text-slate-400">
                              {recipientCount} recipients
                            </p>
                          )}
                        </div>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${statusBadgeClass(item.status)}`}
                        >
                          {item.status === 'sent' ? 'Sent' : 'Pending'}
                        </span>
                      </div>

                      {item.batchName && (
                        <span className="inline-flex items-center gap-1 mb-2 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-50 text-slate-600 border border-slate-100">
                          <Users className="w-3 h-3" />
                          {item.batchName}
                        </span>
                      )}

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
        </>
      )}

      {modalMode && selectedBatch && (
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
                  ? 'bg-violet-50 border-violet-100'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-slate-800">
                  {modalMode === 'send' ? 'Send Email Now' : 'Schedule Email'}
                </h3>
                <p className="text-xs text-slate-500 truncate">
                  {selectedBatch.batch_name}
                </p>
              </div>
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
                  Recipients
                </label>
                <div className="flex flex-wrap gap-1.5 rounded-md border border-slate-300 px-2 py-2 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500">
                  {recipients.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 pl-2.5 pr-1 py-0.5 text-xs font-medium text-violet-700"
                    >
                      {r}
                      <button
                        type="button"
                        onClick={() => removeRecipient(r)}
                        className="p-0.5 rounded-full hover:bg-violet-100 text-violet-500 hover:text-violet-700"
                        aria-label={`Remove ${r}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    inputMode="email"
                    value={recipientDraft}
                    onChange={(e) => setRecipientDraft(e.target.value)}
                    onKeyDown={handleRecipientKeyDown}
                    onBlur={() => {
                      if (recipientDraft.trim() && addRecipient(recipientDraft)) {
                        setRecipientDraft('')
                      }
                    }}
                    placeholder={
                      recipients.length ? 'Add another…' : 'student@example.com'
                    }
                    className="flex-1 min-w-[140px] border-0 p-1 text-sm focus:ring-0 focus:outline-none"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Press Enter or comma to add. Each recipient gets their own copy.
                </p>

                {studentsLoading ? (
                  <p className="text-xs text-slate-400 mt-2 flex items-center gap-1.5">
                    <Spinner size={14} />
                    Loading batch students…
                  </p>
                ) : students.length > 0 ? (
                  <div className="mt-2 rounded-md border border-slate-100 bg-slate-50/60">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100">
                      <p className="text-xs font-medium text-slate-500">
                        Batch students ({students.length})
                      </p>
                      <button
                        type="button"
                        onClick={addAllStudents}
                        className="text-xs font-semibold text-violet-700 hover:text-violet-800"
                      >
                        Add all
                      </button>
                    </div>
                    <div className="max-h-32 overflow-y-auto divide-y divide-slate-100">
                      {students.map((s) => {
                        const added = recipientKeys.has(s.email.toLowerCase())
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={added}
                            onClick={() => addRecipient(s.email)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-white disabled:cursor-default"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-slate-700 truncate">
                                {s.name || s.email}
                              </div>
                              {s.name && (
                                <div className="text-[11px] text-slate-400 truncate">
                                  {s.email}
                                </div>
                              )}
                            </div>
                            {added ? (
                              <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            ) : (
                              <Plus className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-2">
                    This batch has no students yet — add recipients manually above.
                  </p>
                )}
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
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-violet-500 focus:ring-violet-500"
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
                  className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-violet-500 focus:ring-violet-500 resize-y"
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
                    className="block w-full rounded-md border border-slate-300 shadow-sm py-2.5 px-3 text-sm focus:border-violet-500 focus:ring-violet-500"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Uses your local timezone. Must be in the future.
                  </p>
                </div>
              )}

              {saving && modalMode === 'send' && (
                <div className="flex items-center gap-3 rounded-lg bg-violet-50 border border-violet-100 px-4 py-3">
                  <Spinner size={20} className="flex-shrink-0" />
                  <p className="text-sm text-violet-800">Sending email…</p>
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
                <Button type="submit" disabled={saving} className="min-w-[120px]">
                  {saving ? (
                    <>
                      <Spinner tone="inverse" size={16} />
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
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
