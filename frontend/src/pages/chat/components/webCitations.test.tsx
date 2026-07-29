// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ResponseMarkdown, WebSourcesList } from './MessageRow'
import { DetailBlock, WebSearchDetail } from './run/StepTimelineRow'

const metadata = {
  web_sources: [{ index: 1, title: 'Official docs', url: 'https://docs.example/path', domain: 'docs.example', supports: 'Supports the claim' }],
  web_citations: [{ index: 1, source_index: 1, cited_text: 'Claim evidence' }],
  web_queries: ['official teaching guidance'],
}

afterEach(() => cleanup())

describe('web citation presentation', () => {
  it('renders a matched citation marker as a popup button rather than a direct link', () => {
    const html = renderToStaticMarkup(<ResponseMarkdown content="Grounded claim [1]." streaming={false} metadata={metadata} />)
    expect(html).toContain('<button')
    expect(html).toContain('rounded-full')
    expect(html).not.toContain('href="https://docs.example/path"')
  })

  it('drops an unmatched marker instead of printing a bare number', () => {
    const html = renderToStaticMarkup(<ResponseMarkdown content="Unsupported [21]." streaming={false} metadata={metadata} />)
    // A citation is only ever shown as a named chip. Index 21 has no captured
    // source, so there is nothing to name and the marker goes away — a stray
    // "[21]" beside real chips reads as a broken footnote.
    expect(html).not.toContain('[21]')
    expect(html).not.toContain('Source not available in captured metadata.')
    // The space that led into the marker goes with it.
    expect(html).toContain('Unsupported.')
  })

  it('keeps naming chips when only some indices in a group resolve', () => {
    const html = renderToStaticMarkup(
      <ResponseMarkdown content="Mixed [1, 21]." streaming={false} metadata={metadata} />,
    )
    expect(html).toContain('docs.example')
    expect(html).not.toContain('[21]')
  })

  it('splits grouped citations into separate chips and preserves source 11', () => {
    const sources = Array.from({ length: 11 }, (_, offset) => ({ index: offset + 1, title: `Source ${offset + 1}`, url: `https://source${offset + 1}.example/path`, domain: `source${offset + 1}.example`, supports: '' }))
    render(<ResponseMarkdown content="Claims [8, 9] and [11]." streaming={false} metadata={{ web_sources: sources }} />)
    expect(screen.getByRole('button', { name: 'source8.example' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'source9.example' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'source11.example' })).toBeTruthy()
  })

  it('does not transform markers inside code or existing links', () => {
    const html = renderToStaticMarkup(<ResponseMarkdown content={'Code `[1]` and [1](https://existing.example).'} streaming={false} metadata={metadata} />)
    // No citation chip should be produced: one marker sits inside code, the
    // other is already a markdown link. (This previously also asserted a total
    // of one <button>, which only ever counted the Sources button — a settled
    // response now renders copy/retry alongside it, and that count was never
    // what the test was about.)
    expect(html).not.toContain('title="Official docs')
    expect(html).toContain('href="https://existing.example"')
  })

  it('opens a focused citation popup and external source button', async () => {
    const user = userEvent.setup()
    render(<ResponseMarkdown content="Grounded claim [1]." streaming={false} metadata={metadata} />)
    await user.click(screen.getByRole('button', { name: 'docs.example' }))
    expect(screen.getByRole('dialog', { name: 'Source 1' })).toBeTruthy()
    expect(screen.getByText('Official docs')).toBeTruthy()
    const open = screen.getByRole('link', { name: /Open source/i })
    expect(open.getAttribute('href')).toBe('https://docs.example/path')
    expect(screen.getByRole('button', { name: 'Close source popup' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Source 1' })).toBeNull()
  })

  it('opens all sources and queries in a modal instead of inline expansion', async () => {
    const user = userEvent.setup()
    render(<ResponseMarkdown content={'Answer [1].\n\n## Sources & Tool Status\n- Web: success'} streaming={false} metadata={metadata} />)
    expect(screen.queryByRole('dialog', { name: 'Web Sources' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /source/i }))
    const dialog = screen.getByRole('dialog', { name: 'Web Sources' })
    expect(dialog).toBeTruthy()
    expect(screen.getByText('official teaching guidance')).toBeTruthy()
    expect(screen.getByText('Sources & Tool Status')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close Web Sources' })).toBeTruthy()
  })

  it('renders metadata-backed web sources', () => {
    const html = renderToStaticMarkup(<WebSourcesList sources={[{ index: 1, title: 'Official docs', url: 'https://docs.example/path', domain: 'docs.example', display_domain: 'docs.example', supports: 'Supports the claim' }]} citations={[{ index: 1, source_index: 1, cited_text: 'Claim evidence' }]} hasMarkdownSources={false} />)
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
