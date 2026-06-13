import axios from 'axios'
import api from '../lib/api'

interface SendEmailPayload {
  to: string
  subject: string
  body: string
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
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') {
        throw new Error(detail)
      }
      if (Array.isArray(detail)) {
        throw new Error(detail.map((x: { msg?: string } | string) =>
          typeof x === 'string' ? x : x.msg || String(x),
        ).join(', '))
      }
    }
    throw new Error(err instanceof Error ? err.message : 'Failed to send email')
  }
}
