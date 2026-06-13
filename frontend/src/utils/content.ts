type ContentRecord = Record<string, unknown>

function asRecord(value: unknown): ContentRecord | null {
  if (typeof value === 'object' && value !== null) return value as ContentRecord
  return null
}

export function formatAssessmentContent(content: unknown): string {
  if (!content) return 'No content available.'

  if (typeof content === 'string') {
    try {
      return formatAssessmentContent(JSON.parse(content))
    } catch {
      return content
    }
  }

  const obj = asRecord(content)
  if (!obj) return JSON.stringify(content, null, 2)

  if (typeof obj.markdown === 'string') return obj.markdown

  if (Array.isArray(obj.questions)) {
    return obj.questions
      .map((q, i) => {
        const question = asRecord(q)
        const opts = Array.isArray(question?.options)
          ? question.options.map((o) => `  - ${String(o)}`).join('\n')
          : ''
        const text = question?.question ?? question?.text ?? 'Question'
        const answer = question?.answer ? `Answer: ${String(question.answer)}` : ''
        return `${i + 1}. ${String(text)}\n${opts}\n${answer}`
      })
      .join('\n\n')
  }

  return JSON.stringify(content, null, 2)
}

export function formatLessonPlanContent(content: unknown): string {
  if (!content) return 'No content available.'

  if (typeof content === 'string') {
    try {
      return formatLessonPlanContent(JSON.parse(content))
    } catch {
      return content
    }
  }

  const obj = asRecord(content)
  if (!obj) return JSON.stringify(content, null, 2)

  if (typeof obj.markdown === 'string') return obj.markdown

  if (Array.isArray(obj.sections)) {
    return obj.sections
      .map((s) => {
        const section = asRecord(s)
        return `### ${String(section?.title ?? 'Section')}\n${String(section?.content ?? '')}`
      })
      .join('\n\n')
  }

  return JSON.stringify(content, null, 2)
}

export function formatBatchItemContent(item: unknown): string {
  const obj = asRecord(item)
  const raw = obj?.content ?? item

  if (!raw) return 'No content available.'

  if (typeof raw === 'string') {
    try {
      return formatBatchItemContent({ content: JSON.parse(raw) })
    } catch {
      return raw
    }
  }

  const record = asRecord(raw)
  if (!record) return JSON.stringify(raw, null, 2)

  if (typeof record.markdown === 'string') return record.markdown

  if (Array.isArray(record.questions)) {
    return record.questions
      .map((q, i) => {
        const question = asRecord(q)
        const opts = Array.isArray(question?.options)
          ? question.options.map((o) => `  - ${String(o)}`).join('\n')
          : ''
        const text = question?.question ?? question?.text ?? 'Question'
        const answer = question?.answer ? `Answer: ${String(question.answer)}` : ''
        return `${i + 1}. ${String(text)}\n${opts}\n${answer}`
      })
      .join('\n\n')
  }

  if (Array.isArray(record.sections)) {
    return record.sections
      .map((s) => {
        const section = asRecord(s)
        return `### ${String(section?.title ?? 'Section')}\n${String(section?.content ?? '')}`
      })
      .join('\n\n')
  }

  return JSON.stringify(raw, null, 2)
}

export function getBatchItemsFromRecord(batch: {
  items?: unknown[]
  content?: unknown
}): unknown[] {
  if (Array.isArray(batch.items) && batch.items.length > 0) {
    return batch.items
  }
  const content = asRecord(batch.content)
  if (Array.isArray(content?.items) && content.items.length > 0) {
    return content.items
  }
  return []
}
