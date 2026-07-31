import axios from 'axios'
import api from '../lib/api'

interface SendEmailPayload {
  to: string
  subject: string
  body: string
}

interface GenerateEmailPayload {
  prompt: string
  batch_name?: string
  course_name?: string
}

function detailFromAxios(err: unknown, fallback: string): Error {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail
    if (typeof detail === 'string') {
      return new Error(detail)
    }
    if (Array.isArray(detail)) {
      return new Error(
        detail
          .map((x: { msg?: string } | string) =>
            typeof x === 'string' ? x : x.msg || String(x),
          )
          .join(', '),
      )
    }
  }
  return new Error(err instanceof Error ? err.message : fallback)
}

export async function generateEmailDraft(payload: GenerateEmailPayload) {
  try {
    const { data } = await api.post<{ subject: string; body: string }>('/email/generate', {
      prompt: payload.prompt,
      batch_name: payload.batch_name || '',
      course_name: payload.course_name || '',
    })
    return data
  } catch (err) {
    throw detailFromAxios(err, 'Failed to draft email')
  }
}

export async function saveEmailDraft(payload: SendEmailPayload) {
  try {
    const { data } = await api.post<{ success: boolean; draft_id: string }>(
      '/email/save-draft',
      {
        to: payload.to,
        subject: payload.subject,
        body: payload.body,
      },
    )
    return data
  } catch (err) {
    throw detailFromAxios(err, 'Failed to save draft')
  }
}

/** Sends an existing Gmail draft, which also clears it from the Drafts folder. */
export async function sendSavedDraft(draftId: string) {
  try {
    const { data } = await api.post('/email/send-draft', { draft_id: draftId })
    return data
  } catch (err) {
    throw detailFromAxios(err, 'Failed to send draft')
  }
}

export async function sendEmailNow(payload: SendEmailPayload) {
  try {
    const { data } = await api.post('/email/send-now', {
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
    })
    return data
  } catch (err) {
    throw detailFromAxios(err, 'Failed to send email')
  }
}
