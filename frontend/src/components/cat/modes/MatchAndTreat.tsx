import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, Question, Lightbulb } from '@phosphor-icons/react';
import type { GameItem, AnswerRecord, BehaviorSignals } from '../../../types/catGame.types';
import CardBird from '../CardBird';
import { playSnap, playUnsnap } from '../juice';

type Card = {
  id: string;
  text: string;
  pairId: string;
  side: 'term' | 'definition';
};

type MatchState = 'unmatched' | 'matched' | 'wrong';

type Props = {
  items: GameItem[];
  timeUp: boolean;
  /** False only for a demo skip: score just the cards the player paired,
   *  instead of counting every untouched card as wrong. */
  countUnplaced?: boolean;
  sidebar?: ReactNode;
  /** "Round X of Y" node, shown in the footer's top row (left of Submit). */
  roundIndicator?: ReactNode;
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[], signals: BehaviorSignals) => void;
};

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

export default function MatchAndTreat({ items, timeUp, countUnplaced = true, sidebar, roundIndicator, onCorrect, onWrong, onComplete }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [matchStates, setMatchStates] = useState<Record<string, MatchState>>({});
  const [playerPairs, setPlayerPairs] = useState<Record<string, string>>({}); // bidirectional: cardId -> cardId
  const [celebrating, setCelebrating] = useState<Set<string>>(new Set());     // pairIds that just turned correct

  const startTimeRef        = useRef<number>(Date.now());
  const firstActionRef      = useRef<number | null>(null);
  const submitCountRef      = useRef(0);
  const wrongSubmitCountRef = useRef(0);
  const totalWrongPairsRef  = useRef(0);
  const lastFeedbackTimeRef = useRef<number | null>(null);
  const reviewTimesRef      = useRef<number[]>([]);
  const finishedRef         = useRef(false);

  function buildSignals(): BehaviorSignals {
    return {
      firstActionDelayMs:     firstActionRef.current ? firstActionRef.current - startTimeRef.current : 0,
      submitCount:            submitCountRef.current,
      wrongSubmitCount:       wrongSubmitCountRef.current,
      totalWrongLinksOrPairs: totalWrongPairsRef.current,
      reviewTimesMs:          reviewTimesRef.current,
    };
  }

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

    // Clicking a wrong pair breaks it open for another go — same dismissal as
    // the ✕, so it gets the same cue.
    if (matchStates[card.pairId] === 'wrong') {
      const partnerId    = playerPairs[card.id];
      const partnerPairId = cards.find(c => c.id === partnerId)?.pairId;
      if (partnerId) playUnsnap();
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
    playSnap();
    setSelected(null);
  }

  // Break a not-yet-submitted pair (both cards return to unpaired).
  function unpair(card: Card) {
    recordFirstAction();
    const partnerId = playerPairs[card.id];
    if (partnerId) playUnsnap();
    setPlayerPairs(prev => {
      const next = { ...prev };
      if (partnerId) delete next[partnerId];
      delete next[card.id];
      return next;
    });
    if (selected && (selected.id === card.id || selected.id === partnerId)) setSelected(null);
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

    // The flock flies only when the WHOLE round comes back clean — birds on
    // each newly-matched pair made a half-right board feel like a win.
    if (wrongCount === 0) {
      setCelebrating(new Set(termCards.map(tc => tc.pairId)));
      setTimeout(() => setCelebrating(new Set()), 2000);
    }

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
      finishedRef.current = true;
      const signals = buildSignals();
      // Long enough for the flock + fanfare to land before the page turns —
      // at the old 800ms the celebration was cut off mid-flight.
      setTimeout(() => onComplete(answers, signals), 1800);
    }
  }

  // Timeout: grade whatever's currently on the board as the final attempt.
  useEffect(() => {
    if (!timeUp || finishedRef.current) return;
    finishedRef.current = true;
    const finalAnswers: AnswerRecord[] = termCards
      .filter(tc => countUnplaced || playerPairs[tc.id] !== undefined)
      .map(tc => ({
        questionId: tc.pairId,
        correct: playerPairs[tc.id] === `${tc.pairId}-D`,
      }));
    onComplete(finalAnswers, buildSignals());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  return (
    <form className="mode-layout" autoComplete="off" onSubmit={e => e.preventDefault()}>
      <div className="mode-side">
        {sidebar}
      </div>

      <div className="mode-main">
      <div className="mode-board mode-panel">
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
                isMatched                    ? 'matched'       : '',
                state === 'wrong'            ? 'wrong-pair'    : '',
                selected?.id === card.id     ? 'selected'      : '',
                isPaired && !isMatched       ? 'paired-pending': '',
                celebrating.has(card.pairId) ? 'celebrating'   : '',
              ].filter(Boolean).join(' ')}
              onClick={() => !isMatched && handleCardClick(card)}
              onKeyDown={e => {
                if (isMatched) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(card); }
              }}
            >
              <span className="match-card-watermark" aria-hidden="true">
                {card.side === 'term'
                  ? <Question size={34} weight="duotone" />
                  : <Lightbulb size={34} weight="duotone" />}
              </span>
              <span className="match-card-text">
                {isMatched && <CheckCircle size={15} weight="fill" className="match-card-check" />}
                {card.text}
              </span>
              {isPaired && !isMatched && (
                <button
                  type="button"
                  className="match-remove-btn"
                  aria-label="Un-pair this card"
                  title="Un-pair"
                  onPointerDown={e => e.stopPropagation()}
                  onKeyDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); unpair(card); }}
                >
                  ✕
                </button>
              )}
              {celebrating.has(card.pairId) && <CardBird />}
            </div>
          );
        })}
      </div>

      </div>

        <div className="mode-footer">
          <div className="mode-footer-round">{roundIndicator}</div>
          <button
            type="submit"
            className="submit-btn"
            onClick={handleSubmit}
            disabled={!allPaired}
            title={allPaired ? undefined : `Pair all ${termCards.length} items first`}
          >
            <CheckCircle size={18} weight="fill" /> Submit Answers
          </button>
        </div>
      </div>
    </form>
  );
}
