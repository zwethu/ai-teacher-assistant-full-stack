import { useState } from 'react';
import './CatThemePicker.css';

export type CatTheme = {
  id: string;
  name: string;
  emoji: string;
  tag: string;
  palette: { bg: string; card: string; accent: string; text: string };
  bodyClass: string;
  sounds: { meow: number[][]; purr: number };
  description: string;
  traits: string[];
};

export const CAT_THEMES: CatTheme[] = [
  {
    id: 'cozy',
    name: 'Cozy Cream',
    emoji: '🐱',
    tag: 'warm & soft',
    palette: { bg: 'linear-gradient(160deg,#fef9f0,#fde8f5,#e8f4fd)', card: '#fffaf5', accent: '#f4a261', text: '#5a3825' },
    bodyClass: 'theme-cozy',
    sounds: { meow: [[523,0.18],[659,0.25],[880,0.2]], purr: 120 },
    description: 'A soft, warm cat living in a cozy room with candles and plants.',
    traits: ['🕯️ Cozy room', '🌸 Pastel palette', '✨ Gentle animations'],
  },
  {
    id: 'midnight',
    name: 'Midnight Black',
    emoji: '🐈‍⬛',
    tag: 'cool & mysterious',
    palette: { bg: 'linear-gradient(160deg,#0f0c1a,#1a1030,#0c1a2e)', card: '#1e1835', accent: '#a78bfa', text: '#e2d9f3' },
    bodyClass: 'theme-midnight',
    sounds: { meow: [[330,0.2],[262,0.28],[196,0.22]], purr: 80 },
    description: 'A mysterious black cat prowling the night, glowing purple eyes.',
    traits: ['🌙 Dark theme', '💜 Purple glow', '⭐ Starfield bg'],
  },
  {
    id: 'sakura',
    name: 'Sakura Pink',
    emoji: '🐈',
    tag: 'sweet & dreamy',
    palette: { bg: 'linear-gradient(160deg,#fff0f6,#ffe4f0,#ffd6e8)', card: '#fff5f9', accent: '#f472b6', text: '#831843' },
    bodyClass: 'theme-sakura',
    sounds: { meow: [[659,0.15],[784,0.22],[1047,0.18]], purr: 160 },
    description: 'A pink cherry-blossom cat dancing in falling petals.',
    traits: ['🌸 Petal particles', '💗 Hot pink accent', '🎀 Ribbon decorations'],
  },
  {
    id: 'forest',
    name: 'Forest Sage',
    emoji: '🐱',
    tag: 'calm & earthy',
    palette: { bg: 'linear-gradient(160deg,#f0faf4,#e0f5e9,#d4edd9)', card: '#f4fcf6', accent: '#34a853', text: '#1a3d2b' },
    bodyClass: 'theme-forest',
    sounds: { meow: [[440,0.18],[523,0.2],[392,0.22]], purr: 100 },
    description: 'An earthy outdoor cat napping under ferns and mushrooms.',
    traits: ['🌿 Nature green', '🍄 Mushroom decor', '🌱 Earthy feel'],
  },
  {
    id: 'galaxy',
    name: 'Galaxy Neon',
    emoji: '😺',
    tag: 'wild & electric',
    palette: { bg: 'linear-gradient(160deg,#080018,#0d0030,#00101a)', card: '#0d0d2b', accent: '#00f5d4', text: '#d0f0ff' },
    bodyClass: 'theme-galaxy',
    sounds: { meow: [[880,0.1],[1175,0.15],[1568,0.12]], purr: 200 },
    description: 'A cyber cat with neon teal glow lines in outer space.',
    traits: ['🌌 Space bg', '💠 Neon glow', '⚡ Electric accents'],
  },
  {
    id: 'cafe',
    name: 'Café Latte',
    emoji: '😸',
    tag: 'chill & vintage',
    palette: { bg: 'linear-gradient(160deg,#faf3e0,#f5e6cc,#eedcb8)', card: '#fdf6e8', accent: '#c07840', text: '#3d2000' },
    bodyClass: 'theme-cafe',
    sounds: { meow: [[392,0.2],[330,0.25],[262,0.18]], purr: 110 },
    description: 'A sleepy café cat curled up next to a coffee cup and jazz music.',
    traits: ['☕ Warm latte tones', '🎷 Chill vibe', '📖 Vintage textures'],
  },
];

