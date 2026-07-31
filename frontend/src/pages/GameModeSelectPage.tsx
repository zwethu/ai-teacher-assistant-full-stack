import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, PuzzlePiece, LinkSimple, Basket, PawPrint, Fish } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { GameMode, GameSession, AvatarType } from '../types/catGame.types';
import { saveGameModeChoice } from '../lib/gameSession';
import CatSprite from '../components/cat/CatSprite';
import MusicToggle from '../components/cat/MusicToggle';
import { useMusic } from '../components/cat/useMusic';
import './GameModeSelectPage.css';

type Props = {
  session: GameSession;
  nickname: string;
  playerUid: string;
  avatar: AvatarType;
  /** Back to the buddy picker. Omitted where nothing precedes this screen. */
  onBack?: () => void;
};

const MODES: { mode: GameMode; icon: Icon; label: string; desc: string }[] = [
  {
    mode: 'matching',
    icon: PuzzlePiece,
    label: 'Match & Treat',
    desc: 'Flip cards and match each term with its definition. Your buddy loves a good memory game!',
  },
  {
    mode: 'ropelink',
    icon: LinkSimple,
    label: 'Rope & Link',
    desc: 'Draw a rope to connect each term on the left to its definition on the right.',
  },
  {
    mode: 'bucket',
    icon: Basket,
    label: 'Fill the Bucket',
    desc: 'Drag each item into the bucket it belongs to. Sort them all, then submit!',
  },
];

export default function GameModeSelectPage({
  session,
  nickname,
  playerUid,
  avatar,
  onBack,
}: Props) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<GameMode | null>(null);
  const [loading, setLoading] = useState(false);
  useMusic(avatar);

  async function handleStart() {
    if (!selected) return;
    setLoading(true);
    try {
      await saveGameModeChoice(session.id, selected);
    } catch (e) {
      console.error('Could not save mode choice:', e);
    } finally {
      setLoading(false);
      // Carry the query string across: `?demo=1` is set on the entry URL, but
      // the game is a fresh path, so without this the flag is lost by the time
      // CatGame reads it.
      navigate(`/play/${session.id}/game${window.location.search}`, {
        state: { session, nickname, playerUid, chosenGameMode: selected, chosenAvatar: avatar },
      });
    }
  }

  return (
    <div className={`mode-select-bg theme-${avatar}`}>
      <div className="mode-select-card">
        {onBack && (
          <button
            type="button"
            className="play-back-btn"
            onClick={onBack}
            disabled={loading}
            aria-label="Back to buddy select"
            title="Back to buddy select"
          >
            <ArrowLeft size={18} weight="bold" />
          </button>
        )}
        <MusicToggle />
        <CatSprite mood="playful" species={avatar} />
        <h2 className="mode-select-title">How do you want to play, {nickname}?</h2>
        <p className="mode-select-subtitle">
          Pick a game mode — your {avatar} is ready! <PawPrint size={16} weight="fill" />
        </p>

        <div className="mode-select-grid">
          {MODES.map(({ mode, icon: Icon, label, desc }) => (
            <button
              key={mode}
              className={`mode-option-card mode-option-card--${mode} ${
                selected === mode ? 'mode-option-card--selected' : ''
              }`}
              onClick={() => setSelected(mode)}
            >
              <Icon size={44} weight="duotone" className="mode-option-icon" />
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
          {loading ? 'Starting...' : <>Let's Go! <Fish size={20} weight="duotone" /></>}
        </button>
      </div>
    </div>
  );
}
