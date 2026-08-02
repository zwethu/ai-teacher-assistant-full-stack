import axios from 'axios'
import api from '../lib/api'
import { invokeAgent } from './agentService'
import { subscribeAgentRun } from './agentRunStream'

interface SendEmailPayload {
  to: string
  subject: string
  body: string
}

interface GenerateEmailPayload {
  batchId: string
  recipients: string[]
  prompt: string
}

export interface AgentEmailDraft {
  subject: string
  body: string
}

/** Agent runs are minutes-scale at worst; past this we assume the run is stuck. */
const DRAFT_TIMEOUT_MS = 180_000
/** The final message node can land moments after status flips to done. */
const DONE_GRACE_MS = 5_000

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

/**
 * Draft an email through the same agent run contract the chat page uses: invoke
 * the email workflow, then read the staged draft off the run's RTDB message
 * metadata. The backend reuses one hidden "email" workflow chat per batch, so
 * successive drafts share session state and a tweaked prompt is treated by the
 * agent as a revision of the previous draft rather than a from-scratch rewrite.
 */
export async function generateEmailDraft(
  payload: GenerateEmailPayload,
): Promise<AgentEmailDraft> {
  const message = [
    `Draft an email to these students: ${payload.recipients.join(', ')}.`,
    `What the email should say: ${payload.prompt}`,
  ].join('\n')

  let runId = ''
  try {
    const invoked = (await invokeAgent({
      message,
      batch_id: payload.batchId,
      workflow_type: 'email',
    })) as { run_id?: string }
    runId = String(invoked?.run_id || '')
  } catch (err) {
    throw detailFromAxios(err, 'Failed to draft email')
  }
  if (!runId) throw new Error('Failed to draft email')
  return waitForStagedEmail(runId)
}

function waitForStagedEmail(runId: string): Promise<AgentEmailDraft> {
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe: () => void = () => undefined
    const timers: number[] = []
    const finish = (outcome: () => void) => {
      if (settled) return
      settled = true
      timers.forEach((timer) => window.clearTimeout(timer))
      unsubscribe()
      outcome()
    }
    const fail = (message: string) => finish(() => reject(new Error(message)))

    unsubscribe = subscribeAgentRun(runId, {
      onMessage: (msg) => {
        const meta = msg.metadata || {}
        const subject = String(meta.email_subject || '').trim()
        const body = String(meta.email_body || '').trim()
        if (msg.role === 'assistant' && subject && body) {
          finish(() => resolve({ subject, body }))
        }
      },
      onStatus: (status) => {
        if (status === 'failed' || status === 'cancelled') {
          fail('Email drafting failed. Please try again.')
        } else if (status === 'done') {
          timers.push(
            window.setTimeout(
              () =>
                fail(
                  'The assistant finished without staging an email draft. Please try again.',
                ),
              DONE_GRACE_MS,
            ),
          )
        }
      },
      onRunError: (message) => fail(message || 'Email drafting failed.'),
      onError: () =>
        fail('Lost the live connection while drafting. Please try again.'),
    })

    timers.push(
      window.setTimeout(
        () => fail('Timed out waiting for the email draft.'),
        DRAFT_TIMEOUT_MS,
      ),
    )
  })
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
