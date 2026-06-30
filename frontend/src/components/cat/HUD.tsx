type HUDProps = {
  happiness: number;
  answered: number;
  totalQuestions: number;
};

export default function HUD({ happiness, answered, totalQuestions }: HUDProps) {
  const happinessColor =
    happiness > 60 ? '#6fcf97' :
    happiness > 30 ? '#f2c94c' :
    '#eb5757';

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
      </div>

      <div className="hud-item hud-center">
        <span className="hud-icon">📝</span>
        <span className="hud-value">{answered} / {totalQuestions}</span>
      </div>
    </div>
  );
}
