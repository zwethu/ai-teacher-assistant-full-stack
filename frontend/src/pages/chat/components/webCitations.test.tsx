import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResponseMarkdown, WebSourcesList } from './MessageRow'
import { DetailBlock, WebSearchDetail } from './run/StepTimelineRow'

const metadata = {
  web_sources: [{ index: 1, title: 'Official docs', url: 'https://docs.example/path', domain: 'docs.example', supports: 'Supports the claim' }],
  web_citations: [{ index: 1, source_index: 1, cited_text: 'Claim evidence' }],
}

describe('web citation presentation', () => {
  it('renders a matched citation marker as a safe clickable chip', () => {
    const html = renderToStaticMarkup(<ResponseMarkdown content="Grounded claim [1]." streaming={false} metadata={metadata} />)
    expect(html).toContain('href="https://docs.example/path"')
    expect(html).toContain('rounded-full')
    expect(html).toContain('target="_blank"')
  })

  it('leaves unmatched citation markers as normal text', () => {
    const html = renderToStaticMarkup(<ResponseMarkdown content="Unsupported [99]." streaming={false} metadata={metadata} />)
    expect(html).toContain('[99]')
    expect(html).not.toContain('href=')
  })

  it('renders metadata-backed web sources', () => {
    const html = renderToStaticMarkup(<WebSourcesList sources={[{ index: 1, title: 'Official docs', url: 'https://docs.example/path', domain: 'docs.example', supports: 'Supports the claim' }]} citations={[{ index: 1, source_index: 1, cited_text: 'Claim evidence' }]} hasMarkdownSources={false} />)
    expect(html).toContain('Web Sources')
    expect(html).toContain('Official docs')
    expect(html).toContain('Supports the claim')
  })

  it('renders structured web-search run details', () => {
    const html = renderToStaticMarkup(<WebSearchDetail detail={{ research_request: 'latest curriculum guidance', queries: ['query one'], sources: [{ title: 'Official', url: 'https://example.edu' }], source_count: 1, citation_count: 2, extraction_mode: 'grounding_metadata' }} />)
    expect(html).toContain('Research request')
    expect(html).toContain('query one')
    expect(html).toContain('https://example.edu')
    expect(html).toContain('1 sources')
  })

  it('keeps unknown run details on the generic fallback path', () => {
    const html = renderToStaticMarkup(<DetailBlock detail={{ custom_field: 'custom value' }} />)
    expect(html).toContain('custom_field')
    expect(html).toContain('custom value')
  })
})
