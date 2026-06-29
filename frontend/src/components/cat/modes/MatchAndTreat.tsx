import { useState, useEffect } from 'react';
import type { GameItem, AnswerRecord } from '../../../types/catGame.types';

type Card = {
  id: string;
  text: string;
  pairId: string;
  side: 'left' | 'right';
  matched: boolean;
};

type Props = {
  items: GameItem[];
  onMatch: () => void;
  onComplete: (answers: AnswerRecord[]) => void;
};

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function MatchAndTreat({ items, onMatch, onComplete }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);

  // Build cards from GameItem[]: term on left, definition on right
  useEffect(() => {
    const allCards: Card[] = [];
    items.forEach(item => {
      allCards.push({ id: `${item.id}-L`, text: item.term,       pairId: item.id, side: 'left',  matched: false });
      allCards.push({ id: `${item.id}-R`, text: item.definition, pairId: item.id, side: 'right', matched: false });
    });
    setCards(shuffle(allCards));
  }, [items]);

  function handleCardClick(card: Card) {
    if (card.matched || shaking) return;
    if (selected === null) { setSelected(card); return; }
    if (selected.id === card.id) { setSelected(null); return; }

    const isMatch = selected.pairId === card.pairId && selected.side !== card.side;

    if (isMatch) {
      const newAnswers = [...answers, { questionId: card.pairId, correct: true }];
      setAnswers(newAnswers);
      setCards(prev => prev.map(c => c.pairId === card.pairId ? { ...c, matched: true } : c));
      setSelected(null);
      onMatch();
      if (newAnswers.length >= items.length) {
        setTimeout(() => onComplete(newAnswers), 600);
      }
    } else {
      setShaking(card.id);
      setAnswers(prev => [...prev, { questionId: card.pairId, correct: false }]);
      setTimeout(() => { setShaking(null); setSelected(null); }, 700);
    }
  }

  const matchedCount = cards.filter(c => c.matched && c.side === 'left').length;

  return (
    <div className="mode-panel">
      <div className="question-progress">
        Pairs matched: {matchedCount} / {items.length}
      </div>
      <div className="match-grid">
        {cards.map(card => (
          <button
            key={card.id}
            className={[
              'match-card',
              card.matched ? 'matched' : '',
              selected?.id === card.id ? 'selected' : '',
              shaking === card.id ? 'shake' : '',
            ].join(' ')}
            onClick={() => handleCardClick(card)}
            disabled={card.matched}
          >
            {card.matched ? '🐟' : card.text}
          </button>
        ))}
      </div>
    </div>
  );
}
