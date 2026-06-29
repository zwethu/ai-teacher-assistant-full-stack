import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GameMode, GameSession } from '../types/catGame.types';
import { saveGameModeChoice } from '../lib/gameSession';
import CatSprite from '../components/cat/CatSprite';
import './GameModeSelectPage.css';

type Props = {
  session: GameSession;
  nickname: string;
  playerUid: string;
};

const MODES: { mode: GameMode; emoji: string; label: string; desc: string }[] = [
  {
    mode: 'mcq',
    emoji: '📝',
    label: 'Pet & Choose',
    desc: 'Read a question and pick the right answer. Feed your cat fish for every correct answer!',
  },
  {
    mode: 'matching',
    emoji: '🃏',
    label: 'Match & Treat',
    desc: 'Flip cards and match each term with its definition. Your cat loves a good memory game!',
  },
  {
    mode: 'ropelink',
    emoji: '🪢',
    label: 'Rope & Link',
    desc: 'Draw a rope to connect each term on the left to its answer on the right.',
  },
];

export default function GameModeSelectPage({ session, nickname, playerUid }: Props) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<GameMode | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleStart() {
    if (!selected) return;
    setLoading(true);
    try {
      await saveGameModeChoice(session.id, selected);
    } catch (e) {
      console.error('Could not save mode choice:', e);
    } finally {
      setLoading(false);
      navigate(`/play/${session.id}/game`, {
        state: { session, nickname, playerUid, chosenGameMode: selected },
      });
    }
  }

  return (
    <div className="mode-select-bg">
      <div className="mode-select-card">
        <CatSprite mood="playful" />
        <h2 className="mode-select-title">How do you want to play, {nickname}?</h2>
        <p className="mode-select-subtitle">Pick a game mode — your cat is ready! 🐾</p>

        <div className="mode-select-grid">
          {MODES.map(({ mode, emoji, label, desc }) => (
            <button
              key={mode}
              className={`mode-option-card ${
                selected === mode ? 'mode-option-card--selected' : ''
              }`}
              onClick={() => setSelected(mode)}
            >
              <span className="mode-option-emoji">{emoji}</span>
              <span className="mode-option-label">{label}</span>
              <span className="mode-option-desc">{desc}</span>
            </button>
          ))}
        </div>

        <button
          className="mode-start-btn"
          onClick={handleStart}
          disabled={!selected || loading}
        >
          {loading ? 'Starting...' : 'Let\'s Go! 🐟'}
        </button>
      </div>
    </div>
  );
}
