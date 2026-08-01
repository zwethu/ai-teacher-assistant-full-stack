// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ResponseMarkdown } from './MessageRow'

/**
 * Code blocks used to render as a flat black box: the fence's `language-*`
 * class reached the DOM but nothing consumed it, so Python and JSON and a
 * shell transcript all looked identical.
 *
 * The interesting part is not that highlighting happens — it is that it
 * survives `rehype-sanitize`, which runs *after* the highlighter and would
 * strip every span if the schema did not allow `className`.
 */
const fence = (language: string, code: string) =>
  renderToStaticMarkup(
    <ResponseMarkdown content={'```' + language + '\n' + code + '\n```'} streaming={false} />,
  )

describe('code highlighting', () => {
  it('tokenises a fenced block instead of printing one flat colour', () => {
    const html = fence('python', 'def run():\n    return "ok"')

    expect(html).toContain('hljs-keyword') // def
    expect(html).toContain('hljs-string') // "ok"
  })

  it('survives the sanitizer that runs after it', () => {
    // The spans are generated markup like any other and are sanitized, not
    // trusted. If the schema ever stops allowing className this goes silent
    // rather than erroring, which is exactly why it is asserted.
    const html = fence('python', 'import os')

    expect(html).toMatch(/<span class="hljs-\w+"/)
  })

  it('resolves the aliases people actually type', () => {
    // `py`, not `python`. highlight.js grammars declare their own aliases and
    // lowlight registers them, so there is no table of ours to drift.
    expect(fence('py', 'class A: pass')).toContain('hljs-keyword')
    expect(fence('js', 'const a = 1')).toContain('hljs-keyword')
  })

  it('leaves a language we did not register exactly as written', () => {
    // Ruby is deliberately not in the registry. It must degrade to plain text,
    // not throw and not get guessed at.
    const html = fence('ruby', 'puts "hello"')

    expect(html).not.toContain('hljs-')
    expect(html).toContain('puts')
  })

  it('leaves an untagged fence alone rather than guessing', () => {
    const html = fence('', 'some output\nfrom a terminal')

    expect(html).not.toContain('hljs-')
    expect(html).toContain('from a terminal')
  })

  it('does not colour inline code, which is prose punctuation', () => {
    const html = renderToStaticMarkup(
      <ResponseMarkdown content="Call the `run()` helper." streaming={false} />,
    )

    expect(html).not.toContain('hljs-')
    expect(html).toContain('run()')
  })
})

describe('the language label', () => {
  it('names the language on the block', () => {
    expect(fence('python', 'x = 1')).toContain('Python')
  })

  it('uses the name people know, not highlight.js’s', () => {
    // Highlighting resolves aliases through the grammar, so ```html and ```py
    // already colour correctly — the label needs its own mapping, and rendered
    // a bare lowercase "html" until this caught it.
    expect(fence('html', '<p>hi</p>')).toContain('HTML')
    expect(fence('py', 'x = 1')).toContain('Python')
    expect(fence('yml', 'a: 1')).toContain('YAML')
  })

  it('does not forward react-markdown’s node object into the DOM', () => {
    // Every component override receives the hast node; spreading the rest onto
    // the element stringified it into a node="[object Object]" attribute.
    expect(fence('python', 'x = 1')).not.toContain('node="')
  })

  it('says nothing when the fence named nothing', () => {
    // A "TEXT" badge on an untagged block is chrome that carries no
    // information — the reader can see it is text.
    const html = fence('', 'plain output')

    expect(html).not.toContain('tracking-[0.08em]')
  })
})
