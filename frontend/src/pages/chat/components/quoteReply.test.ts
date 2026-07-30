import { describe, expect, it } from 'vitest'

import {
  MAX_QUOTE_CHARS,
  formatQuoteMention,
  parseUserMessageContent,
} from './MessageRow'

/**
 * Quote-reply is a round trip through the message body: `formatQuoteMention`
 * writes a marker the agent reads as context, `parseUserMessageContent` takes
 * it back out so the raw marker never reaches the screen. If the two drift, the
 * lecturer sees machinery in their own message bubble.
 *
 * It has to live in the body because that is the only channel the agent gets —
 * agent_gateway hands the message `content` to Agent Engine verbatim and never
 * forwards `metadata`.
 */
describe('quote-reply round trip', () => {
  it('strips the marker back out and returns the excerpt', () => {
    const sent = [formatQuoteMention('the boot layout hints at something non-standard'), 'what does that mean?'].join('\n\n')

    const { body, quote, references } = parseUserMessageContent(sent)

    expect(body).toBe('what does that mean?')
    expect(quote).toBe('the boot layout hints at something non-standard')
    expect(references).toEqual([])
  })

  it('collapses newlines so the marker stays one line', () => {
    // The regex is anchored per line; a multi-line excerpt would otherwise
    // leave its tail behind in the visible body.
    const mention = formatQuoteMention('first paragraph\n\nsecond   paragraph')

    expect(mention.split('\n')).toHaveLength(1)
    expect(parseUserMessageContent(`${mention}\n\nfollow up`).quote)
      .toBe('first paragraph second paragraph')
  })

  it('caps a long excerpt so it cannot bloat every later turn', () => {
    const mention = formatQuoteMention('x'.repeat(MAX_QUOTE_CHARS * 3))
    const { quote } = parseUserMessageContent(`${mention}\n\nwhy?`)

    expect(quote.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS + 1) // + ellipsis
    expect(quote.endsWith('…')).toBe(true)
  })

  it('coexists with a referenced attachment in one message', () => {
    const sent = [
      formatQuoteMention('exported to Google Forms'),
      'compare this with the file',
      'Please use the earlier attachment notes.pdf. Attachment ID: att-1',
    ].join('\n\n')

    const { body, quote, references } = parseUserMessageContent(sent)

    expect(quote).toBe('exported to Google Forms')
    expect(body).toBe('compare this with the file')
    expect(references).toEqual([{ title: 'notes.pdf', id: 'att-1' }])
  })

  it('leaves an ordinary message untouched', () => {
    const { body, quote } = parseUserMessageContent('just a normal question')
    expect(body).toBe('just a normal question')
    expect(quote).toBe('')
  })

  it('does not mistake a quotation the lecturer typed themselves', () => {
    const { body, quote } = parseUserMessageContent('she said "in reply to this" yesterday')
    expect(quote).toBe('')
    expect(body).toBe('she said "in reply to this" yesterday')
  })
})

// --- what actually leaves the browser ---------------------------------------

describe('outgoing message composition', () => {
  it('sends the quote alongside the request, quote first', async () => {
    const { composeOutgoingMessage } = await import('../hooks/useChatPage')

    const { content } = composeOutgoingMessage({
      typed: 'can you redo that for week 4?',
      quote: 'exported to Google Forms',
      references: [],
      hasAttachments: false,
    })

    // One string, both parts — this is what agent_gateway replays to the agent.
    expect(content).toBe(
      'In reply to this part of your earlier response: "exported to Google Forms"\n\n' +
      'can you redo that for week 4?',
    )
    expect(parseUserMessageContent(content).quote).toBe('exported to Google Forms')
    expect(parseUserMessageContent(content).body).toBe('can you redo that for week 4?')
  })

  it('carries a quote, an attachment reference and the request together', async () => {
    const { composeOutgoingMessage } = await import('../hooks/useChatPage')

    const { content } = composeOutgoingMessage({
      typed: 'compare these',
      quote: 'the week 1 quiz',
      references: [{ attachment_id: 'att-1', file_title: 'notes.pdf' }],
      hasAttachments: false,
    })

    const parsed = parseUserMessageContent(content)
    expect(parsed.quote).toBe('the week 1 quiz')
    expect(parsed.body).toBe('compare these')
    expect(parsed.references).toEqual([{ title: 'notes.pdf', id: 'att-1' }])
  })

  it('omits the marker entirely when nothing was quoted', async () => {
    const { composeOutgoingMessage } = await import('../hooks/useChatPage')

    const { content } = composeOutgoingMessage({
      typed: 'plain question', quote: '', references: [], hasAttachments: false,
    })

    expect(content).toBe('plain question')
  })
})
