const AGENT_ENGINE_URL = import.meta.env.VITE_AGENT_ENGINE_URL

/**
 * @param {string} token Firebase ID token
 * @param {Record<string, unknown>} payload
 */
async function postAgentEngine(token, payload) {
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

  let body = null
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

export async function generateAssessment(token, payload) {
  return postAgentEngine(token, payload)
}

export async function generateLessonPlan(token, payload) {
  return postAgentEngine(token, payload)
}

export async function generateBatchContent(token, payload) {
  return postAgentEngine(token, payload)
}
