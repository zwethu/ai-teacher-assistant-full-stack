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
  Pencil,
  Plus,
  Save,
  Send,
  Sparkles,
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
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { checkGooglePermissions, startGoogleOAuth } from '../services/authService'
import { fromFirestore, toFirestore } from '../entity/Email'
import {
  generateEmailDraft,
  saveEmailDraft,
  sendEmailNow,
  sendSavedDraft,
} from '../services/emailService'
import { listBatches, listBatchStudents } from '../services/batchService'
import { increaseStress } from '../services/wellnessService'
import { formatDateTime, timeAgo, toDate } from '../utils/formatDate'
import { Spinner, Button } from '../design-system'
import { FIELD_CLASS, TEXTAREA_CLASS } from '../components/ui/fieldStyles'
import { DateField } from '../components/ui/DateField'

const NOTES_PREVIEW_LEN = 120

/** Persisted so the batch survives the Google OAuth full-page redirect. */
const SELECTED_BATCH_KEY = 'email:selectedBatchId'

const INITIAL_FORM = {
  prompt: '',
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

const STATUS_META = {
  sent: {
    label: 'Sent',
    icon: Send,
    chip: 'bg-violet-50 text-violet-700 ring-violet-200',
    avatar: 'bg-violet-50 text-violet-600',
  },
  draft: {
    label: 'Draft',
    icon: Pencil,
    chip: 'bg-sky-50 text-sky-700 ring-sky-200',
    avatar: 'bg-sky-50 text-sky-600',
  },
  pending: {
    label: 'Scheduled',
    icon: CalendarClock,
    chip: 'bg-amber-50 text-amber-800 ring-amber-200',
    avatar: 'bg-amber-50 text-amber-600',
  },
} as const

function statusMeta(status: string) {
  return STATUS_META[status as keyof typeof STATUS_META] ?? STATUS_META.pending
}

type StatusTab = 'all' | 'draft' | 'pending' | 'sent'

const TABS: { id: StatusTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'pending', label: 'Scheduled' },
  { id: 'sent', label: 'Sent' },
]

