// @vitest-environment jsdom

import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Login from './Login'

const signInWithGoogle = vi.fn()

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false, signInWithGoogle }),
}))


afterEach(() => cleanup())

function renderLogin() {
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

/**
 * The OAuth scopes the backend requests are the contract this page has to keep.
 * Asking for something the sign-in panel never mentioned is a consent problem,
 * not a copy problem — Google Drive was requested and undisclosed until this
 * page was rebuilt.
 */
// Google Calendar is deliberately absent: scheduling is not implemented, so
// the calendar.events scope was dropped from the backend too. Re-add both
// together or not at all.
const REQUESTED_SERVICES = [
  'Google Docs',      // documents
  'Google Drive',     // drive.file
  'Google Forms',     // forms.body, forms.responses.readonly
  'Gmail',            // gmail.compose, gmail.send
]

describe('Login', () => {
  it('discloses every Google service the backend asks consent for', () => {
    renderLogin()
    for (const service of REQUESTED_SERVICES) {
      // Named in the permissions panel, so nothing on the consent screen is a
      // surprise. See backend/utils/google_credentials.py for the scope list.
      expect(screen.getAllByText(service).length, `${service} is not disclosed`).toBeGreaterThan(0)
    }
  })

  it('signs in with Google', () => {
    renderLogin()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('reads the brand name as one word despite the gold I', () => {
    // The letters are split so the I can be gold; without the hidden label a
    // screen reader would be free to spell the name out.
    renderLogin()
    expect(screen.getAllByText('MILA').length).toBeGreaterThan(0)
  })

  it('opens terms and about', () => {
    renderLogin()

    fireEvent.click(screen.getByRole('button', { name: 'Terms and conditions' }))
    expect(screen.getByText(/By using MILA/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

    fireEvent.click(screen.getByRole('button', { name: 'About and contact' }))
    expect(screen.getByText(/MFU Intelligent Lecturer Assistant/)).toBeTruthy()
  })
})
