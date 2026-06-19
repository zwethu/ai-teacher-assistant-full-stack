type HUDProps = {
  happiness: number;
  answered: number;
  totalQuestions: number;
  coins: number;
};

export default function HUD({ happiness, answered, totalQuestions, coins }: HUDProps) {
  const happinessColor = happiness > 60 ? '#7bc67e' : happiness > 30 ? '#ffd166' : '#ef6c6c';

  return (
    <div className="hud">
      <div className="hud-item">
        <span className="hud-icon">🐱</span>
        <div className="happiness-bar-bg">
          <div
            className="happiness-bar-fill"
            style={{ width: `${happiness}%`, backgroundColor: happinessColor }}
          />
        </div>
        <span className="hud-value">{happiness}</span>
      </div>

      <div className="hud-item hud-center">
        <span className="hud-icon">📝</span>
        <span className="hud-value">
          Q {answered} / {totalQuestions}
        </span>
      </div>

      <div className="hud-item hud-right">
        <span className="hud-icon">🐟</span>
        <span className="hud-value">{coins}</span>
      </div>
    </div>
  );
}
