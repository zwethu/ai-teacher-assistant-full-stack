import { useCallback, type ReactNode } from 'react'

import { useAuth } from '../../hooks/useAuth'
import { useTermsAcceptance } from '../../hooks/useTermsAcceptance'
import { confirm } from '../ui/confirmStore'
import LoadingScreen from '../ui/LoadingScreen'
import { TermsAcceptanceDialog } from './TermsAcceptanceDialog'

/**
 * Holds the teacher app shut until this account has accepted the current
 * terms. Mounted inside ProtectedRoute, so by the time it runs "signed in"
 * and "is a lecturer" are already answered.
 *
 * The gate REPLACES its children rather than overlaying them: while checking
 * or blocked, nothing behind it mounts — no flash of app content, and no
 * page-level Firestore queries fire behind the dialog. On accept the children
 * mount fresh while the dialog animates out above them.
 *
 * 'unavailable' (the read failed or timed out) admits the lecturer — see the
 * fail-open reasoning in useTermsAcceptance before changing that.
 */
export function TermsGate({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth()
  const { status, accept, accepting, writeError } = useTermsAcceptance(user?.uid)

  const decline = useCallback(async () => {
    const declined = await confirm({
      title: 'Decline the terms?',
      body: "You'll be signed out of MILA. You can come back and accept any time.",
      confirmLabel: 'Decline and sign out',
      cancelLabel: 'Keep reading',
    })
    /* No navigation needed: signOut clears `user`, and ProtectedRoute then
       redirects to /login on its own. */
    if (declined) await signOut()
  }, [signOut])

  if (status === 'checking') {
    /* Same canvas as ProtectedRoute's "Signing you in…", so the check reads
       as a continuation of sign-in rather than a second interstitial. */
    return <LoadingScreen label="Just a moment…" />
  }

  return (
    <>
      {status === 'required' ? null : children}
      <TermsAcceptanceDialog
        open={status === 'required'}
        accepting={accepting}
        writeError={writeError}
        onAccept={accept}
        onDecline={decline}
      />
    </>
  )
}
