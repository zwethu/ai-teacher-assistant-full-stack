import api from '../lib/api'

export type AgentConnectors = {
  web_search: boolean
}

export type AgentInvokePayload = {
  message: string
  batch_id: string
  chat_id?: string
  workflow_type?: string
  week?: number
  save_draft?: boolean
  pending_artifact?: boolean
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
  return { web_search: true }
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

export async function generateLab(
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
