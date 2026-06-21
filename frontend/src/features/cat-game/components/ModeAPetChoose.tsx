import type { Question } from '../types';
import { catAudio } from '../audio';
import { Sparkles, AlertCircle } from 'lucide-react';
import { useState } from 'react';

interface ModeAPetChooseProps {
  question: Question;
  onAnswer: (isCorrect: boolean) => void;
  trustProgress: number;
}

export default function ModeAPetChoose({ question, onAnswer, trustProgress }: ModeAPetChooseProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);

  const handleSelectOption = (optionId: string) => {
    if (hasSubmitted) return;
    setSelectedId(optionId);
    setHasSubmitted(true);
    const isCorrect = optionId === question.correctOptionId;
    if (isCorrect) catAudio.playCorrectChime();
    else catAudio.playOops();
    onAnswer(isCorrect);
  };

  const getButtonClass = (optionId: string) => {
    const isSelected = selectedId === optionId;
    const isCorrect = optionId === question.correctOptionId;
    if (!hasSubmitted) return 'bg-pink-50/60 hover:bg-pink-100/80 border-2 border-pink-100 hover:border-pink-300 text-gray-800 hover:scale-101 active:scale-99';
    if (isCorrect) return 'bg-emerald-100 border-2 border-emerald-400 text-emerald-800 font-bold shadow-md animate-pulse';
    if (isSelected && !isCorrect) return 'bg-rose-100 border-2 border-rose-400 text-rose-800 opacity-90';
    return 'bg-gray-100/60 border-2 border-gray-200 text-gray-500 opacity-60';
  };

  const optionDecorations = ['🧁', '🧶', '🛋️', '🥣'];

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto px-4">
      <div className="bg-amber-50/70 border border-amber-100 rounded-3xl p-6 shadow-xs w-full text-center relative mb-6">
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-950 text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-full shadow-xs flex items-center gap-1">
          <Sparkles className="w-3 h-3 fill-amber-700" /> Mode A: Pet & Choose
        </span>
        <h3 className="text-lg md:text-xl font-bold text-gray-800 mt-1 leading-relaxed">{question.text}</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
        {question.options?.map((option, idx) => (
          <button key={option.id} disabled={hasSubmitted} onClick={() => handleSelectOption(option.id)}
            className={`flex items-center gap-3 p-4 rounded-2xl text-left transition-all duration-200 cursor-pointer text-sm md:text-base ${getButtonClass(option.id)}`}>
            <span className="text-2xl flex-shrink-0 bg-white/80 p-1.5 rounded-xl shadow-xs">{optionDecorations[idx % optionDecorations.length]}</span>
            <span className="leading-tight font-medium">{option.text}</span>
          </button>
        ))}
      </div>
      {hasSubmitted && (
        <div className="mt-6 w-full animate-fade-in flex flex-col items-center">
          {selectedId === question.correctOptionId ? (
            <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 px-4 py-2.5 rounded-full border border-emerald-200 text-sm font-semibold shadow-xs">
              <Sparkles className="w-4 h-4 fill-emerald-500 stroke-emerald-600" /> Lovely care! The kitty is extremely pleased!
            </div>
          ) : (
            <div className="flex items-center gap-2 text-rose-700 bg-rose-50 px-4 py-2.5 rounded-full border border-rose-200 text-sm font-semibold shadow-xs">
              <AlertCircle className="w-4 h-4" /> Oops! But the kitty still values your attempt.
            </div>
          )}
        </div>
      )}
      {!hasSubmitted && (
        <p className="text-[10px] text-gray-400 mt-4 italic text-center">💡 Tip: You can tap and drag over the cat above to pet it while thinking!</p>
      )}
    </div>
  );
}
