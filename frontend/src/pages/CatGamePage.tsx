import { useLocation, useNavigate } from 'react-router-dom';
import CatGame from '../components/cat/CatGame';
import type { GameSession, GameMode } from '../types/catGame.types';

type LocationState = {
  session: GameSession;
  nickname: string;
  playerUid: string;
  chosenGameMode: GameMode;   // set by GameModeSelectPage
};

export default function CatGamePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState | null;

  if (!state?.session || !state?.chosenGameMode) {
    return (
      <div style={{
        width: '100vw', height: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Nunito, sans-serif', background: '#fef9f0',
        flexDirection: 'column', gap: '12px'
      }}>
        <div style={{ fontSize: '4rem' }}>🐱</div>
        <p style={{ fontWeight: 800, color: '#8b5e52' }}>No game session found.</p>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'linear-gradient(135deg,#f4a261,#e76f51)',
            color: 'white', border: 'none', borderRadius: '20px',
            padding: '10px 28px', fontWeight: 800, cursor: 'pointer', fontSize: '0.95rem'
          }}
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <CatGame
        gameMode={state.chosenGameMode}
        items={state.session.items}
        nickname={state.nickname}
        playerUid={state.playerUid}
        assessmentId={state.session.id}
      />
    </div>
  );
}
