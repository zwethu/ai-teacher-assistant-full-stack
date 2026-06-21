import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  getGameSession,
  checkStudentAccess,
  getPlayerProfile,
  createPlayerProfile,
  hasAttempted,
} from '../lib/gameSession';
import type { GameSession } from '../types/catGame.types';
import CatSprite from '../components/cat/CatSprite';
import './PlayEntryPage.css';

type FlowStep =
  | 'loading'
  | 'invalid'
  | 'unavailable'
  | 'login'
  | 'checking_access'
  | 'not_enrolled'
  | 'nickname'
  | 'already_played'
  | 'ready';

export default function PlayEntryPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<FlowStep>('loading');
  const [session, setSession] = useState<GameSession | null>(null);
  const [nickname, setNickname] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userUid, setUserUid] = useState('');

  // Step 1: Load game session
  useEffect(() => {
    if (!assessmentId) { setStep('invalid'); return; }
    getGameSession(assessmentId)
      .then(s => {
        if (!s) { setStep('invalid'); return; }
        if (s.status !== 'open') { setStep('unavailable'); return; }
        setSession(s);
        const unsubscribe = auth.onAuthStateChanged(user => {
          if (user && user.email) {
            setUserEmail(user.email);
            setUserUid(user.uid);
            handlePostLogin(s, user.uid, user.email);
          } else {
            setStep('login');
          }
        });
        return unsubscribe;
      })
      .catch(() => setStep('invalid'));
  }, [assessmentId]);

  async function handlePostLogin(s: GameSession, uid: string, email: string) {
    setStep('checking_access');
    try {
      const allowed = await checkStudentAccess(s.batchId, email);
      if (!allowed) { setStep('not_enrolled'); return; }

      const already = await hasAttempted(s.id, uid);
      if (already) { setStep('already_played'); return; }

      const profile = await getPlayerProfile(uid);
      if (!profile || !profile.nickname) {
        setStep('nickname');
      } else {
        setNickname(profile.nickname);
        setStep('ready');
      }
    } catch {
      setStep('invalid');
    }
  }

  async function handleGoogleSignIn() {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      if (!user.email || !session) return;
      setUserEmail(user.email);
      setUserUid(user.uid);
      handlePostLogin(session, user.uid, user.email);
    } catch {
      // user cancelled
    }
  }

  async function handleNicknameSubmit() {
    const trimmed = nicknameInput.trim();
    if (!trimmed) { setNicknameError('Please enter a nickname 🐱'); return; }
    if (trimmed.length < 2) { setNicknameError('At least 2 characters please!'); return; }
    if (trimmed.length > 20) { setNicknameError('Max 20 characters!'); return; }
    setSaving(true);
    try {
      await createPlayerProfile(userUid, trimmed, userEmail);
      setNickname(trimmed);
      setStep('ready');
    } catch {
      setNicknameError('Something went wrong, try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleEnterGame() {
    if (!session) return;
    navigate(`/play/${assessmentId}/game`, {
      state: {
        session,
        nickname,
        playerUid: userUid,
      },
    });
  }

  async function handleSignOut() {
    await signOut(auth);
    setStep('login');
    setUserEmail('');
    setUserUid('');
  }

  // ─── Render ──────────────────────────────────────────────────

  if (step === 'loading' || step === 'checking_access') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="idle" />
          <p className="play-loading-text">{
            step === 'loading' ? 'Loading your adventure...' : 'Checking access...'
          }</p>
          <div className="play-spinner" />
        </div>
      </div>
    );
  }

  if (step === 'invalid') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="confused" />
          <h2 className="play-title">Oops!</h2>
          <p className="play-subtitle">This assessment link is invalid or doesn't exist.</p>
          <p className="play-hint">Ask your teacher for the correct link 🐾</p>
        </div>
      </div>
    );
  }

  if (step === 'unavailable') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="sleeping" />
          <h2 className="play-title">Not Available</h2>
          <p className="play-subtitle">This assessment is closed or has expired.</p>
          <p className="play-hint">Contact your teacher if you think this is a mistake 🐾</p>
        </div>
      </div>
    );
  }

  if (step === 'not_enrolled') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="confused" />
          <h2 className="play-title">Not Enrolled</h2>
          <p className="play-subtitle">Your email <strong>{userEmail}</strong> is not in this class.</p>
          <p className="play-hint">Make sure you're signed in with your school email 🐾</p>
          <button className="play-secondary-btn" onClick={handleSignOut}>
            Sign in with a different account
          </button>
        </div>
      </div>
    );
  }

  if (step === 'already_played') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="happy" />
          <h2 className="play-title">Already Played!</h2>
          <p className="play-subtitle">You've already completed this assessment.</p>
          <p className="play-hint">Each assessment can only be played once 🐾</p>
        </div>
      </div>
    );
  }

  if (step === 'login') {
    return (
      <div className="play-entry-bg">
        <div className="play-entry-scene">
          <div className="play-scene-deco left">🌿</div>
          <div className="play-scene-deco right">🌿</div>
        </div>
        <div className="play-card">
          <CatSprite mood="idle" />
          <h2 className="play-title">Welcome, Scholar!</h2>
          <p className="play-subtitle">Sign in to begin your study adventure 🐾</p>
          <button className="play-google-btn" onClick={handleGoogleSignIn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
          <p className="play-footer-hint">Your adventure awaits, brave scholar ✨</p>
        </div>
      </div>
    );
  }

  if (step === 'nickname') {
    return (
      <div className="play-entry-bg">
        <div className="play-card">
          <CatSprite mood="idle" />
          <h2 className="play-title">What's your name?</h2>
          <p className="play-subtitle">Choose a nickname — your cat will remember it! 🐾</p>
          <div className="play-input-wrap">
            <input
              className="play-nickname-input"
              type="text"
              placeholder="e.g. StarStudent, Zwe..."
              value={nicknameInput}
              onChange={e => { setNicknameInput(e.target.value); setNicknameError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleNicknameSubmit()}
              maxLength={20}
              autoFocus
            />
            {nicknameError && <p className="play-input-error">{nicknameError}</p>}
          </div>
          <button
            className="play-primary-btn"
            onClick={handleNicknameSubmit}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Let\'s Go! 🐾'}
          </button>
        </div>
      </div>
    );
  }

  // step === 'ready'
  return (
    <div className="play-entry-bg">
      <div className="play-card">
        <CatSprite mood="playful" />
        <h2 className="play-title">Ready, {nickname}!</h2>
        <p className="play-subtitle">
          {session?.gameMode === 'mcq'
            ? '🐾 Answer questions to earn fish for your cat!'
            : '🧩 Match the pairs and earn fish!'}
        </p>
        <div className="play-mode-badge">
          {session?.gameMode === 'mcq' ? '📝 Multiple Choice' : '🃏 Card Matching'}
        </div>
        <button className="play-primary-btn" onClick={handleEnterGame}>
          Start Game 🐟
        </button>
      </div>
    </div>
  );
}
