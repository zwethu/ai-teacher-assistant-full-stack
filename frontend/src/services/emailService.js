import api from '../lib/api.js'

/**
 * @param {{ to: string, subject: string, body: string }} payload
 */
export async function sendEmailNow(payload) {
  try {
    const { data } = await api.post('/email/send-now', {
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
    })
    return data
  } catch (err) {
    const detail = err.response?.data?.detail
    if (typeof detail === 'string') {
      throw new Error(detail)
    }
    if (Array.isArray(detail)) {
      throw new Error(detail.map((x) => x.msg || x).join(', '))
    }
    throw new Error(err.message || 'Failed to send email')
  }
}
