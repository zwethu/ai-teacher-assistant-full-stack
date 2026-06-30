import { useState, useEffect, useRef } from 'react';
import type { GameItem, AnswerRecord, BehaviorSummary } from '../../../types/catGame.types';

type Card = {
  id: string;
  text: string;
  pairId: string;
  side: 'left' | 'right';
};

type MatchState = 'unmatched' | 'matched' | 'wrong';

type Props = {
  items: GameItem[];
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[], behavior: BehaviorSummary) => void;
};

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function MatchAndTreat({ items, onCorrect, onWrong, onComplete }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [matchStates, setMatchStates] = useState<Record<string, MatchState>>({});
  const [playerPairs, setPlayerPairs] = useState<Record<string, string>>({}); // leftCardId → rightCardId

  // ─── Behavior tracking refs ─────────────────────────────────────────────
  const startTimeRef = useRef<number>(Date.now());
  const firstActionRef = useRef<number | null>(null);
  const submitCountRef = useRef(0);
  const wrongSubmitCountRef = useRef(0);
  const totalWrongPairsRef = useRef(0);
  const lastFeedbackTimeRef = useRef<number | null>(null);
  const reviewTimesRef = useRef<number[]>([]);

  useEffect(() => {
    const allCards: Card[] = [];
    items.forEach(item => {
      allCards.push({ id: `${item.id}-L`, text: item.term,       pairId: item.id, side: 'left' });
      allCards.push({ id: `${item.id}-R`, text: item.definition, pairId: item.id, side: 'right' });
    });
    setCards(shuffle(allCards));
    startTimeRef.current = Date.now();
    firstActionRef.current = null;
  }, [items]);

  function recordFirstAction() {
    if (firstActionRef.current === null) {
      firstActionRef.current = Date.now();
    }
    if (lastFeedbackTimeRef.current !== null) {
      reviewTimesRef.current.push(Date.now() - lastFeedbackTimeRef.current);
      lastFeedbackTimeRef.current = null;
    }
  }

  function handleCardClick(card: Card) {
    recordFirstAction();

    if (matchStates[card.pairId] === 'wrong') {
      setMatchStates(prev => ({ ...prev, [card.pairId]: 'unmatched' }));
    }
    if (matchStates[card.pairId] === 'matched') return;

    if (selected === null) {
      setSelected(card);
      return;
    }
    if (selected.id === card.id) {
      setSelected(null);
      return;
    }

    if (selected.side === card.side) {
      setSelected(card);
      return;
    }

    const leftCard  = selected.side === 'left' ? selected : card;
    const rightCard = selected.side === 'right' ? selected : card;

    setPlayerPairs(prev => ({ ...prev, [leftCard.id]: rightCard.id }));
    setSelected(null);
  }

  const leftCards  = cards.filter(c => c.side === 'left');
  const rightCards = cards.filter(c => c.side === 'right');
  const allPaired  = leftCards.every(lc => playerPairs[lc.id] !== undefined);

  // All cards mixed together for grid display
  const allShuffledCards = cards;

  function handleSubmit() {
    if (!allPaired) return;
    recordFirstAction();

    submitCountRef.current += 1;
    let wrongCount = 0;
    const newMatchStates: Record<string, MatchState> = {};
    const answers: AnswerRecord[] = [];

    leftCards.forEach(lc => {
      const pairedRightId = playerPairs[lc.id];
      const isCorrect = pairedRightId === `${lc.pairId}-R`;
      newMatchStates[lc.pairId] = isCorrect ? 'matched' : 'wrong';
      answers.push({ questionId: lc.pairId, correct: isCorrect });
      if (!isCorrect) wrongCount++;
    });

    totalWrongPairsRef.current += wrongCount;
    if (wrongCount > 0) {
      wrongSubmitCountRef.current += 1;
      onWrong();
    } else {
      onCorrect();
    }

    setMatchStates(newMatchStates);
    lastFeedbackTimeRef.current = Date.now();

    if (wrongCount === 0) {
      const behavior: BehaviorSummary = {
        firstActionDelayMs: firstActionRef.current
          ? firstActionRef.current - startTimeRef.current
          : 0,
        submitCount: submitCountRef.current,
        wrongSubmitCount: wrongSubmitCountRef.current,
        totalWrongLinksOrPairs: totalWrongPairsRef.current,
        reviewTimesMs: reviewTimesRef.current,
      };
      setTimeout(() => onComplete(answers, behavior), 800);
    }
  }

  return (
    <div className="mode-panel">
      <div className="question-progress">
        Pairs connected: {Object.keys(playerPairs).length} / {leftCards.length}
      </div>

      {/* Phone-number style grid: 3 columns, all cards mixed */}
      <div className="match-grid">
        {allShuffledCards.map(card => {
          const state = matchStates[card.pairId] ?? 'unmatched';
          const isPaired =
            card.side === 'left'
              ? playerPairs[card.id] !== undefined
              : Object.values(playerPairs).includes(card.id);
          return (
            <button
              key={card.id}
              className={[
                'match-card',
                state === 'matched'  ? 'matched'        : '',
                state === 'wrong'    ? 'wrong-pair'     : '',
                selected?.id === card.id ? 'selected'  : '',
                isPaired && state === 'unmatched' ? 'paired-pending' : '',
              ].join(' ')}
              onClick={() => handleCardClick(card)}
              disabled={state === 'matched'}
            >
              {state === 'matched' ? '🐟 ' : ''}{card.text}
            </button>
          );
        })}
      </div>

      <button
        className="submit-btn"
        onClick={handleSubmit}
        disabled={!allPaired}
      >
        {allPaired ? '✅ Submit Answers' : `Pair all ${leftCards.length} items first`}
      </button>

      <div className="match-hint">
        {selected
          ? `Selected: "${selected.text}" — now click its match`
          : 'Click a term, then click its matching definition'}
      </div>
    </div>
  );
}
