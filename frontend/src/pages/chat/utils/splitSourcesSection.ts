export function splitSourcesSection(markdown: string): { body: string; sources: string } {
  const lines = markdown.split(/\r?\n/)
  const sourceIndex = lines.findIndex((line) => {
    const normalized = line
      .replace(/^[-*]\s*/, '')
      .replace(/^#+\s*/, '')
      .replace(/^🔎\s*/, '')
      .replace(/\*\*/g, '')
      .trim()
      .toLowerCase()
    return normalized === 'sources & tool status' || normalized.startsWith('sources & tool status ')
  })

  if (sourceIndex < 0) {
    return { body: markdown, sources: '' }
  }

  let bodyLines = lines.slice(0, sourceIndex)
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '---') {
    bodyLines = bodyLines.slice(0, -1)
  }

  return {
    body: bodyLines.join('\n').trim(),
    sources: lines.slice(sourceIndex).join('\n').trim(),
  }
}
