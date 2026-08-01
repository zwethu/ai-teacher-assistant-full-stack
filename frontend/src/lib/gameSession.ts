import { auth, db } from './firebase';
import {
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  increment,
  updateDoc,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import type { GameSession, PlayerProfile, AttemptResult, StoredAttempt, GameMode, TimedRun } from '../types/catGame.types';

// ─── Game Session ───────────────────────────────────────────────

export async function getGameSession(assessmentId: string): Promise<GameSession | null> {
  const ref = doc(db, 'gameSessions', assessmentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as GameSession;
}

// ─── Batch Access Check ─────────────────────────────────────────

export async function checkStudentAccess(
  batchId: string,
  email: string
): Promise<boolean> {
  const studentsRef = collection(db, 'batches', batchId, 'students');
  const q = query(studentsRef, where('email', '==', email));
  const snap = await getDocs(q);
  return !snap.empty;
}

// ─── Player Profile ─────────────────────────────────────────────

export async function getPlayerProfile(uid: string): Promise<PlayerProfile | null> {
  const ref = doc(db, 'players', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as PlayerProfile;
}

export async function createPlayerProfile(
  uid: string,
  nickname: string,
  email: string
): Promise<void> {
  const ref = doc(db, 'players', uid);
  await setDoc(ref, { uid, nickname, email, createdAt: serverTimestamp() });
}

// ─── Timed run (the countdown's anchor) ─────────────────────────
// The clock has to live on the server. A purely local `Date.now()` start means
// a refresh restarts the countdown and winding the OS clock back freezes it —
// either way the time limit stops being a limit, and duration is one of the
// behavioural signals the assessment is actually built on.
//
// So the first load of a run stamps `startedAt` with the SERVER's clock, and
// every later load reads that same stamp back. The transaction is what makes
// it once-only: a plain get-then-set would let two tabs opened together both
// see "no doc" and both write, handing back a fresh start time.

/** Marks now on the run doc and reads it back resolved, giving us the server's
 *  current time. Only the round-trip can tell us this — `serverTimestamp()` is
 *  a sentinel that means nothing until the server swaps it for a real value. */
function readRunTimes(data: Record<string, unknown>): TimedRun | null {
  const startedAt = data.startedAt;
  const seenAt    = data.lastSeenAt;
  if (!(startedAt instanceof Timestamp) || !(seenAt instanceof Timestamp)) return null;
  return { startedAtMs: startedAt.toMillis(), serverNowMs: seenAt.toMillis() };
}

/**
 * Starts (or resumes) a player's run and returns the server's view of it:
 * when it began, and what time it is now. Both come from the server clock, so
 * the caller can work out how much time is genuinely left regardless of what
 * the device thinks the time is.
 *
 * Returns null if the round-trip fails — see the caller for what that means.
 */
export async function startTimedRun(
  assessmentId: string,
  playerUid: string,
): Promise<TimedRun | null> {
  const ref = doc(db, 'gameRuns', `${assessmentId}_${playerUid}`);

  await runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      // Resuming. startedAt is deliberately untouched — rewriting it here is
      // exactly the reset this function exists to prevent.
      tx.update(ref, { lastSeenAt: serverTimestamp() });
    } else {
      tx.set(ref, {
        assessmentId,
        playerUid,
        startedAt:  serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      });
    }
  });

  // getDocFromServer, not getDoc: getDoc can answer from the local cache, and
  // the cache holds the unresolved sentinel we just wrote.
  const snap = await getDocFromServer(ref);
  return snap.exists() ? readRunTimes(snap.data()) : null;
}

// ─── Attempt ────────────────────────────────────────────────────

export async function hasAttempted(
  assessmentId: string,
  playerUid: string
): Promise<boolean> {
  const attemptId = `${assessmentId}_${playerUid}`;
  const ref = doc(db, 'attempts', attemptId);
  const snap = await getDoc(ref);
  return snap.exists();
}

// Reads back a saved attempt so a student can re-issue their certificate
// (e.g. they lost the PNG). Returns null if they never played.
export async function getAttempt(
  assessmentId: string,
  playerUid: string
): Promise<StoredAttempt | null> {
  const attemptId = `${assessmentId}_${playerUid}`;
  const ref = doc(db, 'attempts', attemptId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as StoredAttempt;
}

export async function saveAttempt(result: Omit<AttemptResult, 'email'>): Promise<void> {
  const attemptId = `${result.assessmentId}_${result.playerUid}`;
  const ref = doc(db, 'attempts', attemptId);
  // Email is taken from the session rather than passed down: an attempt is by
  // definition the signed-in player's, and threading the address through the
  // avatar picker, the mode picker, the route state and the game engine to
  // reach this line would be four files of plumbing for a value already here.
  const email = auth.currentUser?.email ?? '';
  await setDoc(ref, { ...result, email, completedAt: serverTimestamp() });
}

// ─── Game Mode Choice Stats ──────────────────────────────────────
// Increments the counter for the chosen mode on the session document.
// Uses Firestore increment so concurrent writes are safe.

export async function saveGameModeChoice(
  assessmentId: string,
  mode: GameMode
): Promise<void> {
  const ref = doc(db, 'gameSessions', assessmentId);
  await updateDoc(ref, {
    [`gameModeStats.${mode}`]: increment(1),
  });
}
