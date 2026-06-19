type HUDProps = {
  happiness: number;
  answered: number;
  totalQuestions: number;
  fish: number;
};

export default function HUD({ happiness, answered, totalQuestions, fish }: HUDProps) {
  const happinessColor =
    happiness > 60 ? '#6fcf97' :
    happiness > 30 ? '#f2c94c' :
    '#eb5757';

  const fishInJar = Math.min(fish, 20);

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

      <div className="hud-item hud-right">
        <div className="treat-jar">
          <div className="treat-jar-fill" style={{ height: `${(fishInJar / 20) * 100}%` }} />
          <span className="treat-jar-icon">🫙</span>
        </div>
        <span className="hud-value">× {fish}</span>
        <span className="hud-icon">🐟</span>
      </div>
    </div>
  );
}
