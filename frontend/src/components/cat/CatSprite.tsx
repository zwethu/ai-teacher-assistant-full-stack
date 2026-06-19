type CatSpriteProps = {
  mood: 'idle' | 'happy' | 'confused' | 'playful';
};

const moodEmoji: Record<string, string> = {
  idle: '😺',
  happy: '😸',
  confused: '😿',
  playful: '🙀',
};

const moodLabel: Record<string, string> = {
  idle: '',
  happy: '✨ Purr!',
  confused: '😕 Hmm...',
  playful: '🎉 Yay!',
};

export default function CatSprite({ mood }: CatSpriteProps) {
  return (
    <div className={`cat-sprite cat-mood-${mood}`}>
      <div className="cat-emoji">{moodEmoji[mood]}</div>
      {moodLabel[mood] && (
        <div className="cat-mood-label">{moodLabel[mood]}</div>
      )}
    </div>
  );
}
