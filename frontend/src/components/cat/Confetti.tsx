const COLORS = ['#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#a855f7', '#fb7185', '#facc15'];

// Deterministic (index-based) so it never needs Math.random.
export default function Confetti({ count = 44 }: { count?: number }) {
  return (
    <div className="confetti-layer" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const left  = (i * 97) % 100;
        const delay = ((i * 7) % 12) * 0.12;
        const dur   = 2.2 + ((i * 3) % 5) * 0.3;
        const size  = 6 + (i % 4) * 2;
        const color = COLORS[i % COLORS.length];
        const tilt  = ((i * 53) % 90) - 45;
        return (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${left}%`,
              width: `${size}px`,
              height: `${size}px`,
              background: color,
              transform: `rotate(${tilt}deg)`,
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
            }}
          />
        );
      })}
    </div>
  );
}
