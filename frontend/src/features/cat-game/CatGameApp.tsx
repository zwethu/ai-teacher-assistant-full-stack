import { useState, useEffect } from 'react';
import type { SubjectPack, Question, CatMood, SessionResult } from './types';
import { SUBJECT_PACKS } from './questions';
import CatVisualizer from './components/CatVisualizer';
import MiniHUD from './components/MiniHUD';
import ModeAPetChoose from './components/ModeAPetChoose';
import ModeBMatchTreat from './components/ModeBMatchTreat';
import ResultScreen from './components/ResultScreen';
import { catAudio } from './audio';
import { ChevronRight } from 'lucide-react';

export default function CatGameApp() {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'results'>('menu');
  const [selectedPack, setSelectedPack] = useState<SubjectPack>(SUBJECT_PACKS[0]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<{ [questionId: string]: { selected?: string; isCorrect: boolean } }>({});
  const [coins, setCoins] = useState(0);
  const [fish, setFish] = useState(0);
  const [catHappiness, setCatHappiness] = useState(65);
  const [trustMeter, setTrustMeter] = useState(0);
  const [sessionCorrectCount, setSessionCorrectCount] = useState(0);
  const [catMood, setCatMood] = useState<CatMood>('idle');
  const [moodTimer, setMoodTimer] = useState<any>(null);
  const [history, setHistory] = useState<SessionResult[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem('cat_caretaker_logs');
    if (saved) { try { setHistory(JSON.parse(saved)); } catch {} }
  }, []);

  const setCatAnimationAndAutoReset = (mood: CatMood, durationMs = 2500) => {
    if (moodTimer) clearTimeout(moodTimer);
    setCatMood(mood);
    const timer = setTimeout(() => setCatMood(trustMeter >= 100 ? 'purring' : 'idle'), durationMs);
    setMoodTimer(timer);
  };

  const handlePetCat = () => {
    setTrustMeter((prev) => {
      const next = Math.min(prev + 4, 100);
      if (next >= 100 && prev < 100) { setCatAnimationAndAutoReset('purring', 4000); setCatHappiness((h) => Math.min(h + 10, 100)); }
      else if (prev < 100) { setCatAnimationAndAutoReset('purring', 1200); setCatHappiness((h) => Math.min(h + 0.5, 100)); }
      return next;
    });
  };

  const startSession = (pack: SubjectPack) => {
    setSelectedPack(pack); setCurrentIndex(0); setUserAnswers({});
    setCoins(0); setFish(0); setCatHappiness(60); setTrustMeter(0);
    setSessionCorrectCount(0); setCatMood('idle'); setGameState('playing');
    catAudio.init(); catAudio.playMeow(); catAudio.startBGM();
  };

  const handleAnswerSubmit = (isCorrect: boolean) => {
    const currentQ = selectedPack.questions[currentIndex];
    setUserAnswers((prev) => ({ ...prev, [currentQ.id]: { isCorrect } }));
    if (isCorrect) {
      setSessionCorrectCount((c) => c + 1);
      setCoins((c) => c + (trustMeter >= 100 ? 30 : 15));
      setFish((f) => f + 1);
      setCatHappiness((h) => Math.min(h + 15, 100));
      setCatAnimationAndAutoReset('happy', 3000);
    } else {
      setCatHappiness((h) => Math.max(h - 8, 20));
      setCatAnimationAndAutoReset('confused', 3500);
    }
  };

  const handleNextStep = () => {
    catAudio.playTap();
    const nextIdx = currentIndex + 1;
    if (nextIdx < selectedPack.questions.length) {
      setCurrentIndex(nextIdx);
    } else {
      const totalQ = selectedPack.questions.length;
      const finalPct = Math.round((sessionCorrectCount / totalQ) * 100);
      const newSession: SessionResult = {
        id: `sess_${Date.now()}`, timestamp: new Date().toISOString(),
        subjectName: selectedPack.name, correctCount: sessionCorrectCount,
        totalQuestions: totalQ, percentage: finalPct,
        coinsEarned: coins, finalHappiness: Math.round(catHappiness),
      };
      const updatedHistory = [...history, newSession];
      setHistory(updatedHistory);
      localStorage.setItem('cat_caretaker_logs', JSON.stringify(updatedHistory));
      setGameState('results');
    }
  };

  const questionsCount = selectedPack.questions.length;
  const currentQuestion = selectedPack.questions[currentIndex];
  const isQuestionAnswered = !!userAnswers[currentQuestion?.id];

  return (
    <div className="bg-gradient-to-b from-rose-50/60 via-amber-50/40 to-indigo-50/50 min-h-screen text-gray-800 flex flex-col p-4 md:p-6 select-none relative overflow-x-hidden font-sans">
      <div className="absolute top-0 right-0 w-2/5 h-2/5 bg-gradient-to-bl from-amber-200/10 to-transparent pointer-events-none rounded-bl-full rotate-12 blur-3xl" />
      <div className="absolute bottom-10 left-10 w-64 h-64 bg-pink-300/5 pointer-events-none rounded-full blur-3xl" />

      {gameState === 'menu' && (
        <div className="flex-1 flex flex-col items-center justify-center max-w-4xl mx-auto w-full py-8 text-center relative z-10">
          <div className="mb-6 flex flex-col items-center">
            <div className="bg-pink-100 p-4 rounded-3xl shadow-sm border border-pink-200 mb-3 animate-bounce duration-[3000ms]">
              <span className="text-6xl">🐈</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-rose-950 tracking-tight">Cozy Cat Academy</h1>
            <p className="text-sm font-semibold text-rose-700/80 mt-1 uppercase tracking-widest font-mono">Cat Petting & Caretaking Assessment</p>
            <p className="text-xs text-gray-500 mt-2 max-w-sm">Learn while caring for your interactive pet kitty!</p>
          </div>
          <div className="bg-amber-100/65 border border-amber-200 rounded-2xl px-4 py-2.5 max-w-md text-xs font-semibold text-amber-900 mb-8 flex items-center gap-2 leading-snug shadow-xs">
            💡 <p>Choose a category. Answer MCQ or match cards to please the cat and increase trust!</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mb-8">
            {SUBJECT_PACKS.map((pack) => {
              const isSelected = selectedPack.id === pack.id;
              return (
                <button key={pack.id} onClick={() => { catAudio.playTap(); setSelectedPack(pack); }}
                  className={`bg-white/80 p-6 rounded-3xl border text-center transition-all duration-200 flex flex-col items-center cursor-pointer group hover:scale-102 ${
                    isSelected ? 'border-pink-400 ring-2 ring-pink-300/50 bg-white shadow-md' : 'border-pink-100/50 hover:shadow-sm hover:border-pink-300 shadow-inner'
                  }`}>
                  <span className="text-4xl mb-3 group-hover:animate-bounce duration-1000">{pack.icon}</span>
                  <h3 className="font-bold text-gray-900 group-hover:text-pink-600 transition-colors text-base">{pack.name}</h3>
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed">{pack.description}</p>
                  <span className="text-[10px] bg-pink-50 text-pink-700 px-2 py-0.5 mt-4 rounded-full font-bold uppercase tracking-wider">{pack.questions.length} questions</span>
                </button>
              );
            })}
          </div>
          <button onClick={() => startSession(selectedPack)}
            className="bg-pink-600 hover:bg-pink-700 text-white font-extrabold px-10 py-4 rounded-2xl text-lg transition-all duration-150 shadow-md hover:shadow-lg cursor-pointer transform hover:scale-102 active:scale-98 flex items-center gap-2">
            Start Caretaking Session 🐾
          </button>
          {history.length > 0 && (
            <div className="mt-12 bg-white/50 border border-pink-100/60 rounded-2xl p-4 w-full text-xs max-w-md text-left">
              <span className="font-bold text-gray-700 block mb-2 uppercase tracking-wide font-mono">📜 Recent Sessions:</span>
              <div className="flex flex-col gap-1.5">
                {history.slice(-3).reverse().map((hist, idx) => (
                  <div key={idx} className="flex items-center justify-between font-mono font-medium text-gray-500">
                    <span>{hist.subjectName} ({new Date(hist.timestamp).toLocaleDateString()})</span>
                    <span className="text-pink-600 font-bold">{hist.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {gameState === 'playing' && currentQuestion && (
        <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full gap-4 relative z-10">
          <MiniHUD
            coins={coins} fish={fish} happiness={catHappiness}
            currentIndex={currentIndex} totalQuestions={questionsCount}
            subjectName={selectedPack.name}
            onReset={() => { if (confirm('Reset session?')) { setGameState('menu'); catAudio.stopBGM(); } }}
            onOpenPacks={() => { setGameState('menu'); catAudio.stopBGM(); }}
          />
          <div className="flex-1 flex flex-col items-center justify-center py-4 bg-white/20 backdrop-blur-xs rounded-3xl border border-white/40 shadow-xs relative">
            <CatVisualizer mood={catMood} trustProgress={trustMeter} onPet={handlePetCat} />
            {trustMeter >= 100 && (
              <div className="absolute top-2 right-4 bg-amber-400 text-amber-950 font-extrabold px-3 py-1 rounded-full text-[10px] uppercase shadow-xs tracking-wider animate-pulse">
                🔥 2x Trust Multiplier Active!
              </div>
            )}
          </div>
          <div className="bg-white/95 rounded-3xl p-6 shadow-sm border border-pink-50 min-h-[300px] flex flex-col justify-between">
            {currentQuestion.type === 'mcq' ? (
              <ModeAPetChoose question={currentQuestion} trustProgress={trustMeter} onAnswer={handleAnswerSubmit} />
            ) : (
              <ModeBMatchTreat question={currentQuestion} onAnswer={handleAnswerSubmit} onAnimationTrigger={(mood) => setCatAnimationAndAutoReset(mood, 2200)} />
            )}
            {isQuestionAnswered && (
              <div className="mt-6 flex flex-col items-center w-full">
                <button onClick={handleNextStep}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-3.5 rounded-2xl transition-all duration-150 flex items-center gap-2 text-sm shadow-sm cursor-pointer">
                  {currentIndex + 1 < questionsCount ? 'Next Question 🐾' : 'See Results 👑'}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {gameState === 'results' && (
        <div className="flex-1 max-w-3xl mx-auto w-full py-4 z-10 relative">
          <ResultScreen
            result={{ id: `sess_${Date.now()}`, timestamp: new Date().toISOString(), subjectName: selectedPack.name, correctCount: sessionCorrectCount, totalQuestions: questionsCount, percentage: Math.round((sessionCorrectCount / questionsCount) * 100), coinsEarned: coins, finalHappiness: Math.round(catHappiness) }}
            questions={selectedPack.questions}
            userAnswers={userAnswers}
            sessionHistory={history}
            onRetry={() => startSession(selectedPack)}
            onGoToPacks={() => { setGameState('menu'); catAudio.stopBGM(); }}
          />
        </div>
      )}
    </div>
  );
}
