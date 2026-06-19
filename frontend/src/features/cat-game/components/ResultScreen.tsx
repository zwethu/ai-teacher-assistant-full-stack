import { SessionResult, Question } from '../types';
import { Award, RefreshCw, Sparkles, ChevronRight, History, Calendar, CheckCircle2, XCircle } from 'lucide-react';
import { catAudio } from '../audio';
import { useState } from 'react';

interface ResultScreenProps {
  result: SessionResult;
  questions: Question[];
  userAnswers: { [questionId: string]: { selected?: string; isCorrect: boolean } };
  sessionHistory: SessionResult[];
  onRetry: () => void;
  onGoToPacks: () => void;
}

export default function ResultScreen({ result, questions, userAnswers, sessionHistory, onRetry, onGoToPacks }: ResultScreenProps) {
  const [showReview, setShowReview] = useState(false);

  useState(() => { catAudio.playCorrectChime(); });

  const getAccuracyVibe = (pct: number) => {
    if (pct >= 90) return { tagline: '👑 Best Cat Caretaker!', color: 'text-amber-600 bg-amber-50 border-amber-200', message: 'Magnificent! The cat considers you their ultimate best friend.', character: '😸' };
    if (pct >= 70) return { tagline: '🌸 Good Study Friend!', color: 'text-rose-600 bg-rose-50 border-rose-200', message: 'Wonderful work! The kitty is purring with joy.', character: '😺' };
    if (pct >= 50) return { tagline: '🐱 Cozy Assistant!', color: 'text-indigo-600 bg-indigo-50 border-indigo-200', message: 'A nice cozy session! The cat looks forward to more playtime.', character: '😼' };
    return { tagline: '🐾 Let\'s Practice More!', color: 'text-slate-600 bg-slate-50 border-slate-200', message: 'A valiant effort! Pet the cat more and try again.', character: '😿' };
  };

  const vibe = getAccuracyVibe(result.percentage);

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-4 animate-fade-in flex flex-col gap-6">
      <div className="bg-white/90 backdrop-blur-md rounded-3xl p-6 md:p-8 border border-pink-100 shadow-sm text-center flex flex-col items-center">
        <div className="text-6xl md:text-7xl mb-4 animate-bounce duration-[1500ms]">{vibe.character}</div>
        <span className={`text-xs md:text-sm font-bold uppercase tracking-widest px-4 py-1.5 rounded-full border ${vibe.color}`}>{vibe.tagline}</span>
        <h2 className="text-3xl font-extrabold text-gray-900 mt-4 leading-tight">Session Complete!</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto leading-relaxed">{vibe.message}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full mt-6 max-w-lg">
          <div className="bg-pink-50/40 border border-pink-100 p-4 rounded-2xl flex flex-col items-center justify-center">
            <span className="text-[10px] text-pink-600 uppercase font-bold tracking-wider font-mono">Accuracy</span>
            <span className="text-2xl font-black text-pink-700 font-mono mt-1">{result.percentage}%</span>
          </div>
          <div className="bg-teal-50/40 border border-teal-100 p-4 rounded-2xl flex flex-col items-center justify-center">
            <span className="text-[10px] text-teal-600 uppercase font-bold tracking-wider font-mono">Solved</span>
            <span className="text-2xl font-black text-teal-700 font-mono mt-1">{result.correctCount} / {result.totalQuestions}</span>
          </div>
          <div className="bg-amber-50/40 border border-amber-100 p-4 rounded-2xl flex flex-col items-center justify-center">
            <span className="text-[10px] text-amber-600 uppercase font-bold tracking-wider font-mono">Coins Earned</span>
            <span className="text-2xl font-black text-amber-700 font-mono mt-1">🪙 {result.coinsEarned}</span>
          </div>
          <div className="bg-rose-50/40 border border-rose-100 p-4 rounded-2xl flex flex-col items-center justify-center">
            <span className="text-[10px] text-rose-600 uppercase font-bold tracking-wider font-mono">Cat Cozy</span>
            <span className="text-2xl font-black text-rose-700 font-mono mt-1">😻 {result.finalHappiness}%</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 w-full mt-8">
          <button onClick={() => { catAudio.playTap(); onRetry(); }} className="px-5 py-3 bg-pink-600 hover:bg-pink-700 text-white font-bold rounded-2xl transition-all duration-150 cursor-pointer flex items-center gap-2 text-sm shadow-sm">
            <RefreshCw className="w-4 h-4" /> Try Pack Again
          </button>
          <button onClick={() => { catAudio.playTap(); onGoToPacks(); }} className="px-5 py-3 bg-amber-500 hover:bg-amber-600 text-amber-950 font-bold rounded-2xl transition-all duration-150 cursor-pointer flex items-center gap-2 text-sm shadow-sm">
            🐾 Switch Study Pack
          </button>
          <button onClick={() => { catAudio.playTap(); setShowReview(!showReview); }} className="px-5 py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-2xl transition-all duration-150 cursor-pointer flex items-center gap-2 text-sm">
            📝 {showReview ? 'Hide Log' : 'Review Log'}
          </button>
        </div>
      </div>
      {showReview && (
        <div className="bg-white rounded-3xl p-6 border border-indigo-50 shadow-sm animate-fade-in">
          <h3 className="text-md font-bold text-gray-800 flex items-center gap-2 mb-4 border-b border-gray-100 pb-2">📊 Question-by-Question Review</h3>
          <div className="flex flex-col gap-4">
            {questions.map((question, idx) => {
              const ansState = userAnswers[question.id];
              const isCorrect = ansState ? ansState.isCorrect : false;
              return (
                <div key={question.id} className="border border-gray-100 rounded-2xl p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs uppercase font-mono bg-pink-50 text-pink-700 px-2 py-0.5 rounded font-bold">Q{idx + 1} • {question.type === 'mcq' ? 'MCQ' : 'Match'}</span>
                    {isCorrect ? (
                      <span className="text-emerald-600 flex items-center gap-1 text-xs font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100"><CheckCircle2 className="w-3.5 h-3.5" /> Correct</span>
                    ) : (
                      <span className="text-rose-600 flex items-center gap-1 text-xs font-bold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100"><XCircle className="w-3.5 h-3.5" /> Incorrect</span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-gray-800 leading-snug">{question.text}</p>
                  {question.type === 'mcq' && (
                    <div className="text-xs text-gray-500 mt-1"><span className="font-semibold text-gray-600">Correct: </span>{question.options?.find((o) => o.id === question.correctOptionId)?.text}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {sessionHistory.length > 0 && (
        <div className="bg-gradient-to-b from-stone-50 to-stone-100 border border-stone-200/60 rounded-3xl p-6">
          <h3 className="text-sm font-black text-stone-700 uppercase tracking-wider flex items-center gap-1.5 mb-3">
            <History className="w-4 h-4 text-stone-500" /> Caretaking History
          </h3>
          <div className="flex flex-col gap-2">
            {sessionHistory.slice(-5).reverse().map((hist) => (
              <div key={hist.id} className="bg-white/80 border border-stone-200/50 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="bg-stone-100 w-8 h-8 rounded-xl flex items-center justify-center text-sm">📜</div>
                  <div>
                    <h4 className="font-bold text-stone-800 leading-tight">{hist.subjectName}</h4>
                    <span className="text-[10px] text-stone-400 flex items-center gap-1 mt-0.5"><Calendar className="w-3 h-3" /> {new Date(hist.timestamp).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right"><span className="text-[10px] font-bold text-stone-400 block uppercase">Score</span><span className="font-mono font-bold text-stone-700">{hist.correctCount} / {hist.totalQuestions}</span></div>
                  <div className="text-right"><span className="text-[10px] font-bold text-stone-400 block uppercase">Accuracy</span><span className="font-mono font-extrabold text-pink-600">{hist.percentage}%</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
