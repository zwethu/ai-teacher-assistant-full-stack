import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync('src/pages/batches/components/PlanningTab.tsx', 'utf8')

/** Every `className="…"` literal in the file. */
const classStrings = [...source.matchAll(/className="([^"]*)"/g)].map((m) => m[1])

describe('the planning tab', () => {
  /**
   * The black rule across the top of the generation card, and the black boxes
   * around every field in the blueprint editor.
   *
   * Tailwind v4 changed the default `border-color` from v3's `gray-200` to
   * `currentColor`. So a bare `border` / `border-b`, which was a light hairline
   * for the whole of v3, silently became a near-black rule inheriting the text
   * colour the moment this project moved to v4. Nothing failed and nothing
   * warned; the borders simply turned black.
   */
  it('never writes a border without a colour', () => {
    const uncoloured = classStrings.filter(
      (cls) =>
        /(^|\s)border(-[btlrxy])?(\s|$)/.test(cls) &&
        !/border-(slate|violet|red|amber|emerald|sky|gold|white|transparent)/.test(cls),
    )
    expect(uncoloured).toEqual([])
  })

  /**
   * The generation card's own fields were hand-written — different padding
   * from every other form in the app and no focus treatment at all, so they
   * fell back to the browser's black outline.
   */
  it('builds its fields from the shared control style', () => {
    expect(source).toContain("from '../../../components/ui/fieldStyles'")
    // No hand-rolled control left: a `rounded-md border border-slate-300`
    // input is the shape `FIELD_CLASS` exists to stop being re-typed.
    expect(source).not.toMatch(/className="[^"]*rounded-md border border-slate-300[^"]*"/)
  })
})
