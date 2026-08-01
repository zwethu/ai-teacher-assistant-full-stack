import { useState } from 'react';
import { ArrowLeft, GameController } from '@phosphor-icons/react';
import Lottie from '../components/cat/LottieBox';
import type { AvatarType } from '../types/catGame.types';
import { AVATARS, avatarAnimation } from '../components/cat/avatarAnimations';
import MusicToggle from '../components/cat/MusicToggle';
import { useMusic } from '../components/cat/useMusic';
import './AvatarSelectPage.css';

type Props = {
  nickname: string;
  onSelect: (avatar: AvatarType) => void;
  /** Omitted where there is no earlier step to return to, e.g. the preview page. */
  onBack?: () => void;
};

export default function AvatarSelectPage({ nickname, onSelect, onBack }: Props) {
  const [selected, setSelected] = useState<AvatarType | null>(null);
  // No lobby track any more: this screen PREVIEWS the picked pet's theme, and
  // defaults to the cat's before anything is picked.
  useMusic(selected ?? 'cat');

  return (
    <div className="avatar-select-bg">
      <div className="avatar-select-card">
        {onBack && (
          <button
            type="button"
            className="play-back-btn"
            onClick={onBack}
            aria-label="Back to your nickname"
            title="Back to your nickname"
          >
            <ArrowLeft size={18} weight="bold" />
          </button>
        )}
        <MusicToggle />
        <h2 className="avatar-select-title">Choose your buddy, {nickname}! 🐾</h2>
        <p className="avatar-select-subtitle">Who's going to study with you today?</p>

        <div className="avatar-select-grid">
          {/* theme-* goes on each CARD, not the screen: no pet is picked yet,
              so without it both selection rings resolve to the default rose
              and the dog card gets ringed in pink. */}
          {AVATARS.map(a => (
            <button
              key={a.type}
              type="button"
              className={`avatar-option avatar-option--${a.type} theme-${a.type} ${
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
              <span className="avatar-option-label">{a.label}</span>
              <span className="avatar-option-blurb">{a.blurb}</span>
              <span className="avatar-check">{selected === a.type ? '✓ Chosen!' : 'Tap to pick'}</span>
            </button>
          ))}
        </div>

        <button
          className={`avatar-continue-btn${selected ? ` theme-${selected}` : ''}`}
          disabled={!selected}
          onClick={() => selected && onSelect(selected)}
        >
          {selected ? <>Let's play! <GameController size={19} weight="duotone" /></> : 'Pick a buddy first'}
        </button>
      </div>
    </div>
  );
}
