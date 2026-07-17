export type WebSourceMetadata = {
  index: number
  title: string
  url: string
  domain: string
  display_domain: string
  supports: string
  link_type?: string
}

export type WebCitationMetadata = {
  index: number
  source_index: number
  cited_text: string
}

// ---------------------------------------------------------------------------
// Google grounding redirect detection
// ---------------------------------------------------------------------------

const GOOGLE_GROUNDING_REDIRECT_HOSTS = new Set([
  'vertexaisearch.cloud.google.com',
  'vertexaisearch.googleapis.com',
])

export function isGoogleGroundingRedirectUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return GOOGLE_GROUNDING_REDIRECT_HOSTS.has(hostname.toLowerCase())
  } catch {
    return false
  }
}

// A bare domain name looks like outsystems.com, developer.google.com, etc.
const DOMAIN_LIKE_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$/i

function looksLikeDomain(text: string): boolean {
  return DOMAIN_LIKE_RE.test(text.trim())
}

// ---------------------------------------------------------------------------
// Support text cleanup
// ---------------------------------------------------------------------------

/**
 * Strip markdown decoration from source support/cited_text snippets.
 *
 * Removes headings (## …), bold (**…**), italic (*…*), leading bullets,
 * and bare [web] labels. Collapses whitespace. Caps at 300 chars.
 */
export function cleanSourceSupportText(text: string): string {
  if (!text) return ''
  let cleaned = text
  // Remove heading markers: ## Heading → Heading
  cleaned = cleaned.replace(/^#{1,6}\s*/gm, '')
  // Unwrap bold: **text** → text, __text__ → text
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/gs, '$1').replace(/__(.+?)__/gs, '$1')
  // Unwrap italic: *text* → text, _text_ → text
  cleaned = cleaned.replace(/\*(.+?)\*/gs, '$1').replace(/_(.+?)_/gs, '$1')
  // Remove leading bullets
  cleaned = cleaned.replace(/^\s*[-*+]\s+/gm, '')
  // Remove bare [web] labels
  cleaned = cleaned.replace(/\[web\]\s*/gi, '')
  // Collapse whitespace
  cleaned = cleaned.split(/\s+/).filter(Boolean).join(' ')
  return cleaned.slice(0, 300)
}

// ---------------------------------------------------------------------------
// URL utilities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