const EMPTY_TAB_COPY: Record<Exclude<StatusTab, 'all'>, string> = {
  draft: 'Drafts you save to Gmail will show up here.',
  pending: 'Emails scheduled for later will show up here.',
  sent: 'Emails you have already sent will show up here.',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(value: string) {
  return EMAIL_RE.test(value.trim())
}

/**
 * Newest first. A `serverTimestamp()` reads back as null until the write is
 * acked, so an email saved a second ago would otherwise sort to the very bottom
 * (nulls order lowest) and look like it never appeared.
 */
function emailSortTime(item: EmailRecord): number {
  const created = toDate(item.createdAt)
  if (created) return created.getTime()
  const fallback = toDate(item.sentAt) ?? toDate(item.sendAt)
  return fallback ? fallback.getTime() : Date.now()
}

export default function Email() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [emails, setEmails] = useState<EmailRecord[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [detailError, setDetailError] = useState('')
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
  // 'compose' collects recipients + the AI prompt; 'review' edits the generated draft.
  const [step, setStep] = useState<'compose' | 'review'>('compose')
  const [form, setForm] = useState(INITIAL_FORM)
  const [recipients, setRecipients] = useState<string[]>([])
  const [recipientDraft, setRecipientDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
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
    setListError('')
    // Deliberately no orderBy: it needs a composite index this project does not
    // declare, and it drops any email doc that lacks the sort field entirely.
    const q = query(collection(db, 'emails'), where('uid', '==', user.uid))

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setEmails(
          snapshot.docs
            .map((d) => fromFirestore(d))
            .filter((d): d is EmailRecord => d !== null)
            .sort((a, b) => emailSortTime(b) - emailSortTime(a)),
        )
        setListLoading(false)
      },
      (err) => {
        console.error('Failed to load emails:', err)
        setListError(getErrorMessage(err, 'Could not load your email history.'))
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
    setStep('compose')
    setForm({ ...INITIAL_FORM })
    setRecipients([])
    setRecipientDraft('')
    setFormError('')
  }

  function openScheduleModal() {
    setModalMode('schedule')
    setStep('compose')
    setForm({ ...INITIAL_FORM, sendAt: minScheduleLocal() })
    setRecipients([])
    setRecipientDraft('')
    setFormError('')
  }

  function closeModal() {
    if (saving || generating) return
    setModalMode(null)
    setStep('compose')
    setFormError('')
  }

  /** Fold any half-typed recipient into the list; null means validation failed. */
  function resolveRecipients(): string[] | null {
    const pending = recipientDraft.trim()
    let finalRecipients = recipients
    if (pending) {
      if (!isValidEmail(pending)) {
        setFormError(`"${pending}" is not a valid email address.`)
        return null
      }
      if (!finalRecipients.some((r) => r.toLowerCase() === pending.toLowerCase())) {
        finalRecipients = [...finalRecipients, pending]
      }
    }

    if (finalRecipients.length === 0) {
      setFormError('Add at least one recipient.')
      return null
    }

    setRecipients(finalRecipients)
    setRecipientDraft('')
    return finalRecipients
  }

  async function handleGenerateAi() {
    if (!selectedBatch) return

    const finalRecipients = resolveRecipients()
    if (!finalRecipients) return

    const prompt = form.prompt.trim()
    if (!prompt) {
      setFormError('Describe what the email should say, then draft with AI.')
      return
    }

    setGenerating(true)
    setFormError('')
    try {
      const draft = await generateEmailDraft({
        batchId: selectedBatch.id,
        recipients: finalRecipients,
        prompt,
      })
      setForm((f) => ({ ...f, subject: draft.subject, body: draft.body }))
      setStep('review')
    } catch (err) {
      console.error(err)
      setFormError(getErrorMessage(err, 'Failed to draft email with AI.'))
    } finally {
      setGenerating(false)
    }
  }

  async function handleSaveAsDraft() {
    if (!user || !selectedBatch || !modalMode) return

    const finalRecipients = resolveRecipients()
    if (!finalRecipients) return

    const subject = form.subject.trim()
    const body = form.body.trim()
    if (!subject || !body) {
      setFormError('Subject and body are required.')
      return
    }

    setSaving(true)
    setFormError('')

    try {
      const { has_google_scopes: ok } = await checkGooglePermissions()
      if (!ok) {
        await startGoogleOAuth()
        return
      }

      const saved: string[] = []
      const failed: string[] = []
      const draftIds: string[] = []
      for (const to of finalRecipients) {
        try {
          const res = await saveEmailDraft({ to, subject, body })
          saved.push(to)
          if (res?.draft_id) draftIds.push(res.draft_id)
        } catch (err) {
          console.error('Failed to draft for', to, err)
          failed.push(to)
        }
      }

      if (saved.length === 0) {
        setFormError('Failed to save draft. Please try again.')
        return
      }

      await addDoc(
        collection(db, 'emails'),
        toFirestore({
          uid: user.uid,
          to: saved.join(', '),
          recipients: saved,
          draftIds,
          subject,
          body,
          status: 'draft',
          createdAt: serverTimestamp(),
          batchId: selectedBatch.id,
          batchName: selectedBatch.batch_name,
        }),
      )

      setModalMode(null)
      setStep('compose')
      showToast(
        'success',
        failed.length === 0
          ? `Draft saved for ${saved.length} recipient${saved.length > 1 ? 's' : ''}.`
          : `Saved ${saved.length} draft(s), but ${failed.length} failed.`,
      )
    } catch (err) {
      console.error(err)
      setFormError(getErrorMessage(err, 'Failed to save draft.'))
    } finally {
      setSaving(false)
    }
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

    if (step === 'compose') {
      await handleGenerateAi()
      return
    }

    const finalRecipients = resolveRecipients()
    if (!finalRecipients) return

    const subject = form.subject.trim()
    const body = form.body.trim()
    if (!subject || !body) {
      setFormError('Subject and body are required.')
      return
    }

    setSaving(true)
    setFormError('')
    const batchMeta = {
      batchId: selectedBatch.id,
      batchName: selectedBatch.batch_name,
    }

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
          message = detail
            .map((x: { msg?: string } | string) =>
              typeof x === 'string' ? x : x.msg || String(x),
            )
            .join(', ')
        }
      }
      if (!message) {
        message =
          modalMode === 'send' ? 'Failed to send email.' : 'Failed to schedule email.'
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
      setSelectedId((id) => (id === item.id ? null : id))
      showToast('success', 'Scheduled email cancelled.')
    } catch (err) {
      console.error(err)
      showToast('error', 'Failed to cancel scheduled email.')
    }
  }

  function openDetail(item: EmailRecord) {
    setSelectedId(item.id ?? null)
    setDetailError('')
  }

  function closeDetail() {
    if (detailBusy) return
    setSelectedId(null)
    setDetailError('')
  }

  /** Send a saved draft or a scheduled email right now. */
  async function handleSendFromDetail(item: EmailRecord) {
    if (!item.id || !user) return
    const recipients = item.recipients?.length
      ? item.recipients
      : item.to
        ? [item.to]
        : []
    if (recipients.length === 0) {
      setDetailError('This email has no recipients.')
      return
    }

    setDetailBusy(true)
    setDetailError('')
    try {
      const { has_google_scopes: ok } = await checkGooglePermissions()
      if (!ok) {
        await startGoogleOAuth()
        return
      }

      // Sending the stored Gmail drafts also clears them from the Drafts
      // folder; only fall back to a fresh send when we have no draft ids.
      const draftIds = item.draftIds ?? []
      let sent = 0
      if (draftIds.length > 0) {
        for (const draftId of draftIds) {
          try {
            await sendSavedDraft(draftId)
            sent += 1
          } catch (err) {
            console.error('Failed to send draft', draftId, err)
          }
        }
      } else {
        for (const to of recipients) {
          try {
            await sendEmailNow({ to, subject: item.subject, body: item.body })
            sent += 1
          } catch (err) {
            console.error('Failed to send to', to, err)
          }
        }
      }

      if (sent === 0) {
        setDetailError('Failed to send. Please try again.')
        return
      }

      // Flipping status off "pending" is also what stops the send cron from
      // delivering a scheduled email a second time.
      await updateDoc(doc(db, 'emails', item.id), {
        status: 'sent',
        sentAt: serverTimestamp(),
        sent_at: serverTimestamp(),
        draftIds: [],
      })

      setSelectedId(null)
      showToast(
        'success',
        sent === recipients.length
          ? `Email sent to ${sent} recipient${sent === 1 ? '' : 's'}.`
          : `Sent to ${sent} of ${recipients.length} recipients.`,
      )
      increaseStress(user.uid, 3)
    } catch (err) {
      console.error(err)
      setDetailError(getErrorMessage(err, 'Failed to send email.'))
    } finally {
      setDetailBusy(false)
    }
  }

  const showGoogleBanner = !permissionsLoading && !hasGoogleScopes
  const recipientKeys = useMemo(
    () => new Set(recipients.map((r) => r.toLowerCase())),
    [recipients],
  )

  const tabCounts = useMemo(() => {
    const counts = { all: emails.length, draft: 0, pending: 0, sent: 0 }
    for (const item of emails) {
      if (item.status in counts) counts[item.status as StatusTab] += 1
    }
    return counts
  }, [emails])

  const visibleEmails = useMemo(
    () => (tab === 'all' ? emails : emails.filter((item) => item.status === tab)),
    [emails, tab],
  )

  // Derived from the live list, so the open detail reflects snapshot updates.
  const selected = useMemo(
    () => emails.find((item) => item.id === selectedId) ?? null,
    [emails, selectedId],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Mail className="w-6 h-6 text-violet-600" />
            Emails
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {selectedBatch
              ? 'Draft with AI, then save, send, or schedule.'
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
            <Button
              type="button"
              onClick={openSendModal}
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-violet-500"
            >
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
                Pick a batch first. You can then add its students as recipients in one
                click.
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
                  You don't have any batches yet. Create one to add students and start
                  emailing.
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
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3">
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
            <div className="shrink-0 mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
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

          {/* The card owns the remaining height so the tabs stay put and only
              the message list scrolls, keeping its scrollbar inside the panel. */}
          <div className="flex min-h-0 flex-1 flex-col bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="shrink-0 flex items-center gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2">
              {TABS.map(({ id, label }) => {
                const active = tab === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-violet-50 text-violet-700'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                    }`}
                  >
                    {label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                        active
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {tabCounts[id]}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {listLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Spinner size={32} />
                  <p className="text-sm text-slate-500">Loading emails…</p>
                </div>
              ) : listError ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
                    <AlertTriangle className="h-7 w-7 text-red-500" />
                  </div>
                  <h3 className="text-sm font-medium text-slate-900">
                    Couldn't load your email history
                  </h3>
                  <p className="mt-1 max-w-sm text-sm text-slate-500">{listError}</p>
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
              ) : visibleEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50">
                    <Mail className="h-7 w-7 text-slate-300" />
                  </div>
                  <p className="max-w-sm text-sm text-slate-500">
                    {EMPTY_TAB_COPY[tab as Exclude<StatusTab, 'all'>]}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {visibleEmails.map((item) => {
                    const isPending = item.status === 'pending'
                    const recipientCount = item.recipients?.length ?? 0
                    const meta = statusMeta(item.status)
                    const StatusIcon = meta.icon
                    const timing = isPending
                      ? `Sends ${formatDateTime(item.sendAt)}`
                      : item.status === 'draft'
                        ? 'In Gmail drafts'
                        : `Sent ${formatDateTime(item.sentAt)}`
                    return (
                      <li
                        key={item.id}
                        className="group relative flex items-start gap-4 px-5 py-4 transition-colors hover:bg-slate-50/70"
                      >
                        {/* Full-row hit area, kept a sibling of the Cancel button
                          so the two never nest. */}
                        <button
                          type="button"
                          onClick={() => openDetail(item)}
                          aria-label={`Open email: ${item.subject || 'No subject'}`}
                          className="absolute inset-0 rounded-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
                        />
                        <span
                          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.avatar}`}
                        >
                          <StatusIcon className="h-4.5 w-4.5" />
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-3">
                            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                              {item.subject || 'No subject'}
                            </h3>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.chip}`}
                            >
                              {meta.label}
                            </span>
                          </div>

                          <p className="mt-1 truncate text-sm text-slate-500">
                            {truncateText(item.body)}
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <Users className="h-3.5 w-3.5" />
                              {recipientCount > 1
                                ? `${recipientCount} recipients`
                                : item.to || '—'}
                            </span>
                            {item.batchName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">{item.batchName}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span>{timing}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {item.createdAt ? timeAgo(item.createdAt) : 'Just now'}
                            </span>
                          </div>
                        </div>

                        {isPending && (
                          <button
                            type="button"
                            onClick={() => handleCancelScheduled(item)}
                            className="relative z-10 mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 opacity-0 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Cancel
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
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
                  {step === 'compose'
                    ? 'Compose with AI'
                    : modalMode === 'send'
                      ? 'Review & Send'
                      : 'Review & Schedule'}
                </h3>
                <p className="text-xs text-slate-500 truncate">
                  {step === 'compose'
                    ? selectedBatch.batch_name
                    : `${recipients.length} recipient${recipients.length === 1 ? '' : 's'} · ${selectedBatch.batch_name}`}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving || generating}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-200"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {step === 'compose' ? (
                <>
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
                      What should this email say?
                    </label>
                    <textarea
                      rows={4}
                      required
                      autoFocus
                      value={form.prompt}
                      onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                      disabled={generating}
                      placeholder="e.g. Remind students about Friday's quiz and my office hours on Thursday…"
                      className={TEXTAREA_CLASS}
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      AI writes the subject and body — you review and edit them next.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-md border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-slate-500">
                        To {recipients.length} recipient
                        {recipients.length === 1 ? '' : 's'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setStep('compose')
                          setFormError('')
                        }}
                        disabled={saving}
                        className="text-xs font-semibold text-violet-700 hover:text-violet-800 disabled:opacity-60"
                      >
                        Change
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                      {recipients.join(', ')}
                    </p>
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
                      disabled={saving || generating}
                      className={FIELD_CLASS}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Body
                    </label>
                    <textarea
                      rows={10}
                      required
                      value={form.body}
                      onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                      disabled={saving || generating}
                      className={TEXTAREA_CLASS}
                    />
                  </div>

                  {modalMode === 'schedule' && (
                    <div>
                      <DateField
                        label="Send at"
                        withTime
                        required
                        min={minScheduleLocal()}
                        value={form.sendAt}
                        onChange={(sendAt) => setForm((f) => ({ ...f, sendAt }))}
                      />
                      <p className="text-xs text-slate-500 mt-1">
                        Uses your local timezone. Must be in the future.
                      </p>
                    </div>
                  )}
                </>
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

              {step === 'compose' ? (
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={generating}
                    className="px-4 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <Button type="submit" disabled={generating} className="min-w-[150px]">
                    {generating ? (
                      <>
                        <Spinner tone="inverse" size={16} />
                        Drafting…
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Generate draft
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => void handleGenerateAi()}
                    disabled={saving || generating}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60 mr-auto"
                  >
                    {generating ? (
                      <Spinner size={16} />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {generating ? 'Regenerating…' : 'Regenerate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveAsDraft()}
                    disabled={saving || generating}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-60"
                  >
                    {saving ? <Spinner size={16} /> : <Save className="w-4 h-4" />}
                    Save as draft
                  </button>
                  <Button
                    type="submit"
                    disabled={saving || generating}
                    className="min-w-[120px]"
                  >
                    {saving ? (
                      <>
                        <Spinner tone="inverse" size={16} />
                        {modalMode === 'send' ? 'Sending…' : 'Saving…'}
                      </>
                    ) : modalMode === 'send' ? (
                      <>
                        <Send className="w-4 h-4" />
                        Send now
                      </>
                    ) : (
                      <>
                        <CalendarClock className="w-4 h-4" />
                        Schedule
                      </>
                    )}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={closeDetail}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selected.subject || 'Email'}
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
              <div className="min-w-0">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusMeta(selected.status).chip}`}
                >
                  {statusMeta(selected.status).label}
                </span>
                <h3 className="mt-1.5 text-lg font-semibold text-slate-800">
                  {selected.subject || 'No subject'}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                disabled={detailBusy}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-60"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <dl className="mb-4 space-y-2 text-sm">
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-slate-400">To</dt>
                  <dd className="min-w-0 flex-1 text-slate-700">
                    {(selected.recipients?.length
                      ? selected.recipients
                      : [selected.to || '—']
                    ).join(', ')}
                  </dd>
                </div>
                {selected.batchName && (
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-slate-400">Batch</dt>
                    <dd className="min-w-0 flex-1 text-slate-700">
                      {selected.batchName}
                    </dd>
                  </div>
                )}
                <div className="flex gap-3">
                  <dt className="w-20 shrink-0 text-slate-400">
                    {selected.status === 'pending'
                      ? 'Sends'
                      : selected.status === 'draft'
                        ? 'Saved'
                        : 'Sent'}
                  </dt>
                  <dd className="min-w-0 flex-1 text-slate-700">
                    {selected.status === 'pending'
                      ? formatDateTime(selected.sendAt)
                      : selected.status === 'draft'
                        ? 'In your Gmail drafts'
                        : formatDateTime(selected.sentAt)}
                  </dd>
                </div>
              </dl>

              <div className="whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50/60 p-4 text-sm leading-relaxed text-slate-700">
                {selected.body || 'No message body.'}
              </div>

              {detailError && (
                <p className="mt-3 text-sm font-medium text-red-600">{detailError}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">
              {selected.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => handleCancelScheduled(selected)}
                  disabled={detailBusy}
                  className="mr-auto inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  Cancel schedule
                </button>
              )}
              <button
                type="button"
                onClick={closeDetail}
                disabled={detailBusy}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Close
              </button>
              {selected.status !== 'sent' && (
                <Button
                  type="button"
                  onClick={() => void handleSendFromDetail(selected)}
                  disabled={detailBusy}
                  className="min-w-[120px]"
                >
                  {detailBusy ? (
                    <>
                      <Spinner tone="inverse" size={16} />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Send now
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
