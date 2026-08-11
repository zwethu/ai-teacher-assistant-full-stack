import { useCallback, useEffect, useState } from 'react'

import { acceptTerms, getTermsAcceptance } from '../services/termsService'
import { TERMS_VERSION } from '../components/legal/TermsDocument'

/**
 * Whether this account has accepted the current terms, and the means to.
 *
 *  - 'checking'    — the one-shot read is in flight; show nothing behind it.
 *  - 'required'    — no acceptance on record for TERMS_VERSION; block the app.
 *  - 'accepted'    — recorded; let the app through.
 *  - 'unavailable' — the read failed or timed out; let the app through.
 *
 * **'unavailable' fails OPEN, on purpose.** This is a consent record, not an
 * authorization control — the security boundary is the lecturer custom claim,
 * `require_lecturer` on the API, and the Firestore rules, none of which this
 * gate touches. Failing closed would turn any Firestore blip, ad blocker, or
 * read-quota exhaustion into a total outage for every lecturer, to protect
 * nothing. Contrast `readLecturerClaim` in AuthContext, which fails closed and
 * is right to: that one IS authorization. Do not "fix" this into a lockout.
 *
 * A one-shot `getDoc`, not a listener — this is a once-per-session question.
 */

type TermsStatus = 'checking' | 'accepted' | 'required' | 'unavailable'

/* Shorter than useUserCollection's 15s: this read blocks the whole app, not
   one page. An offline getDoc can hang indefinitely without the timeout. */
const CHECK_TIMEOUT_MS = 10_000

export function useTermsAcceptance(uid: string | undefined) {
  const [status, setStatus] = useState<TermsStatus>('checking')
  const [accepting, setAccepting] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) {
      setStatus('checking')
      return undefined
    }

    setStatus('checking')

    /* `settled` guards the timeout/read race; `cancelled` guards the unmount —
       a promise has no unsubscribe, so without it a slow read would set state
       on a component that is gone. */
    let settled = false
    let cancelled = false
    const settle = (next: TermsStatus) => {
      if (settled || cancelled) return
      settled = true
      setStatus(next)
    }

    const timeoutId = window.setTimeout(() => {
      console.error('Terms acceptance check timed out; continuing without it.')
      settle('unavailable')
    }, CHECK_TIMEOUT_MS)

    getTermsAcceptance(uid)
      .then((stored) => {
        /* One comparison covers both "never accepted" and "version bumped". */
        settle(stored.version === TERMS_VERSION ? 'accepted' : 'required')
      })
      .catch((err) => {
        console.error('Could not read terms acceptance:', err)
        settle('unavailable')
      })

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [uid])

  /**
   * Record acceptance. Unlike the read, a failed WRITE keeps the gate shut —
   * admitting on a write known to have failed would silently produce an app
   * where nobody's consent is ever recorded. The dialog shows the error and
   * leaves Accept armed for a retry.
   */
  const accept = useCallback(async () => {
    if (!uid) return
    setAccepting(true)
    setWriteError(null)
    try {
      await acceptTerms(uid, TERMS_VERSION)
      setStatus('accepted')
    } catch (err) {
      console.error('Could not record terms acceptance:', err)
      setWriteError("Couldn't save your acceptance. Check your connection and try again.")
    } finally {
      setAccepting(false)
    }
  }, [uid])

  return { status, accept, accepting, writeError }
}
