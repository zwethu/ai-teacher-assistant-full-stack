// @vitest-environment jsdom

import { useRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SCROLLBAR_GUTTER_VAR, useScrollbarGutter } from './useScrollbarGutter'

afterEach(() => cleanup())

function container(offsetWidth: number, clientWidth: number): HTMLElement {
  const node = document.createElement('div')
  Object.defineProperty(node, 'offsetWidth', { value: offsetWidth })
  Object.defineProperty(node, 'clientWidth', { value: clientWidth })
  return node
}

function Probe({ node }: { node: HTMLElement }) {
  const ref = useRef<HTMLElement | null>(node)
  useScrollbarGutter(ref)
  return null
}

function published(): string {
  return document.documentElement.style.getPropertyValue(SCROLLBAR_GUTTER_VAR)
}

describe('useScrollbarGutter', () => {
  it('publishes the container\'s real gutter, not a hardcoded width', () => {
    // A Firefox `thin` scrollbar is not the 10px `::-webkit-scrollbar` width,
    // and insetting the composer band by the wrong number is what left the
    // thumb painted over.
    render(<Probe node={container(300, 288)} />)
    expect(published()).toBe('12px')
  })

  it('reports nothing to reserve for overlay scrollbars', () => {
    // macOS and Chromium's overlay mode take no width. Insetting the band on
    // those would leave a strip of the conversation unfrosted for nothing.
    render(<Probe node={container(300, 300)} />)
    expect(published()).toBe('0px')
  })

  it('falls back to the stylesheet when the transcript goes away', () => {
    const { unmount } = render(<Probe node={container(300, 288)} />)
    expect(published()).toBe('12px')
    unmount()
    // Not a stale measurement from a container that no longer exists — and
    // this must hold even where ResizeObserver is unavailable, as in jsdom.
    expect(published()).toBe('')
  })
})
