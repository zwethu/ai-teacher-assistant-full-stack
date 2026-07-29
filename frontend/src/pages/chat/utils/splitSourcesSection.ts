export function splitSourcesSection(markdown: string): { body: string; sources: string } {
  const lines = markdown.split(/\r?\n/)
  const sourceIndex = lines.findIndex(isSourcesHeading)

  if (sourceIndex < 0) {
    return { body: markdown, sources: '' }
  }

  let trailingStart = lines.length
  for (let index = sourceIndex + 1; index < lines.length; index += 1) {
    if (!isMarkdownHeading(lines[index]) || isSourcesHeading(lines[index])) continue
    trailingStart = index

    let previousNonEmpty = index - 1
    while (previousNonEmpty > sourceIndex && lines[previousNonEmpty].trim() === '') {
      previousNonEmpty -= 1
    }
    if (lines[previousNonEmpty]?.trim() === '---') {
      trailingStart = previousNonEmpty
    }
    break
  }

  const leadingBody = trimBodyBeforeSources(lines.slice(0, sourceIndex).join('\n'))
  const trailingBody = lines.slice(trailingStart).join('\n').trim()
  const body = [leadingBody, trailingBody].filter(Boolean).join('\n\n')

  return {
    body,
    sources: lines.slice(sourceIndex, trailingStart).join('\n').trim(),
  }
}

function isSourcesHeading(line: string): boolean {
  const normalized = line
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*|__/g, '')
    .replace(/^🔎\s*/, '')
    .replace(/\s*#+\s*$/, '')
    .trim()

  return /^sources\s*&\s*tool\s*status\s*[:\-–—]?$/i.test(normalized)
}

function isMarkdownHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}(?:\s+|$)/.test(line)
}

function trimBodyBeforeSources(value: string): string {
  const lines = value.split('\n')
  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop()
  if (lines.at(-1)?.trim() === '---') lines.pop()
  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop()
  return lines.join('\n').trim()
}
