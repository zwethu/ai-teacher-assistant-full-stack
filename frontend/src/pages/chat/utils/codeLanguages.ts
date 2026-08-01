import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/**
 * The languages a computing lecturer actually writes, and no more.
 *
 * `rehype-highlight` defaults to highlight.js's `common` set — 37 grammars,
 * including Ruby, PHP, Perl, Swift, Kotlin, Lua, R, Objective-C and Rust —
 * on a build that already warns about chunks over 500KB. Passing `languages`
 * replaces that default outright rather than adding to it, so this list is the
 * whole registry.
 *
 * Aliases come free: highlight.js grammars declare their own (`py`, `js`,
 * `ts`, `sh`, `yml`, `html`, `c++`, `cs`), and lowlight registers them with the
 * grammar. A fence tagged with anything not in this list is left as plain text
 * rather than guessed at — `detect` stays off, because a four-line snippet is
 * not enough evidence and a wrong guess colours the code as a lie.
 *
 * `xml` covers HTML, which is what highlight.js calls that grammar.
 */
export const CODE_LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  java,
  javascript,
  json,
  markdown,
  plaintext,
  python,
  sql,
  typescript,
  xml,
  yaml,
}

/**
 * Shown in the corner of a block, keyed on what someone actually writes after
 * the backticks — not on the grammar's canonical name.
 *
 * The two differ more than you would expect. Highlighting resolves aliases via
 * the grammar itself, so ```html and ```py already colour correctly; the label
 * had no such luck and rendered a bare lowercase "html" until a test caught it.
 * Anything not listed is shown as typed, which is the right fallback for a
 * language we do not highlight either.
 */
const DISPLAY_NAMES: Record<string, string> = {
  bash: 'Bash',
  sh: 'Bash',
  shell: 'Shell',
  zsh: 'Bash',
  console: 'Shell',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cc: 'C++',
  hpp: 'C++',
  csharp: 'C#',
  cs: 'C#',
  css: 'CSS',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  jsx: 'JSX',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSON',
  markdown: 'Markdown',
  md: 'Markdown',
  python: 'Python',
  py: 'Python',
  sql: 'SQL',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  tsx: 'TSX',
  xml: 'XML',
  html: 'HTML',
  htm: 'HTML',
  svg: 'SVG',
  yaml: 'YAML',
  yml: 'YAML',
}

/**
 * The label for a fence's language class, or '' when there is nothing useful
 * to say. An untagged fence gets no label rather than a guess or a "text"
 * badge that adds nothing.
 */
export function codeLanguageLabel(className: string | undefined): string {
  const match = /language-([\w+#-]+)/.exec(className || '')
  if (!match) return ''
  const name = match[1].toLowerCase()
  if (name === 'text' || name === 'plaintext' || name === 'plain') return ''
  return DISPLAY_NAMES[name] ?? name
}
