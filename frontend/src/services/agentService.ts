const AGENT_ENGINE_URL = import.meta.env.VITE_AGENT_ENGINE_URL

async function postAgentEngine(
  token: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (!AGENT_ENGINE_URL) {
    throw new Error(
      'Agent Engine URL is not configured. Set VITE_AGENT_ENGINE_URL in your environment.',
    )
  }

  const response = await fetch(AGENT_ENGINE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  let body: Record<string, unknown> | null = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      (body && (body.detail || body.error || body.message)) ||
      `Agent request failed (${response.status})`
    throw new Error(
      typeof message === 'string' ? message : JSON.stringify(message),
    )
  }

  return body
}

export async function generateAssessment(
  token: string,
  payload: Record<string, unknown>,
) {
  return postAgentEngine(token, payload)
}

export async function generateLessonPlan(
  token: string,
  payload: Record<string, unknown>,
) {
  return postAgentEngine(token, payload)
}

export async function generateBatchContent(
  token: string,
  payload: Record<string, unknown>,
) {
  return postAgentEngine(token, payload)
}
