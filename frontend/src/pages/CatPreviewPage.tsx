import { useState } from 'react';
import { PuzzlePiece, LinkSimple, Basket, PawPrint, GameController } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { AvatarType, GameMode } from '../types/catGame.types';
import AvatarSelectPage from './AvatarSelectPage';
import CatSprite from '../components/cat/CatSprite';
import CatGame from '../components/cat/CatGame';
import './GameModeSelectPage.css';

const MODES: { mode: GameMode; icon: Icon; label: string; desc: string }[] = [
  {
    mode: 'matching',
    icon: PuzzlePiece,
    label: 'Match & Treat',
    desc: 'Flip and pair each term with its definition. A cozy memory game!',
  },
  {
    mode: 'ropelink',
    icon: LinkSimple,
    label: 'Rope & Link',
    desc: 'Draw a rope from each term to its matching definition.',
  },
  {
    mode: 'bucket',
    icon: Basket,
    label: 'Fill the Bucket',
    desc: 'Drag each item into the bucket it belongs to, then submit!',
  },
];

// Dev-only preview: runs the full avatar → mode → game → result flow on mock
// data with no Firebase auth. No assessmentId is passed, so nothing is saved
// and "Play Again" is enabled.
export default function CatPreviewPage() {
  const [avatar, setAvatar] = useState<AvatarType | null>(null);
  const [selected, setSelected] = useState<GameMode | null>(null);
  const [mode, setMode] = useState<GameMode | null>(null);

  if (!avatar) {
    return <AvatarSelectPage nickname="Preview" onSelect={setAvatar} />;
  }

  if (!mode) {
    return (
      <div className="mode-select-bg">
        <div className="mode-select-card">
          <CatSprite mood="playful" species={avatar} />
          <h2 className="mode-select-title">How do you want to play?</h2>
          <p className="mode-select-subtitle">
            Pick a game mode — your buddy is ready! <PawPrint size={16} weight="fill" />
          </p>

          <div className="mode-select-grid mode-select-grid--two">
            {MODES.map(({ mode: m, icon: Icon, label, desc }) => (
              <button
                key={m}
                className={`mode-option-card mode-option-card--${m} ${
                  selected === m ? 'mode-option-card--selected' : ''
                }`}
                onClick={() => setSelected(m)}
              >
                <Icon size={44} weight="duotone" className="mode-option-icon" />
                <span className="mode-option-label">{label}</span>
                <span className="mode-option-desc">{desc}</span>
              </button>
            ))}
          </div>

          <button
            className="mode-start-btn"
            disabled={!selected}
            onClick={() => selected && setMode(selected)}
          >
            {selected ? <>Let's Go! <GameController size={20} weight="duotone" /></> : 'Pick a mode first'}
          </button>

          <button className="mode-back-link" onClick={() => { setAvatar(null); setSelected(null); }}>
            ← change buddy
          </button>
        </div>
      </div>
    );
  }

  return <CatGame gameMode={mode} avatar={avatar} />;
}
