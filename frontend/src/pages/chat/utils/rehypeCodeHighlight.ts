import { createLowlight } from 'lowlight'
import { visit } from 'unist-util-visit'
import type { Element, Root } from 'hast'

import { CODE_LANGUAGES } from './codeLanguages'

/**
 * Syntax highlighting over exactly the grammars in `CODE_LANGUAGES`.
 *
 * This exists instead of `rehype-highlight` because that package cannot be
 * made small. Its option to supply your own grammars reads
 * `settings.languages || common` — a live reference, so highlight.js's entire
 * 37-grammar `common` set stays in the module graph no matter what you pass.
 * Measured on this build: +51KB gzipped, and Swift, Rust and PHP shipped to
 * lecturers who will never open a fence tagged with any of them. Registering
 * against `createLowlight` directly is the only way to actually pay for what
 * gets used, and the work it saves us is the thirty lines below.
 *
 * The block's `pre` wrapper, its label and its colours all live elsewhere —
 * this only turns text into spans.
 */
const lowlight = createLowlight(CODE_LANGUAGES)

/** The fence's language, if it named one we can actually highlight. */
function languageOf(node: Element): string | null {
  const classes = [node.properties?.className].flat().filter(Boolean).map(String)
  for (const value of classes) {
    const match = /^language-([\w+#-]+)$/.exec(value)
    if (!match) continue
    const name = match[1].toLowerCase()
    // `registered` resolves aliases too, so `py` and `sh` land on their
    // grammars without a lookup table of our own.
    if (lowlight.registered(name)) return name
  }
  return null
}

export function rehypeCodeHighlight() {
  return function transform(tree: Root) {
    visit(tree, 'element', function (node, _index, parent) {
      // Only fenced blocks. Inline `code` is prose punctuation — highlighting
      // a variable name mid-sentence colours it as if it were a snippet.
      if (node.tagName !== 'code') return
      if (!parent || parent.type !== 'element' || parent.tagName !== 'pre') return

      const language = languageOf(node)
      // No language, or one we did not register: left exactly as written.
      // Guessing is deliberately not on offer — a few lines is not enough
      // evidence, and a wrong guess colours the code as a lie.
      if (!language) return

      // A markdown fence is always a single text child; anything else would
      // mean another plugin already rewrote this block, and we leave it alone.
      const source = node.children
        .map((child) => (child.type === 'text' ? child.value : ''))
        .join('')
      if (!source) return

      const result = lowlight.highlight(language, source)
      node.properties = {
        ...node.properties,
        className: [...new Set([...(([node.properties?.className].flat().filter(Boolean).map(String))), 'hljs'])],
      }
      node.children = result.children as Element['children']
    })
  }
}
