import { useState, useEffect } from 'react';
import type { MatchingQuestion, AnswerRecord } from '../../../types/catGame.types';

type Card = {
  id: string;
  text: string;
  pairId: string;
  side: 'left' | 'right';
  matched: boolean;
};

type Props = {
  questions: MatchingQuestion[];
  onMatch: () => void;
  onComplete: (answers: AnswerRecord[]) => void;
};

export default function MatchAndTreat({ questions, onMatch, onComplete }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);

  useEffect(() => {
    const allCards: Card[] = [];
    questions.forEach(q => {
      q.pairs.forEach((pair, i) => {
        const pairId = `${q.id}-pair-${i}`;
        allCards.push({ id: `${pairId}-L`, text: pair.left, pairId, side: 'left', matched: false });
        allCards.push({ id: `${pairId}-R`, text: pair.right, pairId, side: 'right', matched: false });
      });
    });
    setCards(shuffle(allCards));
  }, [questions]);

  function shuffle<T>(arr: T[]): T[] {
    return [...arr].sort(() => Math.random() - 0.5);
  }

  function handleCardClick(card: Card) {
    if (card.matched || shaking) return;
    if (selected === null) {
      setSelected(card);
      return;
    }
    if (selected.id === card.id) {
      setSelected(null);
      return;
    }

    const isMatch = selected.pairId === card.pairId && selected.side !== card.side;

    if (isMatch) {
      const newAnswers = [...answers, { questionId: card.pairId, correct: true }];
      setAnswers(newAnswers);
      setCards(prev => prev.map(c => c.pairId === card.pairId ? { ...c, matched: true } : c));
      setSelected(null);
      onMatch();

      const totalPairs = questions.reduce((acc, q) => acc + q.pairs.length, 0);
      if (newAnswers.length >= totalPairs) {
        setTimeout(() => onComplete(newAnswers), 600);
      }
    } else {
      setShaking(card.id);
      setAnswers(prev => [...prev, { questionId: card.pairId, correct: false }]);
      setTimeout(() => {
        setShaking(null);
        setSelected(null);
      }, 700);
    }
  }

  const matchedCount = cards.filter(c => c.matched && c.side === 'left').length;
  const totalPairs = questions.reduce((acc, q) => acc + q.pairs.length, 0);

  return (
    <div className="mode-panel">
      <div className="question-progress">
        Pairs matched: {matchedCount} / {totalPairs}
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
