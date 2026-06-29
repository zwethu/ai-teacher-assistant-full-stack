import { db } from './firebase';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  increment,
  updateDoc,
} from 'firebase/firestore';
import type { GameSession, PlayerProfile, AttemptResult, GameMode } from '../types/catGame.types';

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

export async function saveAttempt(result: AttemptResult): Promise<void> {
  const attemptId = `${result.assessmentId}_${result.playerUid}`;
  const ref = doc(db, 'attempts', attemptId);
  await setDoc(ref, { ...result, completedAt: serverTimestamp() });
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
