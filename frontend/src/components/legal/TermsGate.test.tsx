// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TermsGate } from './TermsGate'
import { TERMS_VERSION } from './TermsDocument'
import { getTermsAcceptance } from '../../services/termsService'

/* Both mocks exist to keep lib/firebase.ts out of the module graph — there is
   no vitest setup file, so a real import would run initializeApp() against
   undefined env vars. */
vi.mock('../../services/termsService', () => ({
  getTermsAcceptance: vi.fn(),
  acceptTerms: vi.fn(),
}))

const signOut = vi.fn()
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'lecturer-1' }, loading: false, signOut }),
}))

const mockRead = vi.mocked(getTermsAcceptance)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderGate() {
  render(
    <TermsGate>
      <p>the teacher app</p>
    </TermsGate>,
  )
}

const app = () => screen.queryByText('the teacher app')
const dialog = () => screen.queryByRole('alertdialog')

describe('TermsGate', () => {
  /**
   * The no-flash guarantee: while the acceptance read is in flight the
   * children must be absent from the DOM entirely — not hidden behind an
   * overlay — so no page-level Firestore query fires behind the gate.
   */
  it('renders neither app nor dialog while checking', () => {
    mockRead.mockReturnValue(new Promise(() => {})) // never settles
    renderGate()
    expect(app()).toBeNull()
    expect(dialog()).toBeNull()
    expect(screen.getByText('Just a moment…')).toBeTruthy()
  })

  it('blocks with the dialog, and without the app, when nothing is on record', async () => {
    mockRead.mockResolvedValue({ version: null, acceptedAt: null })
    renderGate()
    await screen.findByRole('alertdialog')
    expect(app()).toBeNull()
  })

  it('lets an accepted account straight through', async () => {
    mockRead.mockResolvedValue({ version: TERMS_VERSION, acceptedAt: null })
    renderGate()
    await waitFor(() => expect(app()).toBeTruthy())
    expect(dialog()).toBeNull()
  })

  it('re-fires for an acceptance of an older version', async () => {
    mockRead.mockResolvedValue({ version: '2020-01', acceptedAt: null })
    renderGate()
    await screen.findByRole('alertdialog')
    expect(app()).toBeNull()
  })

  /**
   * Fail OPEN on a failed read — locked in by test on purpose. This is a
   * consent record, not an authorization control; the lecturer claim, the
   * API's require_lecturer, and the Firestore rules still hold. Failing
   * closed would turn any Firestore blip into a total outage for every
   * lecturer. Do not "fix" this into a lockout — see useTermsAcceptance.
   */
  it('admits the lecturer when the read fails', async () => {
    mockRead.mockRejectedValue(new Error('offline'))
    renderGate()
    await waitFor(() => expect(app()).toBeTruthy())
    expect(dialog()).toBeNull()
  })
})
