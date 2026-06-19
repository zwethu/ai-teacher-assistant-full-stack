import type { AnswerRecord } from '../../types/catGame.types';

type Props = {
  answers: AnswerRecord[];
  totalQuestions: number;
  happiness: number;
  coins: number;
  onRestart: () => void;
};

export default function ResultScreen({ answers, totalQuestions, happiness, coins, onRestart }: Props) {
  const correct = answers.filter(a => a.correct).length;
  const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

  const badge =
    accuracy >= 80 ? '🏆 Best Cat Caretaker!' :
    accuracy >= 50 ? '🐾 Good Study Friend!' :
    '💪 Needs More Practice!';

  const catFinal =
    happiness >= 70 ? '😸' :
    happiness >= 40 ? '😺' :
    '😿';

  const catStatus =
    happiness >= 70 ? 'Very Happy Cat!' :
    happiness >= 40 ? 'Happy Cat' :
    'Needs More Cuddles';

  return (
    <div className="result-screen">
      <div className="result-card">
        <div className="result-cat">{catFinal}</div>
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
            <span className="stat-label">🐟 Fish earned</span>
            <span className="stat-value">{coins}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">😺 Cat mood</span>
            <span className="stat-value">{catStatus}</span>
          </div>
        </div>

        <button className="restart-btn" onClick={onRestart}>
          🔄 Play Again
        </button>
      </div>
    </div>
  );
}
