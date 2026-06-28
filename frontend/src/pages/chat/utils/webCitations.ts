export type WebSourceMetadata = {
  index: number
  title: string
  url: string
  domain: string
  supports: string
}

export type WebCitationMetadata = {
  index: number
  source_index: number
  cited_text: string
}

function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

export function normalizeWebSources(metadata?: Record<string, unknown>): WebSourceMetadata[] {
  if (!Array.isArray(metadata?.web_sources)) return []
  const seen = new Set<string>()
  const seenIndices = new Set<number>()
  const result: WebSourceMetadata[] = []
  for (const raw of metadata.web_sources.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const url = safeHttpUrl(item.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const parsed = new URL(url)
    const requestedIndex = Number(item.index)
    const index = Number.isInteger(requestedIndex) && requestedIndex > 0 && !seenIndices.has(requestedIndex)
      ? requestedIndex
      : Array.from({ length: 100 }, (_, offset) => offset + 1).find((candidate) => !seenIndices.has(candidate)) || result.length + 1
    seenIndices.add(index)
    result.push({
      index,
      title: String(item.title || item.domain || parsed.hostname).slice(0, 180),
      url,
      domain: parsed.hostname.slice(0, 180),
      supports: String(item.supports || '').slice(0, 300),
    })
    if (result.length >= 10) break
  }
  return result
}

export function normalizeWebCitations(metadata?: Record<string, unknown>): WebCitationMetadata[] {
  if (!Array.isArray(metadata?.web_citations)) return []
  const result: WebCitationMetadata[] = []
  for (const raw of metadata.web_citations.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const sourceIndex = Number(item.source_index)
    if (!Number.isInteger(sourceIndex) || sourceIndex < 1) continue
    result.push({
      index: result.length + 1,
      source_index: sourceIndex,
      cited_text: String(item.cited_text || '').slice(0, 300),
    })
  }
  return result
}

export function markdownUrls(markdown: string): Set<string> {
  const urls = new Set<string>()
  for (const match of markdown.matchAll(/\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/gi)) {
    const url = safeHttpUrl(match[1])
    if (url) urls.add(url)
  }
  return urls
}

type MarkdownNode = {
  type?: string
  value?: string
  url?: string
  title?: string
  children?: MarkdownNode[]
}

export function citationRemarkPlugin(sourceByIndex: Map<number, WebSourceMetadata>) {
  return () => (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (!Array.isArray(node.children) || ['link', 'linkReference', 'code', 'inlineCode'].includes(node.type || '')) return
      const next: MarkdownNode[] = []
      for (const child of node.children) {
        if (child.type !== 'text' || typeof child.value !== 'string') {
          visit(child)
          next.push(child)
          continue
        }
        const pattern = /\[([1-9]\d*)\]/g
        let cursor = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(child.value))) {
          const source = sourceByIndex.get(Number(match[1]))
          if (!source) continue
          if (match.index > cursor) next.push({ type: 'text', value: child.value.slice(cursor, match.index) })
          next.push({
            type: 'link',
            url: source.url,
            title: `${source.title} — ${source.domain}`,
            children: [{ type: 'text', value: match[0] }],
          })
          cursor = match.index + match[0].length
        }
        if (cursor === 0) next.push(child)
        else if (cursor < child.value.length) next.push({ type: 'text', value: child.value.slice(cursor) })
      }
      node.children = next
    }
    visit(tree)
  }
}
