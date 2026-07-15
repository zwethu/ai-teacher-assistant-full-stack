import { useState } from 'react';
import { Cat, Dog, GameController } from '@phosphor-icons/react';
import Lottie from '../components/cat/LottieBox';
import type { AvatarType } from '../types/catGame.types';
import { AVATARS, avatarAnimation } from '../components/cat/avatarAnimations';
import './AvatarSelectPage.css';

type Props = {
  nickname: string;
  onSelect: (avatar: AvatarType) => void;
};

export default function AvatarSelectPage({ nickname, onSelect }: Props) {
  const [selected, setSelected] = useState<AvatarType | null>(null);

  return (
    <div className="avatar-select-bg">
      <div className="avatar-select-card">
        <h2 className="avatar-select-title">Choose your buddy, {nickname}! 🐾</h2>
        <p className="avatar-select-subtitle">Who's going to study with you today?</p>

        <div className="avatar-select-grid">
          {AVATARS.map(a => (
            <button
              key={a.type}
              type="button"
              className={`avatar-option avatar-option--${a.type} ${
                selected === a.type ? 'is-selected' : ''
              }`}
              onClick={() => setSelected(a.type)}
            >
              <div className="avatar-lottie-wrap">
                <Lottie
                  animationData={avatarAnimation(a.type, 'idle') as object}
                  loop
                  autoplay
                />
              </div>
              <span className="avatar-option-label">
                {a.type === 'cat' ? <Cat size={18} weight="duotone" /> : <Dog size={18} weight="duotone" />}
                {a.label}
              </span>
              <span className="avatar-option-blurb">{a.blurb}</span>
              <span className="avatar-check">{selected === a.type ? '✓ Chosen!' : 'Tap to pick'}</span>
            </button>
          ))}
        </div>

        <button
          className="avatar-continue-btn"
          disabled={!selected}
          onClick={() => selected && onSelect(selected)}
        >
          {selected ? <>Let's play! <GameController size={19} weight="duotone" /></> : 'Pick a buddy first'}
        </button>
      </div>
    </div>
  );
}
