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
  // Map from pairId → match state
  const [matchStates, setMatchStates] = useState<Record<string, MatchState>>({});
  // Track which pairId each card is currently paired to by the player
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
    // If there was feedback shown, record review time
    if (lastFeedbackTimeRef.current !== null) {
      reviewTimesRef.current.push(Date.now() - lastFeedbackTimeRef.current);
      lastFeedbackTimeRef.current = null;
    }
  }

  function handleCardClick(card: Card) {
    recordFirstAction();

    // Clear wrong state for this pair when player interacts again
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

    // Must be one left and one right to form a pair
    if (selected.side === card.side) {
      setSelected(card);
      return;
    }

    const leftCard  = selected.side === 'left' ? selected : card;
    const rightCard = selected.side === 'right' ? selected : card;

    // Record this as player's current pairing (overwrites previous pairing for this left card)
    setPlayerPairs(prev => ({ ...prev, [leftCard.id]: rightCard.id }));
    setSelected(null);
  }

  // Build display: which right card is each left card currently paired with?
  const leftCards  = cards.filter(c => c.side === 'left');
  const rightCards = cards.filter(c => c.side === 'right');

  // A pair is "pending" (shown as connected) if playerPairs has an entry for it
  const allPaired = leftCards.every(lc => playerPairs[lc.id] !== undefined);

  function handleSubmit() {
    if (!allPaired) return;
    recordFirstAction(); // in case first action was submit itself

    submitCountRef.current += 1;
    let wrongCount = 0;
    const newMatchStates: Record<string, MatchState> = {};
    const answers: AnswerRecord[] = [];

    leftCards.forEach(lc => {
      const pairedRightId = playerPairs[lc.id];
      // Correct if the right card belongs to the same item
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
      // All correct — compute behavior and complete
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

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mode-panel">
      <div className="question-progress">
        Pairs connected: {Object.keys(playerPairs).length} / {leftCards.length}
      </div>

      {/* Two-column layout: left terms | right definitions */}
      <div className="match-two-col">
        <div className="match-col">
          {leftCards.map(lc => {
            const state = matchStates[lc.pairId] ?? 'unmatched';
            const isPaired = playerPairs[lc.id] !== undefined;
            return (
              <button
                key={lc.id}
                className={[
                  'match-card',
                  state === 'matched' ? 'matched' : '',
                  state === 'wrong'   ? 'wrong-pair' : '',
                  selected?.id === lc.id ? 'selected' : '',
                  isPaired && state === 'unmatched' ? 'paired-pending' : '',
                ].join(' ')}
                onClick={() => handleCardClick(lc)}
                disabled={state === 'matched'}
              >
                {state === 'matched' ? '🐟 ' : ''}{lc.text}
              </button>
            );
          })}
        </div>

        <div className="match-col">
          {rightCards.map(rc => {
            const state = matchStates[rc.pairId] ?? 'unmatched';
            const isPairedByPlayer = Object.values(playerPairs).includes(rc.id);
            return (
              <button
                key={rc.id}
                className={[
                  'match-card',
                  state === 'matched' ? 'matched' : '',
                  state === 'wrong'   ? 'wrong-pair' : '',
                  selected?.id === rc.id ? 'selected' : '',
                  isPairedByPlayer && state === 'unmatched' ? 'paired-pending' : '',
                ].join(' ')}
                onClick={() => handleCardClick(rc)}
                disabled={state === 'matched'}
              >
                {state === 'matched' ? '🐟 ' : ''}{rc.text}
              </button>
            );
          })}
        </div>
      </div>

      {/* Submit button */}
      <button
        className="submit-btn"
        onClick={handleSubmit}
        disabled={!allPaired}
      >
        {allPaired ? '✅ Submit Answers' : `Pair all ${leftCards.length} items first`}
      </button>

      {/* Hint */}
      <div className="match-hint">
        {selected
          ? `Selected: "${selected.text}" — now click its match`
          : 'Click a term, then click its matching definition'}
      </div>
    </div>
  );
}
