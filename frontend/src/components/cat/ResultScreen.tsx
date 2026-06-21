import { useEffect, useState } from 'react';
import type { AnswerRecord } from '../../types/catGame.types';
import CatSprite from './CatSprite';

type Props = {
  answers: AnswerRecord[];
  totalQuestions: number;
  happiness: number;
  fish: number;
  nickname?: string;
  onRestart?: () => void;
};

export default function ResultScreen({ answers, totalQuestions, happiness, fish, nickname, onRestart }: Props) {
  const correct = answers.filter(a => a.correct).length;
  const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

  const [phase, setPhase] = useState<'intro' | 'treating' | 'done'>('intro');
  const [remainingFish, setRemainingFish] = useState(fish);
  const [catMood, setCatMood] = useState<'waiting' | 'eating' | 'full'>('waiting');

  useEffect(() => {
    const t1 = setTimeout(() => {
      setPhase('treating');
      setCatMood('eating');
      let count = fish;
      const interval = setInterval(() => {
        count -= 1;
        setRemainingFish(c => Math.max(0, c - 1));
        if (count <= 0) {
          clearInterval(interval);
          setTimeout(() => {
            setCatMood('full');
            setPhase('done');
          }, 600);
        }
      }, Math.max(60, 1200 / (fish || 1)));
      return () => clearInterval(interval);
    }, 900);
    return () => clearTimeout(t1);
  }, [fish]);

  const badge =
    accuracy >= 80 ? '🏆 Best Cat Caretaker!' :
    accuracy >= 50 ? '🐾 Good Study Friend!' :
    '💪 Keep Practicing!';

  // Map feeding phase to CatSprite mood
  const spriteMood =
    catMood === 'eating'  ? 'eating' :
    catMood === 'full'    ? (happiness >= 60 ? 'happy' : 'smiling') :
    'idle';

  const catLabel =
    catMood === 'eating' ? 'Nom nom nom...' :
    catMood === 'full'   ? (happiness >= 70 ? 'So full and happy! ♡' : 'Thank you~') :
    'Waiting for treats...';

  return (
    <div className="result-screen">
      <div className="result-card">

        {nickname && (
          <p style={{
            margin: 0,
            fontSize: '0.82rem',
            fontWeight: 700,
            color: '#b09080',
            background: '#fff8f4',
            borderRadius: '16px',
            padding: '4px 14px',
            border: '1.5px solid #f4e4d4'
          }}>
            🐾 {nickname}'s result
          </p>
        )}

        <div className={`result-cat-wrap ${catMood}`}>
          <CatSprite mood={spriteMood} size="result" />
          <div className="result-cat-bowl">
            {catMood === 'eating' && <span className="bowl-fish">🐟</span>}
            🥣
          </div>
          <p className="result-cat-label">{catLabel}</p>
        </div>

        {phase === 'treating' && (
          <div className="treating-counter">
            <span className="treating-fish">🐟</span>
            <span className="treating-number">× {remainingFish}</span>
            <span className="treating-sub">feeding...</span>
          </div>
        )}

        {phase === 'done' && (
          <>
            <h2 className="result-badge">{badge}</h2>
            <div className="result-stats">
              <div className="stat-row">
                <span className="stat-label">✅ Correct</span>
                <span className="stat-value">{correct} / {totalQuestions}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">🎯 Accuracy</span>
                <span className="stat-value">{accuracy}%</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">🐟 Fish given</span>
                <span className="stat-value">{fish}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">💛 Happiness</span>
                <span className="stat-value">{happiness} / 100</span>
              </div>
            </div>
            {onRestart && (
              <button className="restart-btn" onClick={onRestart}>
                🔄 Play Again
              </button>
            )}
            {!onRestart && (
              <p style={{
                fontSize: '0.82rem', fontWeight: 700,
                color: '#b09080', margin: 0,
                background: '#fff8f4', borderRadius: '16px',
                padding: '6px 16px', border: '1.5px solid #f4e4d4'
              }}>
                ✅ Result saved! Good job 🐾
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
