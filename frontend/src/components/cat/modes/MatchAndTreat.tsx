import { useState, useEffect, useRef } from 'react';
import type { GameItem, AnswerRecord, BehaviorSummary } from '../../../types/catGame.types';

type Card = {
  id: string;
  text: string;
  pairId: string;
  side: 'term' | 'definition';
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
  const [playerPairs, setPlayerPairs] = useState<Record<string, string>>({}); // bidirectional: cardId -> cardId

  const startTimeRef        = useRef<number>(Date.now());
  const firstActionRef      = useRef<number | null>(null);
  const submitCountRef      = useRef(0);
  const wrongSubmitCountRef = useRef(0);
  const totalWrongPairsRef  = useRef(0);
  const lastFeedbackTimeRef = useRef<number | null>(null);
  const reviewTimesRef      = useRef<number[]>([]);

  useEffect(() => {
    const allCards: Card[] = [];
    items.forEach(item => {
      allCards.push({ id: `${item.id}-T`, text: item.term,       pairId: item.id, side: 'term' });
      allCards.push({ id: `${item.id}-D`, text: item.definition, pairId: item.id, side: 'definition' });
    });
    setCards(shuffle(allCards));
    setSelected(null);
    setMatchStates({});
    setPlayerPairs({});
    startTimeRef.current = Date.now();
    firstActionRef.current = null;
  }, [items]);

  function recordFirstAction() {
    if (firstActionRef.current === null) firstActionRef.current = Date.now();
    if (lastFeedbackTimeRef.current !== null) {
      reviewTimesRef.current.push(Date.now() - lastFeedbackTimeRef.current);
      lastFeedbackTimeRef.current = null;
    }
  }

  function handleCardClick(card: Card) {
    recordFirstAction();

    if (matchStates[card.pairId] === 'matched') return;

    if (matchStates[card.pairId] === 'wrong') {
      const partnerId    = playerPairs[card.id];
      const partnerPairId = cards.find(c => c.id === partnerId)?.pairId;
      setMatchStates(prev => {
        const next = { ...prev, [card.pairId]: 'unmatched' as MatchState };
        if (partnerPairId) next[partnerPairId] = 'unmatched';
        return next;
      });
      setPlayerPairs(prev => {
        const next = { ...prev };
        if (partnerId) delete next[partnerId];
        delete next[card.id];
        return next;
      });
      setSelected(card);
      return;
    }

    if (selected?.id === card.id) { setSelected(null); return; }
    if (selected === null)        { setSelected(card);  return; }

    // Same side — swap selection
    if (selected.side === card.side) { setSelected(card); return; }

    // Different sides — pair them
    const termCard = selected.side === 'term' ? selected : card;
    const defCard  = selected.side === 'definition' ? selected : card;

    setPlayerPairs(prev => {
      const next = { ...prev };
      if (next[termCard.id]) { delete next[next[termCard.id]]; delete next[termCard.id]; }
      if (next[defCard.id])  { delete next[next[defCard.id]];  delete next[defCard.id]; }
      next[termCard.id] = defCard.id;
      next[defCard.id]  = termCard.id;
      return next;
    });
    setSelected(null);
  }

  const termCards = cards.filter(c => c.side === 'term');
  const allPaired = termCards.length > 0 && termCards.every(tc => playerPairs[tc.id] !== undefined);

  function handleSubmit() {
    if (!allPaired) return;
    recordFirstAction();

    submitCountRef.current += 1;
    let wrongCount = 0;
    const newMatchStates: Record<string, MatchState> = {};
    const answers: AnswerRecord[] = [];

    termCards.forEach(tc => {
      const pairedDefId = playerPairs[tc.id];
      const isCorrect   = pairedDefId === `${tc.pairId}-D`;
      newMatchStates[tc.pairId] = isCorrect ? 'matched' : 'wrong';
      const defCard = cards.find(c => c.id === pairedDefId);
      if (defCard) newMatchStates[defCard.pairId] = isCorrect ? 'matched' : 'wrong';
      answers.push({ questionId: tc.pairId, correct: isCorrect });
      if (!isCorrect) wrongCount++;
    });

    totalWrongPairsRef.current += wrongCount;
    if (wrongCount > 0) {
      wrongSubmitCountRef.current += 1;
      onWrong();
      setPlayerPairs(prev => {
        const next = { ...prev };
        termCards.forEach(tc => {
          if (newMatchStates[tc.pairId] === 'wrong') {
            const defId = next[tc.id];
            if (defId) delete next[defId];
            delete next[tc.id];
          }
        });
        return next;
      });
    } else {
      onCorrect();
    }

    setMatchStates(newMatchStates);
    lastFeedbackTimeRef.current = Date.now();

    if (wrongCount === 0) {
      const behavior: BehaviorSummary = {
        firstActionDelayMs:     firstActionRef.current ? firstActionRef.current - startTimeRef.current : 0,
        submitCount:            submitCountRef.current,
        wrongSubmitCount:       wrongSubmitCountRef.current,
        totalWrongLinksOrPairs: totalWrongPairsRef.current,
        reviewTimesMs:          reviewTimesRef.current,
      };
      setTimeout(() => onComplete(answers, behavior), 800);
    }
  }

  return (
    <form className="mode-panel" autoComplete="off" onSubmit={e => e.preventDefault()}>
      <div className="question-progress">
        Pairs connected: {termCards.filter(tc => playerPairs[tc.id]).length} / {termCards.length}
      </div>

      <div className="match-grid" translate="no">
        {cards.map(card => {
          const state     = matchStates[card.pairId] ?? 'unmatched';
          const isMatched = state === 'matched';
          const isPaired  = playerPairs[card.id] !== undefined;
          return (
            <div
              key={card.id}
              role="button"
              tabIndex={isMatched ? -1 : 0}
              aria-disabled={isMatched}
              className={[
                'match-card',
                isMatched                 ? 'matched'       : '',
                state === 'wrong'         ? 'wrong-pair'    : '',
                selected?.id === card.id  ? 'selected'      : '',
                isPaired && !isMatched    ? 'paired-pending': '',
              ].filter(Boolean).join(' ')}
              onClick={() => !isMatched && handleCardClick(card)}
              onKeyDown={e => {
                if (isMatched) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(card); }
              }}
            >
              {isMatched ? '✅ ' : ''}{card.text}
            </div>
          );
        })}
      </div>

      <button
        type="submit"
        className="submit-btn"
        onClick={handleSubmit}
        disabled={!allPaired}
      >
        {allPaired ? '✅ Submit Answers' : `Pair all ${termCards.length} items first`}
      </button>

      <div className="match-hint">
        {selected
          ? `Selected: "${selected.text}" — now click its match`
          : 'Click any card, then click its match'}
      </div>
    </form>
  );
}