export function normalizeWebSources(metadata?: Record<string, unknown>): WebSourceMetadata[] {
  if (!Array.isArray(metadata?.web_sources)) return []
  const seenUrls = new Set<string>()
  const seenIndices = new Set<number>()
  // Redirect dedup: collapse multiple redirect URLs for the same label into one
  const redirectLabelSeen = new Map<string, number>() // label → result index
  const result: WebSourceMetadata[] = []

  for (const raw of metadata.web_sources.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const url = safeHttpUrl(item.url)
    if (!url) continue

    const isRedirect = isGoogleGroundingRedirectUrl(url)

    // Determine display_domain: prefer backend-provided field, then derive
    const backendDisplayDomain = String(item.display_domain || '').trim()
    const itemTitle = String(item.title || '').trim()
    let displayDomain: string

    if (isRedirect) {
      if (backendDisplayDomain && !GOOGLE_GROUNDING_REDIRECT_HOSTS.has(backendDisplayDomain)) {
        displayDomain = backendDisplayDomain
      } else if (looksLikeDomain(itemTitle)) {
        displayDomain = itemTitle.toLowerCase()
      } else {
        displayDomain = ''
      }
    } else {
      displayDomain = backendDisplayDomain
    }

    // Redirect-aware dedup: collapse by label key for redirect sources
    if (isRedirect && displayDomain) {
      const labelKey = displayDomain.toLowerCase()
      if (redirectLabelSeen.has(labelKey)) {
        // Merge supports into existing entry
        const existingIdx = redirectLabelSeen.get(labelKey)!
        const existing = result[existingIdx]
        const newSupport = cleanSourceSupportText(String(item.supports || ''))
        if (newSupport && !existing.supports.includes(newSupport)) {
          existing.supports = cleanSourceSupportText(
            [existing.supports, newSupport].filter(Boolean).join('; '),
          )
        }
        continue
      }
    }

    // Normal URL dedup
    if (seenUrls.has(url)) continue
    seenUrls.add(url)

    const requestedIndex = Number(item.index)
    const index =
      Number.isInteger(requestedIndex) && requestedIndex > 0 && !seenIndices.has(requestedIndex)
        ? requestedIndex
        : Array.from({ length: 100 }, (_, offset) => offset + 1).find(
            (candidate) => !seenIndices.has(candidate),
          ) || result.length + 1
    seenIndices.add(index)

    // Derive domain shown in the domain line (below title in the UI)
    let visibleDomain: string
    if (isRedirect) {
      visibleDomain = displayDomain // may be empty — that's fine; UI will skip it
    } else {
      try {
        visibleDomain = displayDomain || new URL(url).hostname
      } catch {
        visibleDomain = ''
      }
    }

    const entry: WebSourceMetadata = {
      index,
      title: (String(item.title || item.domain || visibleDomain || url)).slice(0, 180),
      url,
      domain: visibleDomain,
      display_domain: displayDomain,
      supports: cleanSourceSupportText(String(item.supports || '')),
      link_type: String(item.link_type || (isRedirect ? 'google_grounding_redirect' : 'direct')),
    }
    const pos = result.length
    result.push(entry)

    if (isRedirect && displayDomain) {
      redirectLabelSeen.set(displayDomain.toLowerCase(), pos)
    }

    if (result.length >= 20) break
  }
  return result
}

export function normalizeWebCitations(metadata?: Record<string, unknown>): WebCitationMetadata[] {
  if (!Array.isArray(metadata?.web_citations)) return []
  const result: WebCitationMetadata[] = []
  for (const raw of metadata.web_citations.slice(0, 40)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const sourceIndex = Number(item.source_index)
    if (!Number.isInteger(sourceIndex) || sourceIndex < 1) continue
    result.push({
      index: result.length + 1,
      source_index: sourceIndex,
      cited_text: cleanSourceSupportText(String(item.cited_text || '')),
    })
  }
  return result
}

export function normalizeWebQueries(metadata?: Record<string, unknown>): string[] {
  if (!Array.isArray(metadata?.web_queries)) return []
  return metadata.web_queries
    .filter((query): query is string => typeof query === 'string')
    .map((query) => query.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 8)
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
        const pattern = /\[([1-9]\d*(?:\s*,\s*[1-9]\d*)*)\]/g
        let cursor = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(child.value))) {
          if (match.index > cursor) next.push({ type: 'text', value: child.value.slice(cursor, match.index) })
          const indices = match[1].split(',').map((value) => Number(value.trim()))
          indices.forEach((index, position) => {
            const source = sourceByIndex.get(index)
            if (position > 0) next.push({ type: 'text', value: ' ' })
            next.push({
              type: 'link',
              url: source?.url || `#citation-unavailable-${index}`,
              title: source
                ? `${source.title} — ${source.display_domain || source.domain}`
                : 'Source not available in captured metadata.',
              children: [{ type: 'text', value: `[${index}]` }],
            })
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

/** Unique web sources across chat messages, first-seen title/domain wins. */
export function collectUniqueChatWebLinks(
  messages: Array<{ role?: string; metadata?: Record<string, unknown> }>,
): WebSourceMetadata[] {
  const byUrl = new Map<string, WebSourceMetadata>()
  for (const message of messages) {
    if (message.role && message.role !== 'assistant') continue
    for (const source of normalizeWebSources(message.metadata)) {
      const key = source.url.trim()
      if (!key || byUrl.has(key)) continue
      byUrl.set(key, source)
    }
  }
  return Array.from(byUrl.values())
}
