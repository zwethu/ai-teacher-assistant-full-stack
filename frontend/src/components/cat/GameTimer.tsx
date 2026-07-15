type Props = {
  remainingMs: number;
  timeLimitMs: number;
};

function fmt(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function GameTimer({ remainingMs, timeLimitMs }: Props) {
  const frac = timeLimitMs > 0 ? Math.max(0, remainingMs / timeLimitMs) : 0;
  const stage = frac > 0.5 ? 'calm' : frac > 0.2 ? 'warn' : 'danger';

  return (
    <div className={`game-timer game-timer--${stage}`} role="timer" aria-label="Time remaining">
      <span className="game-timer-icon">⏱️</span>
      <span className="game-timer-text">{fmt(remainingMs)}</span>
      <div className="game-timer-bar">
        <div className="game-timer-fill" style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
