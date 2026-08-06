import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/* Node environment on purpose: jsdom rewrites `import.meta.url` to an http URL,
   and the stylesheet is not applied there anyway. See composerMotionCss.test.ts
   for why the CSS is asserted at all. */
const css = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8')

describe('the entrance stylesheet', () => {
  const body = /\.mila-bubble-in \{([^}]*)\}/s.exec(css)?.[1] ?? ''

  it('fills backwards, so no sent message keeps a transform', () => {
    // A forwards fill would hold `transform: none` on every bubble for the life
    // of the page. That is a containing block, and the quote-reply button is
    // portalled to <body> at fixed coordinates — it would be positioned against
    // the bubble instead of the viewport.
    expect(body).toContain('backwards')
    expect(body).not.toMatch(/\bboth\b/)
  })

  it('honours prefers-reduced-motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.mila-bubble-in')))
    expect(reduced).toContain('.mila-bubble-in')
  })
})
