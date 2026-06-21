import api from '../lib/api'
import { checkGoogleAuthStatus } from './authService'

export type AgentConnectors = {
  web_search: boolean
  google_workspace: boolean
}

export type AgentInvokePayload = {
  message: string
  batch_id: string
  chat_id?: string
  workflow_type?: string
  week?: number
  save_draft?: boolean
  connectors?: AgentConnectors
}

async function invokeAgent(
  payload: AgentInvokePayload | Record<string, unknown>,
): Promise<unknown> {
  const connectors =
    (payload as AgentInvokePayload).connectors ?? (await getDefaultConnectors())
  const { data } = await api.post('/agent/invoke', {
    ...payload,
    connectors,
  })
  return data
}

async function getDefaultConnectors(): Promise<AgentConnectors> {
  try {
    const status = await checkGoogleAuthStatus()
    return {
      web_search: true,
      google_workspace: status.valid && status.has_google_scopes,
    }
  } catch (err) {
    console.error(err)
    return {
      web_search: true,
      google_workspace: false,
    }
  }
}

export async function generateAssessment(
  _token: string,
  payload: AgentInvokePayload | Record<string, unknown>,
) {
  return invokeAgent(payload)
}

export async function generateLessonPlan(
  _token: string,
  payload: AgentInvokePayload | Record<string, unknown>,
) {
  return invokeAgent(payload)
}

export async function generateBatchContent(
  _token: string,
  payload: AgentInvokePayload | Record<string, unknown>,
) {
  return invokeAgent(payload)
}
