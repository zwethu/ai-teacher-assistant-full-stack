import { useState, useEffect } from 'react';
import type { Question } from '../types';
import { catAudio } from '../audio';
import { Sparkles, Trophy } from 'lucide-react';

interface ModeBMatchTreatProps {
  question: Question;
  onAnswer: (isCorrect: boolean) => void;
  onAnimationTrigger: (action: 'happy' | 'playful' | 'confused') => void;
}

interface CardItem {
  id: string; text: string; pairIndex: number;
  side: 'left' | 'right'; isMatched: boolean; isFlipped: boolean;
}

export default function ModeBMatchTreat({ question, onAnswer, onAnimationTrigger }: ModeBMatchTreatProps) {
  const [cards, setCards] = useState<CardItem[]>([]);
  const [selectedCards, setSelectedCards] = useState<CardItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [mismatchPairs, setMismatchPairs] = useState<string[]>([]);
  const [solvedCount, setSolvedCount] = useState(0);
  const [flyingTreat, setFlyingTreat] = useState<{ id: number; char: string } | null>(null);

  useEffect(() => {
    if (!question.pairs) return;
    const list: CardItem[] = [];
    question.pairs.forEach((pair, idx) => {
      list.push({ id: `left-${idx}`, text: pair.left, pairIndex: idx, side: 'left', isMatched: false, isFlipped: false });
      list.push({ id: `right-${idx}`, text: pair.right, pairIndex: idx, side: 'right', isMatched: false, isFlipped: false });
    });
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setCards(shuffled); setSelectedCards([]); setSolvedCount(0); setFlyingTreat(null);
  }, [question]);

  const handleCardClick = (card: CardItem) => {
    if (isBusy || card.isMatched) return;
    if (selectedCards.length === 1 && selectedCards[0].id === card.id) { setSelectedCards([]); catAudio.playFlip(); return; }
    catAudio.playFlip();
    const updated = cards.map((c) => c.id === card.id ? { ...c, isFlipped: true } : c);
    setCards(updated);
    const nextSelection = [...selectedCards, card];
    setSelectedCards(nextSelection);
    if (nextSelection.length === 2) checkMatch(nextSelection, updated);
  };

  const checkMatch = (selection: CardItem[], currentCards: CardItem[]) => {
    setIsBusy(true);
    const [c1, c2] = selection;
    const isMatch = c1.pairIndex === c2.pairIndex && c1.side !== c2.side;
    if (isMatch) {
      setTimeout(() => {
        catAudio.playCorrectChime(); onAnimationTrigger('playful');
        const treats = ['🐟', '🧶', '🎾', '🪄', '🍗'];
        setFlyingTreat({ id: Date.now(), char: treats[Math.floor(Math.random() * treats.length)] });
        const nextCards = currentCards.map((c) => c.pairIndex === c1.pairIndex ? { ...c, isMatched: true, isFlipped: true } : c);
        setCards(nextCards); setSelectedCards([]); setIsBusy(false);
        const newSolved = solvedCount + 1; setSolvedCount(newSolved);
        if (question.pairs && newSolved === question.pairs.length) onAnswer(true);
      }, 500);
    } else {
      setMismatchPairs([c1.id, c2.id]); onAnimationTrigger('confused');
      setTimeout(() => {
        catAudio.playOops();
        const nextCards = currentCards.map((c) => (c.id === c1.id || c.id === c2.id) ? { ...c, isFlipped: false } : c);
        setCards(nextCards); setSelectedCards([]); setMismatchPairs([]); setIsBusy(false);
      }, 1000);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-3xl mx-auto px-4 relative">
      {flyingTreat && (
        <div key={flyingTreat.id} className="fixed text-5xl z-50 pointer-events-none" style={{ left: '50%', bottom: '25%', transform: 'translateX(-50%)', animation: 'flyToCat 1.1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards' }}>
          {flyingTreat.char}
        </div>
      )}
      <div className="bg-cyan-50/70 border border-cyan-100 rounded-3xl p-5 shadow-xs w-full text-center relative mb-6">
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-cyan-400 text-cyan-950 text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-full shadow-xs flex items-center gap-1">
          <Sparkles className="w-3 h-3 fill-cyan-700" /> Mode B: Match & Treat
        </span>
        <h3 className="text-base md:text-lg font-bold text-gray-800 mt-1 leading-relaxed">{question.text}</h3>
        <p className="text-[11px] text-cyan-700 font-medium mt-1">Match a yellow behavior card to its corresponding purple explanation card!</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 w-full">
        {cards.map((card) => {
          const isSelected = selectedCards.some((s) => s.id === card.id);
          const isWobbling = mismatchPairs.includes(card.id);
          const isLeft = card.side === 'left';
          return (
            <button key={card.id} onClick={() => handleCardClick(card)} disabled={card.isMatched || isBusy} style={{ minHeight: '94px' }}
              className={`relative flex items-center justify-center p-3 text-center rounded-2xl cursor-pointer text-xs md:text-sm font-semibold transition-all duration-300 shadow-sm border ${
                card.isMatched ? 'bg-emerald-50 border-emerald-300 text-emerald-800 opacity-60 scale-95'
                : isSelected ? 'bg-amber-100 border-amber-400 text-amber-950 scale-102 ring-2 ring-amber-300 animate-pulse'
                : isWobbling ? 'bg-rose-100 border-rose-400 text-rose-900 animate-wobbles'
                : card.isFlipped ? (isLeft ? 'bg-amber-50 border-amber-200 text-gray-800' : 'bg-purple-50 border-purple-200 text-gray-800')
                : 'bg-white hover:bg-pink-50/30 border-pink-100/80 text-pink-500 hover:scale-102'
              }`}>
              {card.isFlipped || card.isMatched ? (
                <div className="flex flex-col items-center justify-center leading-tight gap-1">
                  <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-sm ${isLeft ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'}`}>
                    {isLeft ? 'Behavior' : 'Meaning'}
                  </span>
                  <p className="text-gray-700 mt-1">{card.text}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 opacity-80">
                  <span className="text-2xl animate-pulse">🐾</span>
                  <span className="text-[10px] tracking-wider text-pink-400 font-bold uppercase">Reveal</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
      {question.pairs && solvedCount === question.pairs.length && (
        <div className="mt-6 flex flex-col items-center w-full animate-bounce">
          <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-6 py-3 rounded-full flex items-center gap-2 font-bold shadow-md">
            <Trophy className="w-5 h-5 text-amber-400 fill-amber-300" /> Cozy Treats Grid Cleared! 😸
          </div>
        </div>
      )}
      <style>{`
        @keyframes flyToCat { 0% { transform: translate(-50%, 0) scale(1); opacity: 1; } 100% { transform: translate(-50%, -280px) scale(0.4); opacity: 0; } }
        @keyframes wobbles { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-6px) rotate(-2deg); } 75% { transform: translateX(6px) rotate(2deg); } }
        .animate-wobbles { animation: wobbles 0.25s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
