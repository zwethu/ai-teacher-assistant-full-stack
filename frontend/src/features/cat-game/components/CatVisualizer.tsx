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
      setTimeout(() => setIsBlinking(false), 200);
    }, 4000);
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
    const x = Math.random() * 120 + 40;
    const y = Math.random() * 60 + 50;
    setParticles((prev) => [...prev, { id, x, y, char }]);
    setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== id)), 1500);
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
    if (Math.random() < 0.25) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const id = particleIdRef.current++;
      setParticles((prev) => [...prev, { id, x, y, char: '💕' }]);
      setTimeout(() => setParticles((prev) => prev.filter((p) => p.id !== id)), 1500);
      catAudio.playPurr();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-6 select-none relative w-full max-w-sm mx-auto">
      <div className="absolute bottom-2 w-48 h-6 bg-pink-100 rounded-full blur-[2px] opacity-70"></div>
      <div
        id="cat-pet-zone"
        ref={catRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        className="cursor-heart relative w-56 h-60 flex flex-col items-center justify-end group active:scale-102 transition-transform duration-200"
      >
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute z-30 pointer-events-none text-xl"
            style={{ left: `${p.x}px`, top: `${p.y}px`, animation: 'floatUp 1.2s ease-out forwards' }}
          >
            {p.char}
          </div>
        ))}
        <svg viewBox="0 0 200 240" className="w-full h-full overflow-visible">
          <defs>
            <filter id="soft-shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#f43f5e" floodOpacity="0.08" />
            </filter>
            <linearGradient id="peachFur" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffd8c2" />
              <stop offset="60%" stopColor="#fca5a5" />
              <stop offset="100%" stopColor="#fca5a5" />
            </linearGradient>
            <linearGradient id="earPink" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fda4af" />
              <stop offset="100%" stopColor="#fecdd3" />
            </linearGradient>
          </defs>
          <g filter="url(#soft-shadow)">
            <path d="M 130 190 Q 175 190, 165 130 T 180 80" fill="none" stroke="#fca5a5" strokeWidth="16" strokeLinecap="round"
              className={`origin-[130px_190px] ${mood === 'happy' || mood === 'purring' ? 'animate-tail-happy' : 'animate-tail-relaxed'}`} />
            <circle cx="180" cy="80" r="8" fill="#fff"
              className={`origin-[130px_190px] ${mood === 'happy' || mood === 'purring' ? 'animate-tail-happy' : 'animate-tail-relaxed'}`} />
            <ellipse cx="100" cy="170" rx="55" ry="45" fill="url(#peachFur)" />
            <path d="M 65 160 Q 100 205, 135 160 Q 100 175, 65 160" fill="#fff" opacity="0.85" />
            <ellipse cx="65" cy="210" rx="14" ry="10" fill="#fff" />
            <ellipse cx="65" cy="204" rx="12" ry="6" fill="#fca5a5" />
            <ellipse cx="135" cy="210" rx="14" ry="10" fill="#fff" />
            <ellipse cx="135" cy="204" rx="12" ry="6" fill="#fca5a5" />
            <g className={mood === 'playful' || mood === 'happy' ? 'animate-ear-wiggle-l' : ''}>
              <path d="M 45 92 L 30 45 Q 45 42, 70 68 Z" fill="url(#peachFur)" />
              <path d="M 50 85 L 38 53 Q 48 51, 65 72 Z" fill="url(#earPink)" />
            </g>
            <g className={mood === 'playful' || mood === 'happy' ? 'animate-ear-wiggle-r' : ''}>
              <path d="M 155 92 L 170 45 Q 155 42, 130 68 Z" fill="url(#peachFur)" />
              <path d="M 150 85 L 162 53 Q 152 51, 135 72 Z" fill="url(#earPink)" />
            </g>
            <g className={mood === 'confused' ? 'rotate-[-6deg] translate-y-[-2px]' : 'transition-transform duration-300'}>
              <ellipse cx="100" cy="110" rx="62" ry="48" fill="url(#peachFur)" />
              <path d="M 100 64 L 100 78 M 92 64 L 94 74 M 108 64 L 106 74" stroke="#e08264" strokeWidth="4" strokeLinecap="round" />
              <path d="M 152 110 L 140 110 M 150 118 L 142 116" stroke="#e08264" strokeWidth="3" strokeLinecap="round" />
              <path d="M 48 110 L 60 110 M 50 118 L 58 116" stroke="#e08264" strokeWidth="3" strokeLinecap="round" />
              <circle cx="62" cy="122" r="8" fill="#fda4af" opacity="0.6" />
              <circle cx="138" cy="122" r="8" fill="#fda4af" opacity="0.6" />
              {isBlinking || mood === 'happy' || mood === 'purring' ? (
                <>
                  <path d="M 56 112 Q 68 100, 80 112" fill="none" stroke="#2d1c18" strokeWidth="4.5" strokeLinecap="round" />
                  <path d="M 120 112 Q 132 100, 144 112" fill="none" stroke="#2d1c18" strokeWidth="4.5" strokeLinecap="round" />
                </>
              ) : mood === 'confused' ? (
                <>
                  <circle cx="68" cy="108" r="6.5" fill="#2d1c18" />
                  <circle cx="66" cy="106" r="2.5" fill="#fff" />
                  <circle cx="132" cy="106" r="9" fill="#2d1c18" />
                  <circle cx="129" cy="103" r="3.5" fill="#fff" />
                  <circle cx="134" cy="110" r="1.5" fill="#fff" />
                </>
              ) : (
                <>
                  <circle cx="68" cy="110" r="8" fill="#2d1c18" />
                  <circle cx="65" cy="107" r="3" fill="#fff" />
                  <circle cx="70" cy="113" r="1" fill="#fff" />
                  <circle cx="132" cy="110" r="8" fill="#2d1c18" />
                  <circle cx="129" cy="107" r="3" fill="#fff" />
                  <circle cx="134" cy="113" r="1" fill="#fff" />
                </>
              )}
              <polygon points="97,118 103,118 100,121" fill="#ea580c" />
              {mood === 'happy' || mood === 'purring' ? (
                <path d="M 92 124 Q 100 131, 100 124 Q 100 131, 108 124" fill="none" stroke="#2d1c18" strokeWidth="3.5" strokeLinecap="round" />
              ) : mood === 'confused' ? (
                <circle cx="100" cy="128" r="3" fill="none" stroke="#2d1c18" strokeWidth="3" />
              ) : (
                <path d="M 94 125 Q 100 128, 100 125 Q 100 128, 106 125" fill="none" stroke="#2d1c18" strokeWidth="2.5" strokeLinecap="round" />
              )}
            </g>
          </g>
        </svg>
        {mood === 'idle' && (
          <div className="absolute top-2 right-[-24px] bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-1 rounded-full shadow-xs animate-bounce pointer-events-none">
            🖐️ Pet me!
          </div>
        )}
      </div>
      <div className="w-48 bg-rose-100/60 rounded-full h-3.5 mt-2 flex items-center p-0.5 border border-rose-200">
        <div
          className="bg-gradient-to-r from-rose-400 to-pink-500 h-2.5 rounded-full transition-all duration-300 relative shadow-sm"
          style={{ width: `${Math.min(trustProgress, 100)}%` }}
        >
          {trustProgress >= 100 && (
            <span className="absolute -top-1.5 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
            </span>
          )}
        </div>
      </div>
      <div className="text-[10px] font-medium text-rose-500 mt-1 flex items-center gap-1">
        <span>Trust Meter: {Math.round(trustProgress)}%</span>
        {trustProgress >= 100 && <span>🌟 (Max Bonus Active!)</span>}
      </div>
      <style>{`
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.6); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(-80px) scale(1.1); opacity: 0; }
        }
        @keyframes tailHappy { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(15deg) translateY(-2px); } }
        @keyframes tailRelaxed { 0%, 100% { transform: rotate(0deg); } 50% { transform: rotate(6deg); } }
        @keyframes earWiggleL { 0%, 100%, 80% { transform: rotate(0deg); } 85% { transform: rotate(-8deg); } 90% { transform: rotate(-3deg); } 95% { transform: rotate(-8deg); } }
        @keyframes earWiggleR { 0%, 100%, 80% { transform: rotate(0deg); } 85% { transform: rotate(8deg); } 90% { transform: rotate(3deg); } 95% { transform: rotate(8deg); } }
        .animate-tail-happy { animation: tailHappy 1s ease-in-out infinite; }
        .animate-tail-relaxed { animation: tailRelaxed 2.5s ease-in-out infinite; }
        .animate-ear-wiggle-l { animation: earWiggleL 3.5s ease-in-out infinite; }
        .animate-ear-wiggle-r { animation: earWiggleR 3.5s ease-in-out infinite; }
        .cursor-heart:hover { cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='%23f43f5e' stroke='%23fda4af' stroke-width='1.5'><path d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'/></svg>") 12 12, pointer; }
      `}</style>
    </div>
  );
}
