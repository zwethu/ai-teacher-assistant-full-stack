import { useState } from 'react';
import { catAudio } from '../audio';
import { Volume2, VolumeX, RefreshCw, Heart } from 'lucide-react';

interface MiniHUDProps {
  coins: number;
  fish: number;
  happiness: number;
  currentIndex: number;
  totalQuestions: number;
  subjectName: string;
  onReset: () => void;
  onOpenPacks: () => void;
}

export default function MiniHUD({ coins, fish, happiness, currentIndex, totalQuestions, subjectName, onReset, onOpenPacks }: MiniHUDProps) {
  const [muted, setMuted] = useState(catAudio.getMuted());

  const handleToggleMute = () => {
    const nextMute = !muted;
    catAudio.setMute(nextMute);
    setMuted(nextMute);
    catAudio.playTap();
  };

  const getHappinessStatus = (val: number) => {
    if (val >= 90) return { label: 'Extremely Cozy', emoji: '🥰' };
    if (val >= 70) return { label: 'Happy & Purring', emoji: '😸' };
    if (val >= 50) return { label: 'Content', emoji: '😺' };
    if (val >= 30) return { label: 'Bored', emoji: '😿' };
    return { label: 'Needs Love', emoji: '🙀' };
  };

  const status = getHappinessStatus(happiness);

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-2xl p-4 shadow-sm border border-pink-100 flex flex-col md:flex-row md:items-center justify-between gap-3 w-full">
      <div className="flex items-center gap-3">
        <div className="bg-pink-100 text-pink-700 w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shadow-inner">📖</div>
        <div>
          <h2 className="text-sm font-bold text-gray-800 flex items-center gap-1.5 leading-tight">
            <span>{subjectName}</span>
            <span className="text-[10px] uppercase tracking-wider bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded font-mono font-medium">Study Pack</span>
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-medium">Progress: <strong className="text-pink-600 font-bold">{currentIndex + 1}</strong> of <strong className="text-gray-700">{totalQuestions}</strong></span>
            <div className="w-20 bg-gray-100 h-1.5 rounded-full overflow-hidden">
              <div className="bg-pink-400 h-full transition-all duration-300" style={{ width: `${((currentIndex + 1) / totalQuestions) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 max-w-xs px-2">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-1">
          <span className="flex items-center gap-1 text-pink-500 font-bold">
            <Heart className="w-3.5 h-3.5 fill-pink-400 stroke-pink-500 animate-pulse" /> Cat Cozy Meter
          </span>
          <span className="text-xs text-rose-500 font-mono font-bold">{status.emoji} {Math.round(happiness)}%</span>
        </div>
        <div className="bg-rose-50 rounded-full h-3 p-0.5 border border-rose-100 overflow-hidden relative flex items-center">
          <div className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-400 transition-all duration-500 shadow-sm" style={{ width: `${happiness}%` }} />
          <span className="absolute inset-0 text-[8px] text-center font-bold text-rose-800 flex items-center justify-center tracking-wider">{status.label}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 justify-between md:justify-end">
        <div className="flex items-center gap-2">
          <div className="bg-amber-50 border border-amber-200/60 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 shadow-xs">
            <span className="text-base animate-bounce duration-1000">🪙</span>
            <div className="flex flex-col leading-none">
              <span className="text-[8px] font-bold text-amber-600 uppercase tracking-wider font-mono">Coins</span>
              <span className="text-xs font-bold text-amber-800 font-mono">{coins}</span>
            </div>
          </div>
          <div className="bg-cyan-50 border border-cyan-200/60 rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 shadow-xs">
            <span className="text-base">🐟</span>
            <div className="flex flex-col leading-none">
              <span className="text-[8px] font-bold text-cyan-600 uppercase tracking-wider font-mono">Treats</span>
              <span className="text-xs font-bold text-cyan-800 font-mono">{fish}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 border-l border-pink-100 pl-3">
          <button onClick={() => { catAudio.playTap(); onOpenPacks(); }} className="p-2 text-pink-600 hover:text-pink-700 bg-pink-50 hover:bg-pink-100 rounded-xl transition-all duration-150" title="Switch study packs">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={handleToggleMute} className={`p-2 rounded-xl transition-all duration-150 ${muted ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
