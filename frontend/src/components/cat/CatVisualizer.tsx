import React, { useState, useEffect, useRef } from 'react';
import type { CatMood } from '../types';
import { catAudio } from '../audio';

interface CatVisualizerProps {
  mood: CatMood;
  trustProgress: number;
  onPet: () => void;
}

export default function CatVisualizer({ mood, trustProgress, onPet }: CatVisualizerProps) {
  const [isBlinking, setIsBlinking] = useState(false);
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; char: string }[]>([]);
  const particleIdRef = useRef(0);
  const catRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 180);
    }, 3800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (mood === 'happy') {
      spawnParticle('💖'); spawnParticle('✨');
      setTimeout(() => spawnParticle('💖'), 200);
    } else if (mood === 'confused') {
      spawnParticle('💧'); spawnParticle('❓');
    } else if (mood === 'purring') {
      spawnParticle('🐾'); spawnParticle('🎵');
    }
  }, [mood]);

  const spawnParticle = (char: string) => {
    const id = particleIdRef.current++;
    const x = Math.random() * 120 + 30;
    const y = Math.random() * 60 + 40;
    setParticles(prev => [...prev, { id, x, y, char }]);
    setTimeout(() => setParticles(prev => prev.filter(p => p.id !== id)), 1500);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!catRef.current) return;
    catRef.current.setPointerCapture(e.pointerId);
    triggerPet(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.buttons > 0) triggerPet(e);
  };

  const triggerPet = (e: React.PointerEvent) => {
    onPet();
    if (Math.random() < 0.28) {
      const rect = e.currentTarget.getBoundingClientRect();
      const id = particleIdRef.current++;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setParticles(prev => [...prev, { id, x, y, char: '💕' }]);
      setTimeout(() => setParticles(prev => prev.filter(p => p.id !== id)), 1500);
      catAudio.playPurr();
    }
  };

  const showHappy   = isBlinking || mood === 'happy' || mood === 'purring';
  const showConfuse = mood === 'confused';

  return (
    <div className="cat-viz-root">
      {/* soft rug shadow */}
      <div className="cat-rug" />

      {/* petting zone */}
      <div
        ref={catRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        className="cat-pet-zone"
      >
        {/* particles */}
        {particles.map(p => (
          <div key={p.id} className="cat-particle" style={{ left: p.x, top: p.y }}>
            {p.char}
          </div>
        ))}

        <svg viewBox="0 0 220 260" className="cat-svg" overflow="visible">
          <defs>
            {/* main fur gradient – warm peach to rose */}
            <radialGradient id="furGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%"  stopColor="#ffd5b8" />
              <stop offset="55%" stopColor="#f9a7a7" />
              <stop offset="100%" stopColor="#f08080" />
            </radialGradient>

            {/* chest / belly – creamy white */}
            <radialGradient id="chestGrad" cx="50%" cy="30%" r="60%">
              <stop offset="0%"  stopColor="#ffffff" />
              <stop offset="100%" stopColor="#fce8e8" />
            </radialGradient>

            {/* ear inner pink */}
            <radialGradient id="earGrad" cx="50%" cy="50%" r="60%">
              <stop offset="0%"  stopColor="#ffb3c6" />
              <stop offset="100%" stopColor="#ff8fab" />
            </radialGradient>

            {/* paw pad */}
            <radialGradient id="pawGrad" cx="50%" cy="50%" r="60%">
              <stop offset="0%"  stopColor="#ffc8c8" />
              <stop offset="100%" stopColor="#f08080" />
            </radialGradient>

            {/* body shadow at bottom */}
            <radialGradient id="bodyShadow" cx="50%" cy="90%" r="50%">
              <stop offset="0%"  stopColor="#e07070" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#e07070" stopOpacity="0" />
            </radialGradient>

            <filter id="softGlow">
              <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#f43f5e" floodOpacity="0.10" />
            </filter>
          </defs>

          <g filter="url(#softGlow)">

            {/* ══ TAIL (behind body) ══ */}
            <path
              d="M 148 200 Q 196 195 188 148 Q 182 108 195 82"
              fill="none" stroke="url(#furGrad)" strokeWidth="20" strokeLinecap="round"
              style={{
                transformOrigin: '148px 200px',
                animation: mood === 'happy' || mood === 'purring'
                  ? 'tailHappy 0.9s ease-in-out infinite'
                  : 'tailRelax 2.6s ease-in-out infinite',
              }}
            />
            {/* white tail tip */}
            <circle cx="195" cy="82" r="11" fill="white"
              style={{
                transformOrigin: '148px 200px',
                animation: mood === 'happy' || mood === 'purring'
                  ? 'tailHappy 0.9s ease-in-out infinite'
                  : 'tailRelax 2.6s ease-in-out infinite',
              }}
            />

            {/* ══ BODY ══ */}
            <ellipse cx="110" cy="185" rx="62" ry="54" fill="url(#furGrad)" />
            {/* body underside shadow */}
            <ellipse cx="110" cy="200" rx="62" ry="38" fill="url(#bodyShadow)" />
            {/* chest white fur */}
            <ellipse cx="110" cy="183" rx="38" ry="44" fill="url(#chestGrad)" opacity="0.92" />

            {/* ══ FRONT PAWS ══ */}
            {/* left paw */}
            <ellipse cx="78"  cy="228" rx="18" ry="11" fill="url(#furGrad)" />
            <ellipse cx="78"  cy="224" rx="14" ry="7"  fill="url(#chestGrad)" />
            {/* paw toe lines */}
            <line x1="72" y1="220" x2="70" y2="215" stroke="#e08080" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            <line x1="78" y1="219" x2="78" y2="214" stroke="#e08080" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            <line x1="84" y1="220" x2="86" y2="215" stroke="#e08080" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            {/* right paw */}
            <ellipse cx="142" cy="228" rx="18" ry="11" fill="url(#furGrad)" />
            <ellipse cx="142" cy="224" rx="14" ry="7"  fill="url(#chestGrad)" />
            <line x1="136" y1="220" x2="134" y2="215" stroke="#e08080" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            <line x1="142" y1="219" x2="142" y2="214" stroke="#e08080" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
            <line x1="148" y1="220" x2="150" y2="215" stroke="#e08080" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />

            {/* ══ LEFT EAR ══ */}
            <g style={{
              transformOrigin: '62px 90px',
              animation: mood === 'happy' || mood === 'playful' ? 'earWigL 3.5s ease-in-out infinite' : 'none',
            }}>
              <path d="M 48 100 L 34 52 Q 52 46, 80 76 Z" fill="url(#furGrad)" />
              <path d="M 53 94 L 42 58 Q 55 53, 74 76 Z" fill="url(#earGrad)" opacity="0.85" />
            </g>

            {/* ══ RIGHT EAR ══ */}
            <g style={{
              transformOrigin: '158px 90px',
              animation: mood === 'happy' || mood === 'playful' ? 'earWigR 3.5s ease-in-out infinite' : 'none',
            }}>
              <path d="M 172 100 L 186 52 Q 168 46, 140 76 Z" fill="url(#furGrad)" />
              <path d="M 167 94 L 178 58 Q 165 53, 146 76 Z" fill="url(#earGrad)" opacity="0.85" />
            </g>

            {/* ══ HEAD ══ */}
            <ellipse cx="110" cy="118" rx="68" ry="56" fill="url(#furGrad)" />

            {/* forehead tabby stripes */}
            <path d="M 110 64 L 110 80" stroke="#d4705a" strokeWidth="4.5" strokeLinecap="round" opacity="0.55" />
            <path d="M 101 65 L 103 77" stroke="#d4705a" strokeWidth="3.5" strokeLinecap="round" opacity="0.45" />
            <path d="M 119 65 L 117 77" stroke="#d4705a" strokeWidth="3.5" strokeLinecap="round" opacity="0.45" />

            {/* cheek blush */}
            <ellipse cx="65"  cy="130" rx="13" ry="8" fill="#ffb3c6" opacity="0.55" />
            <ellipse cx="155" cy="130" rx="13" ry="8" fill="#ffb3c6" opacity="0.55" />

            {/* ══ EYES ══ */}
            {showHappy ? (
              /* happy / blinking – upward arc ^^ */
              <>
                <path d="M 84 118 Q 94 107, 104 118"  fill="none" stroke="#2d1c18" strokeWidth="5" strokeLinecap="round" />
                <path d="M 116 118 Q 126 107, 136 118" fill="none" stroke="#2d1c18" strokeWidth="5" strokeLinecap="round" />
              </>
            ) : showConfuse ? (
              /* confused – one big one small */
              <>
                <circle cx="90"  cy="116" r="8"  fill="#2d1c18" />
                <circle cx="87"  cy="113" r="3"  fill="white" />
                <circle cx="130" cy="113" r="11" fill="#2d1c18" />
                <circle cx="127" cy="110" r="4"  fill="white" />
                <circle cx="133" cy="117" r="2"  fill="white" />
              </>
            ) : (
              /* normal shiny eyes */
              <>
                <circle cx="90"  cy="116" r="10" fill="#2d1c18" />
                <circle cx="86"  cy="112" r="4"  fill="white" />
                <circle cx="92"  cy="120" r="1.5" fill="white" />
                <circle cx="130" cy="116" r="10" fill="#2d1c18" />
                <circle cx="126" cy="112" r="4"  fill="white" />
                <circle cx="132" cy="120" r="1.5" fill="white" />
              </>
            )}

            {/* ══ NOSE ══ */}
            <polygon points="107,127 113,127 110,131" fill="#e05a6a" />

            {/* ══ MOUTH ══ */}
            {mood === 'happy' || mood === 'purring' ? (
              /* big :3 smile */
              <path d="M 98 136 Q 110 146, 110 136 Q 110 146, 122 136"
                fill="none" stroke="#2d1c18" strokeWidth="3.5" strokeLinecap="round" />
            ) : mood === 'confused' ? (
              <circle cx="110" cy="140" r="4" fill="none" stroke="#2d1c18" strokeWidth="3" />
            ) : (
              /* neutral cute line */
              <path d="M 103 136 Q 110 140, 110 136 Q 110 140, 117 136"
                fill="none" stroke="#2d1c18" strokeWidth="2.5" strokeLinecap="round" />
            )}

            {/* whiskers */}
            <line x1="50"  y1="128" x2="90"  y2="126" stroke="#c87878" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
            <line x1="48"  y1="135" x2="90"  y2="134" stroke="#c87878" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
            <line x1="130" y1="126" x2="170" y2="128" stroke="#c87878" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
            <line x1="130" y1="134" x2="172" y2="135" stroke="#c87878" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />

          </g>
        </svg>

        {/* Pet me badge */}
        {mood === 'idle' && (
          <div className="cat-pet-badge">
            🖐️ Pet me!
          </div>
        )}
      </div>

      {/* Trust meter */}
      <div className="cat-trust-bar-bg">
        <div className="cat-trust-bar-fill" style={{ width: `${Math.min(trustProgress, 100)}%` }}>
          {trustProgress >= 100 && (
            <span className="cat-trust-ping">
              <span className="cat-trust-ping-ring" />
              <span className="cat-trust-ping-dot" />
            </span>
          )}
        </div>
      </div>
      <p className="cat-trust-label">
        Trust Meter: {Math.round(trustProgress)}%
        {trustProgress >= 100 && ' 🌟 Max Bonus Active!'}
      </p>

      <style>{`
        .cat-viz-root {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 20px 0 10px;
          position: relative; width: 100%; max-width: 280px;
          margin: 0 auto; user-select: none;
          font-family: 'Nunito', sans-serif;
        }
        .cat-rug {
          position: absolute; bottom: 56px;
          width: 180px; height: 22px;
          background: #ffe4ec; border-radius: 50%;
          filter: blur(4px); opacity: 0.7;
        }
        .cat-pet-zone {
          position: relative; width: 220px; height: 260px;
          display: flex; align-items: flex-end; justify-content: center;
          animation: catFloat 3.2s ease-in-out infinite;
        }
        .cat-svg { width: 100%; height: 100%; overflow: visible; }
        .cat-particle {
          position: absolute; z-index: 30; pointer-events: none;
          font-size: 1.25rem;
          animation: floatUp 1.2s ease-out forwards;
        }
        .cat-pet-badge {
          position: absolute; top: 6px; right: -18px;
          background: #fef3c7; color: #92400e;
          font-size: 10px; font-weight: 800;
          padding: 4px 10px; border-radius: 999px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          animation: bounce 1.2s ease-in-out infinite;
          pointer-events: none; white-space: nowrap;
        }
        .cat-pet-zone:hover { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='%23f43f5e'><path d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'/></svg>") 12 12, pointer; }
        .cat-trust-bar-bg {
          width: 180px; height: 13px;
          background: rgba(253,164,175,0.3);
          border-radius: 999px; margin-top: 10px;
          padding: 2px; border: 1.5px solid #fda4af;
          display: flex; align-items: center;
        }
        .cat-trust-bar-fill {
          background: linear-gradient(90deg, #fb7185, #f43f5e);
          height: 9px; border-radius: 999px;
          transition: width 0.35s ease;
          position: relative; min-width: 0;
          box-shadow: 0 1px 6px rgba(244,63,94,0.3);
        }
        .cat-trust-ping {
          position: absolute; top: -3px; right: -4px;
          display: flex; width: 8px; height: 8px;
        }
        .cat-trust-ping-ring {
          animation: ping 1s cubic-bezier(0,0,0.2,1) infinite;
          position: absolute; inset: 0;
          border-radius: 50%; background: #f9a8d4; opacity: 0.75;
        }
        .cat-trust-ping-dot {
          position: relative; width: 8px; height: 8px;
          border-radius: 50%; background: #ec4899;
        }
        .cat-trust-label {
          font-size: 10px; font-weight: 700;
          color: #f43f5e; margin-top: 5px;
          display: flex; align-items: center; gap: 4px;
        }

        /* ── Animations ── */
        @keyframes catFloat {
          0%,100% { transform: translateY(0px); }
          50%      { transform: translateY(-9px); }
        }
        @keyframes floatUp {
          0%   { transform: translateY(0) scale(0.6); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translateY(-75px) scale(1.1); opacity: 0; }
        }
        @keyframes bounce {
          0%,100% { transform: translateY(0); }
          50%      { transform: translateY(-5px); }
        }
        @keyframes ping {
          75%,100% { transform: scale(2); opacity: 0; }
        }
        @keyframes tailHappy {
          0%,100% { transform: rotate(0deg); }
          50%      { transform: rotate(14deg) translateY(-3px); }
        }
        @keyframes tailRelax {
          0%,100% { transform: rotate(0deg); }
          50%      { transform: rotate(7deg); }
        }
        @keyframes earWigL {
          0%,78%,100% { transform: rotate(0deg); }
          82% { transform: rotate(-9deg); }
          88% { transform: rotate(-3deg); }
          94% { transform: rotate(-8deg); }
        }
        @keyframes earWigR {
          0%,78%,100% { transform: rotate(0deg); }
          82% { transform: rotate(9deg); }
          88% { transform: rotate(3deg); }
          94% { transform: rotate(8deg); }
        }
      `}</style>
    </div>
  );
}