function playMeow(theme: CatTheme) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let t = ctx.currentTime;
    theme.sounds.meow.forEach(([freq, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.75, t + dur);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.7;
    });
  } catch {}
}

function playPurr(theme: CatTheme) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const bufSize = ctx.sampleRate * 0.8;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin((2 * Math.PI * theme.sounds.purr * i) / ctx.sampleRate) * 0.08;
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    src.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    src.start();
  } catch {}
}

type Props = { onSelect?: (theme: CatTheme) => void };

export default function CatThemePicker({ onSelect }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('cozy');
  const [soundPlayed, setSoundPlayed] = useState<string | null>(null);

  function handleMeow(theme: CatTheme) {
    playMeow(theme);
    setSoundPlayed(theme.id);
    setTimeout(() => setSoundPlayed(null), 1500);
  }

  function handlePurr(theme: CatTheme) {
    playPurr(theme);
  }

  function handleSelect(theme: CatTheme) {
    setSelected(theme.id);
    onSelect?.(theme);
  }

  return (
    <div className="picker-root">
      <div className="picker-header">
        <h1 className="picker-title">🐾 Choose Your Cat</h1>
        <p className="picker-subtitle">Pick a theme that feels right — click the cat to hear it!</p>
      </div>

      <div className="picker-grid">
        {CAT_THEMES.map(theme => {
          const isHovered  = hovered  === theme.id;
          const isSelected = selected === theme.id;
          const isSound    = soundPlayed === theme.id;

          return (
            <div
              key={theme.id}
              className={[
                'theme-card',
                theme.bodyClass,
                isSelected ? 'is-selected' : '',
                isHovered  ? 'is-hovered'  : '',
              ].join(' ')}
              style={{
                background: theme.palette.card,
                '--accent': theme.palette.accent,
                '--text':   theme.palette.text,
              } as React.CSSProperties}
              onMouseEnter={() => setHovered(theme.id)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* big cat button */}
              <button
                className="cat-preview-btn"
                onClick={() => handleMeow(theme)}
                onContextMenu={e => { e.preventDefault(); handlePurr(theme); }}
                title="Left-click: meow! | Right-click: purr~"
                style={{ background: theme.palette.bg }}
              >
                <span className={`cat-preview-emoji ${isSound ? 'cat-sound-pop' : ''}`}>
                  {theme.emoji}
                </span>
                {isSound && <span className="sound-bubble">♪ Meow~</span>}
                <div className="preview-bg-deco" aria-hidden />
              </button>

              {/* info */}
              <div className="card-info">
                <div className="card-top">
                  <span className="card-name" style={{ color: theme.palette.text }}>{theme.name}</span>
                  <span className="card-tag">{theme.tag}</span>
                </div>
                <p className="card-desc">{theme.description}</p>
                <ul className="card-traits">
                  {theme.traits.map(t => <li key={t}>{t}</li>)}
                </ul>

                <div className="card-actions">
                  <button className="sound-btn" onClick={() => handleMeow(theme)}>🔊 Meow</button>
                  <button className="sound-btn" onClick={() => handlePurr(theme)}>💤 Purr</button>
                  <button
                    className={`select-btn ${isSelected ? 'is-picked' : ''}`}
                    style={{ background: isSelected ? theme.palette.accent : undefined, borderColor: theme.palette.accent }}
                    onClick={() => handleSelect(theme)}
                  >
                    {isSelected ? '✓ Selected' : 'Pick this'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="picker-footer">
        <p>Selected: <strong>{CAT_THEMES.find(t => t.id === selected)?.name}</strong></p>
        <p className="picker-footer-hint">Tell me which one you like and I'll apply it to the game 🐾</p>
      </div>
    </div>
  );
}
