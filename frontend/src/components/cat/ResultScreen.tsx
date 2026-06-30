import { useEffect, useState } from 'react';
import type { AnswerRecord } from '../../types/catGame.types';
import CatSprite from './CatSprite';

type Props = {
  answers: AnswerRecord[];
  totalQuestions: number;
  happiness: number;
  fish?: number; // kept for backward compat but unused
  nickname?: string;
  onRestart?: () => void;
};

export default function ResultScreen({ answers, totalQuestions, happiness, nickname, onRestart }: Props) {
  const correct  = answers.filter(a => a.correct).length;
  const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 600);
    return () => clearTimeout(t);
  }, []);

  const badge =
    accuracy >= 80 ? '🏆 Excellent work!' :
    accuracy >= 50 ? '🐾 Good effort!'     :
    '💪 Keep practicing!';

  const spriteMood = accuracy >= 80 ? 'happy' : accuracy >= 50 ? 'smiling' : 'idle';

  const catLabel =
    accuracy >= 80 ? 'So proud of you! ♥' :
    accuracy >= 50 ? 'Well done~'           :
    'You can do it!';

  return (
    <div className="result-screen">
      <div className="result-card">

        {nickname && (
          <p style={{
            margin: 0, fontSize: '0.82rem', fontWeight: 700,
            color: '#b09080', background: '#fff8f4',
            borderRadius: '16px', padding: '4px 14px',
            border: '1.5px solid #f4e4d4'
          }}>
            🐾 {nickname}'s result
          </p>
        )}

        <div className="result-cat-wrap full">
          <CatSprite mood={spriteMood} size="result" />
          <p className="result-cat-label">{catLabel}</p>
        </div>

        {show && (
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
