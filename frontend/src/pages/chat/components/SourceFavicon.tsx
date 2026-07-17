import { useMemo, useState } from 'react'
import { Globe } from 'lucide-react'
import { isGoogleGroundingRedirectUrl } from '../utils/webCitations'

/**
 * Resolve the hostname to look a favicon up for.
 *
 * Prefers the backend-provided display domain. Falls back to the URL's hostname
 * only for direct links — Google-grounding redirect URLs point at
 * vertexaisearch.cloud.google.com, not the real site, so we never derive a host
 * from them (returning '' makes the caller show its static fallback icon).
 */
function faviconHost(domain?: string, url?: string): string {
  const declared = (domain || '').trim().toLowerCase()
  if (declared && !declared.includes('/') && !declared.includes(' ')) {
    return declared.replace(/^www\./, '')
  }
  if (url && !isGoogleGroundingRedirectUrl(url)) {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      /* not a parseable URL — fall through to the static fallback */
    }
  }
  return ''
}

/**
 * Renders a web source's own favicon (via Google's favicon service), degrading
 * to a static fallback icon when there's no resolvable domain or the image
 * fails to load.
 */
export function SourceFavicon({
  domain,
  url,
  fallback,
  className = 'h-4 w-4 rounded-sm',
}: {
  domain?: string
  url?: string
  fallback?: React.ReactNode
  className?: string
}) {
  const host = useMemo(() => faviconHost(domain, url), [domain, url])
  const [failed, setFailed] = useState(false)
  const fallbackNode = fallback ?? <Globe className={`${className} text-slate-400`} />
  if (!host || failed) return <>{fallbackNode}</>
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
