import { describe, expect, it } from 'vitest'
import {
  cleanSourceSupportText,
  isGoogleGroundingRedirectUrl,
  normalizeWebCitations,
  normalizeWebSources,
} from './webCitations'

// ---------------------------------------------------------------------------
// isGoogleGroundingRedirectUrl
// ---------------------------------------------------------------------------

describe('isGoogleGroundingRedirectUrl', () => {
  it('returns true for vertexaisearch.cloud.google.com URLs', () => {
    expect(
      isGoogleGroundingRedirectUrl(
        'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbF90_xyz',
      ),
    ).toBe(true)
  })

  it('returns false for normal site URLs', () => {
    expect(isGoogleGroundingRedirectUrl('https://outsystems.com/docs')).toBe(false)
    expect(isGoogleGroundingRedirectUrl('https://developer.google.com')).toBe(false)
  })

  it('returns false for empty/invalid input', () => {
    expect(isGoogleGroundingRedirectUrl('')).toBe(false)
    expect(isGoogleGroundingRedirectUrl('not-a-url')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// cleanSourceSupportText
// ---------------------------------------------------------------------------

describe('cleanSourceSupportText', () => {
  it('removes heading markers and bold', () => {
    const raw = '## Key Findings - **OutSystems Education Program**: Provides self-paced courses.'
    const cleaned = cleanSourceSupportText(raw)
    expect(cleaned).not.toContain('##')
    expect(cleaned).not.toContain('**')
    expect(cleaned).toContain('OutSystems Education Program')
    expect(cleaned).toContain('Provides self-paced courses.')
  })

  it('removes leading bullets', () => {
    expect(cleanSourceSupportText('- First point')).toBe('First point')
    expect(cleanSourceSupportText('* Another point')).toBe('Another point')
  })

  it('leaves plain prose unchanged', () => {
    const prose = 'OutSystems is a platform for building enterprise apps.'
    expect(cleanSourceSupportText(prose)).toBe(prose)
  })

  it('does not destroy URLs in the text', () => {
    const text = 'See https://docs.example.com/api for more.'
    expect(cleanSourceSupportText(text)).toContain('https://docs.example.com/api')
  })

  it('returns empty string for empty input', () => {
    expect(cleanSourceSupportText('')).toBe('')
    expect(cleanSourceSupportText('   ')).toBe('')
  })

  it('caps output at 300 characters', () => {
    const long = 'word '.repeat(100)
    expect(cleanSourceSupportText(long).length).toBeLessThanOrEqual(300)
  })
})

// ---------------------------------------------------------------------------
// normalizeWebSources — redirect domain handling
// ---------------------------------------------------------------------------

const REDIRECT_URL_A = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbF90_aaa'
const REDIRECT_URL_B = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbF90_bbb'

describe('normalizeWebSources — Google redirect URLs', () => {
  it('uses the title as display_domain when it looks like a domain', () => {
    const sources = normalizeWebSources({
      web_sources: [
        { index: 1, title: 'outsystems.com', url: REDIRECT_URL_A, supports: 'claim' },
      ],
    })
    expect(sources).toHaveLength(1)
    expect(sources[0].display_domain).toBe('outsystems.com')
    expect(sources[0].domain).toBe('outsystems.com')
    expect(sources[0].domain).not.toContain('vertexaisearch')
  })

  it('returns empty display_domain when title is not a domain', () => {
    const sources = normalizeWebSources({
      web_sources: [
        { index: 1, title: 'OutSystems Education Program', url: REDIRECT_URL_A },
      ],
    })
    expect(sources).toHaveLength(1)
    expect(sources[0].display_domain).toBe('')
    expect(sources[0].domain).not.toContain('vertexaisearch')
  })

  it('prefers backend-provided display_domain over title', () => {
    const sources = normalizeWebSources({
      web_sources: [
        {
          index: 1,
          title: 'outsystems.com',
          url: REDIRECT_URL_A,
          display_domain: 'learn.outsystems.com',
        },
      ],
    })
    expect(sources[0].display_domain).toBe('learn.outsystems.com')
  })

  it('collapses duplicate redirect URLs with the same domain-like title into one source', () => {
    const sources = normalizeWebSources({
      web_sources: [
        { index: 1, title: 'outsystems.com', url: REDIRECT_URL_A, supports: 'first claim' },
        { index: 2, title: 'outsystems.com', url: REDIRECT_URL_B, supports: 'second claim' },
      ],
    })
    expect(sources).toHaveLength(1)
    expect(sources[0].display_domain).toBe('outsystems.com')
    expect(sources[0].supports).toContain('second claim')
  })

  it('keeps redirect URLs with different domain labels separate', () => {
    const sources = normalizeWebSources({
      web_sources: [
        { index: 1, title: 'outsystems.com', url: REDIRECT_URL_A },
        { index: 2, title: 'developer.google.com', url: REDIRECT_URL_B },
      ],
    })
    expect(sources).toHaveLength(2)
  })

  it('sets link_type to google_grounding_redirect for redirect URLs', () => {
    const sources = normalizeWebSources({
      web_sources: [{ index: 1, title: 'outsystems.com', url: REDIRECT_URL_A }],
    })
    expect(sources[0].link_type).toBe('google_grounding_redirect')
  })
})

// ---------------------------------------------------------------------------
// normalizeWebSources — direct URLs (unchanged behaviour)
// ---------------------------------------------------------------------------

describe('normalizeWebSources — direct URLs', () => {
  it('uses the real hostname as domain for non-redirect URLs', () => {
    const sources = normalizeWebSources({
      web_sources: [{ index: 1, title: 'Docs', url: 'https://docs.example.edu/path' }],
    })
    expect(sources[0].domain).toBe('docs.example.edu')
    expect(sources[0].link_type).toBe('direct')
  })

  it('deduplicates direct URLs by normalised URL', () => {
    const sources = normalizeWebSources({
      web_sources: [
        { index: 1, title: 'A', url: 'https://example.com/page' },
        { index: 2, title: 'B', url: 'https://example.com/page#section' },
      ],
    })
    expect(sources).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// normalizeWebSources — support text cleanup
// ---------------------------------------------------------------------------

describe('normalizeWebSources — support text cleanup', () => {
  it('cleans markdown from supports field', () => {
    const sources = normalizeWebSources({
      web_sources: [
        {
          index: 1,
          title: 'Example',
          url: 'https://example.com',
          supports: '## Key Findings - **Bold**: Some text.',
        },
      ],
    })
    expect(sources[0].supports).not.toContain('##')
    expect(sources[0].supports).not.toContain('**')
    expect(sources[0].supports).toContain('Bold')
  })
})

// ---------------------------------------------------------------------------
// normalizeWebCitations — cited_text cleanup
// ---------------------------------------------------------------------------

describe('normalizeWebCitations — cited_text cleanup', () => {
  it('cleans markdown from cited_text', () => {
    const citations = normalizeWebCitations({
      web_citations: [
        { index: 1, source_index: 1, cited_text: '## Heading - **Bold text** here.' },
      ],
    })
    expect(citations[0].cited_text).not.toContain('##')
    expect(citations[0].cited_text).not.toContain('**')
    expect(citations[0].cited_text).toContain('Bold text')
  })

  it('filters out entries with invalid source_index', () => {
    const citations = normalizeWebCitations({
      web_citations: [
        { index: 1, source_index: 0, cited_text: 'invalid' },
        { index: 2, source_index: 1, cited_text: 'valid' },
      ],
    })
    expect(citations).toHaveLength(1)
    expect(citations[0].cited_text).toBe('valid')
  })
})
