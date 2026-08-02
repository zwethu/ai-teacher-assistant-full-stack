// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SelectField, toOptions, type SelectOption } from './SelectField'

afterEach(cleanup)

const OPTIONS: SelectOption[] = [
  { value: 'st26', label: 'Software Testing 26', hint: 'Software Testing' },
  { value: 'db24', label: 'Databases 24', hint: 'Database Systems' },
  { value: 'ai25', label: 'Machine Learning 25', hint: 'Artificial Intelligence' },
]

/** Controlled wrapper, since the component owns none of its value. */
function Harness({
  options = OPTIONS,
  initial = 'st26',
  onChange,
}: {
  options?: SelectOption[]
  initial?: string
  onChange?: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <SelectField
      label="Space"
      value={value}
      options={options}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
    />
  )
}

/* No jest-dom in this project, so assertions read the DOM directly rather than
   through `toHaveValue` / `toHaveAttribute`. */
const field = () => screen.getByRole('combobox', { name: 'Space' }) as HTMLInputElement
const options = () => within(screen.getByRole('listbox')).getAllByRole('option')
const isOpen = () => screen.queryByRole('listbox') !== null

describe('SelectField', () => {
  it('shows the selected option and no popup until asked', () => {
    render(<Harness />)
    expect(field().value).toBe('Software Testing 26')
    expect(isOpen()).toBe(false)
    expect(field().getAttribute('aria-expanded')).toBe('false')
  })

  it('opens on click and marks the current value selected', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())

    expect(field().getAttribute('aria-expanded')).toBe('true')
    const rows = options()
    expect(rows).toHaveLength(3)
    expect(rows[0].getAttribute('aria-selected')).toBe('true')
    expect(rows[1].getAttribute('aria-selected')).toBe('false')
  })

  /**
   * The whole point of the rewrite: a native `<select>` cannot do this, and it
   * is why the trigger is an input rather than a button.
   */
  it('narrows the list as you type, matching the label', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())
    await user.keyboard('data')

    const rows = options()
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Databases 24')
  })

  it('matches the hint too, so a course name finds its cohort', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())
    // Appears only in the hint — no option is labelled "Artificial".
    await user.keyboard('artificial')

    expect(options()).toHaveLength(1)
    expect(options()[0].textContent).toContain('Machine Learning 25')
  })

  it('says so rather than showing an empty box when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())
    await user.keyboard('zzz')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matches')).toBeTruthy()
  })

  it('commits a click and closes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(field())
    await user.click(screen.getByRole('option', { name: /Databases 24/ }))

    expect(onChange).toHaveBeenCalledWith('db24')
    expect(field().value).toBe('Databases 24')
    expect(isOpen()).toBe(false)
  })

  it('picks with the keyboard alone', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    field().focus()
    // The first ArrowDown opens without moving — the cursor starts on the
    // current value — so the second is what steps to the next option.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('db24')
  })

  /**
   * Tabbing through a form must not leave a trail of open dropdowns behind it.
   * A native select does not open on focus either; keyboard users get
   * ArrowDown and type-to-open in its place.
   */
  it('does not open merely because it has focus', () => {
    render(<Harness />)
    field().focus()
    expect(isOpen()).toBe(false)
  })

  /**
   * Closed, the field displays the selected *label*, so a keystroke landing in
   * it would append to that label — "Software Testing 26d" matches nothing.
   * The first character has to become the whole query.
   */
  it('opens on a printable key and searches for just that key', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    field().focus()
    await user.keyboard('d')

    expect(isOpen()).toBe(true)
    expect(field().value).toBe('d')
    expect(options()).toHaveLength(1)
    expect(options()[0].textContent).toContain('Databases 24')
  })

  /** Opening on the current value is what makes open-then-Enter a no-op. */
  it('starts the cursor on the selected option, not the top of the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="ai25" onChange={onChange} />)
    await user.click(field())
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('ai25')
  })

  it('wraps past the end of the list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial="ai25" onChange={onChange} />)
    field().focus()
    // Opens on the last option, then wraps past the end to the first.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('st26')
  })

  it('closes on Escape without changing anything', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(field())
    await user.keyboard('{ArrowDown}{Escape}')

    expect(onChange).not.toHaveBeenCalled()
    expect(field().value).toBe('Software Testing 26')
  })

  /**
   * Escape discards the query as well as the popup — a field left showing a
   * half-typed filter that no longer selects anything would be lying about its
   * own value.
   */
  it('restores the selected label after an abandoned search', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())
    await user.keyboard('data{Escape}')

    expect(field().value).toBe('Software Testing 26')
  })

  it('closes when the pointer goes down outside it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>,
    )
    await user.click(field())
    expect(isOpen()).toBe(true)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }))
    expect(isOpen()).toBe(false)
  })

  /**
   * Enter inside an open popup picks an option; Enter on a closed field has to
   * reach the form, or the dropdown would silently break submit-on-Enter for
   * every form it sits in.
   */
  it('lets Enter submit the form when it is closed', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Harness />
      </form>,
    )
    // Not via focus, which opens it — this is the closed case.
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(isOpen()).toBe(false)

    await user.click(field())
    await user.keyboard('{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('points aria-activedescendant at the cursor row', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(field())
    await user.keyboard('{ArrowDown}')

    const active = field().getAttribute('aria-activedescendant')
    expect(active).toBeTruthy()
    expect(document.getElementById(active as string)?.textContent).toContain('Databases 24')
  })

  it('cannot be opened while disabled', async () => {
    const user = userEvent.setup()
    render(
      <SelectField label="Space" value="st26" options={OPTIONS} onChange={vi.fn()} disabled />,
    )
    await user.click(field()).catch(() => {})
    expect(isOpen()).toBe(false)
  })

  /**
   * The list can shrink from outside while it is open — `batches` finishing its
   * fetch, or an artifact list dropping a week. A cursor left past the new end
   * makes Enter commit nothing at all, so it has to be pulled back in.
   *
   * Deliberately driven by the `options` prop rather than by typing: the change
   * handler already resets the cursor on every keystroke, so a typing-based
   * version of this test passes with the clamp deleted.
   */
  it('keeps the cursor inside a list that has just shrunk', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <SelectField label="Space" value="st26" options={OPTIONS} onChange={onChange} />,
    )
    await user.click(field())
    await user.keyboard('{ArrowDown}{ArrowDown}')

    rerender(
      <SelectField label="Space" value="st26" options={OPTIONS.slice(0, 2)} onChange={onChange} />,
    )
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('db24')
  })
})

describe('toOptions', () => {
  it('uses the value as the label by default', () => {
    expect(toOptions(['a', 'b'])).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
    ])
  })

  it('relabels without touching the value the form submits', () => {
    expect(toOptions(['case_based'], (t) => t.replace(/_/g, ' '))).toEqual([
      { value: 'case_based', label: 'case based' },
    ])
  })
})
