import { useState, useRef, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, Basket, HandPointing, Confetti } from '@phosphor-icons/react';
import type { GameItem, AnswerRecord, BehaviorSignals } from '../../../types/catGame.types';
import CardBird from '../CardBird';
import { playSnap } from '../juice';

type Props = {
  items: GameItem[];
  timeUp: boolean;
  /** False only for a demo skip: score just the buckets the player filled,
   *  instead of counting every empty bucket as wrong. */
  countUnplaced?: boolean;
  sidebar?: ReactNode;
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[], signals: BehaviorSignals) => void;
};

// A chip (an item's definition = the "answer") dropped into a bucket
// (an item's term = the "question"). Correct when the chip's item id
// matches the bucket's item id.
type Placement = {
  bucketIndex: number;
  chipId: string;
  state: 'pending' | 'correct' | 'wrong';
};

export default function BucketFill({ items, timeUp, countUnplaced = true, sidebar, onCorrect, onWrong, onComplete }: Props) {
  // Buckets keep their natural order (labelled by term); chips are shuffled.
  const shuffledChips = useMemo(() => [...items].sort(() => Math.random() - 0.5), [items]);

  const [placements, setPlacements] = useState<Placement[]>([]);
  const [dragChip, setDragChip] = useState<string | null>(null);
  const [dragPos, setDragPos]   = useState<{ x: number; y: number } | null>(null);
  const [celebrating, setCelebrating] = useState<Set<string>>(new Set()); // bucket item ids just turned correct

  const containerRef = useRef<HTMLDivElement>(null);
  const bucketRefs   = useRef<(HTMLDivElement | null)[]>([]);

  // ─── Behavior tracking refs (identical signals to the other modes) ──────
  const startTimeRef        = useRef<number>(Date.now());
  const firstActionRef      = useRef<number | null>(null);
  const submitCountRef      = useRef(0);
  const wrongSubmitCountRef = useRef(0);
  const totalWrongRef       = useRef(0);
  const lastFeedbackTimeRef = useRef<number | null>(null);
  const reviewTimesRef      = useRef<number[]>([]);
  const finishedRef         = useRef(false);

  function buildSignals(): BehaviorSignals {
    return {
      firstActionDelayMs:     firstActionRef.current ? firstActionRef.current - startTimeRef.current : 0,
      submitCount:            submitCountRef.current,
      wrongSubmitCount:       wrongSubmitCountRef.current,
      totalWrongLinksOrPairs: totalWrongRef.current,
      reviewTimesMs:          reviewTimesRef.current,
    };
  }

  useEffect(() => {
    setPlacements([]);
    setDragChip(null);
    setDragPos(null);
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

  const chipPlacement   = (chipId: string) => placements.find(p => p.chipId === chipId);
  const bucketPlacement = (bi: number)     => placements.find(p => p.bucketIndex === bi);

  function startDrag(e: React.PointerEvent, chipId: string) {
    if (chipPlacement(chipId)?.state === 'correct') return; // locked
    recordFirstAction();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragChip(chipId);
    const cr = containerRef.current!.getBoundingClientRect();
    setDragPos({ x: e.clientX - cr.left, y: e.clientY - cr.top });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (dragChip === null) return;
    const cr = containerRef.current!.getBoundingClientRect();
    setDragPos({ x: e.clientX - cr.left, y: e.clientY - cr.top });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (dragChip === null) return;
    const px = e.clientX, py = e.clientY;

    let targetBucket: number | null = null;
    bucketRefs.current.forEach((ref, bi) => {
      if (!ref) return;
      const r = ref.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) targetBucket = bi;
    });

    if (targetBucket !== null) {
      const bp = bucketPlacement(targetBucket);
      if (!bp || bp.state !== 'correct') {
        // Drop in: remove this chip's old spot and any pending chip already in the target.
        setPlacements(prev => [
          ...prev.filter(p => p.chipId !== dragChip && !(p.bucketIndex === targetBucket && p.state !== 'correct')),
          { bucketIndex: targetBucket!, chipId: dragChip!, state: 'pending' },
        ]);
        playSnap();
      }
    } else {
      // Dropped outside any bucket → send the chip back to the tray.
      setPlacements(prev => prev.filter(p => !(p.chipId === dragChip && p.state !== 'correct')));
    }

    setDragChip(null);
    setDragPos(null);
  }

  function removeChip(chipId: string) {
    recordFirstAction();
    setPlacements(prev => prev.filter(p => !(p.chipId === chipId && p.state !== 'correct')));
  }

  const allFilled = placements.filter(p => p.state !== 'wrong').length >= items.length;

  function handleSubmit() {
    if (!allFilled) return;
    recordFirstAction();

    submitCountRef.current += 1;
    let wrongCount = 0;
    const newlyCorrectIds: string[] = [];
    const answers: AnswerRecord[] = [];
    const updated: Placement[] = [];

    placements.forEach(p => {
      if (p.state === 'correct') {
        updated.push(p);
        answers.push({ questionId: items[p.bucketIndex].id, correct: true });
        return;
      }
      const isCorrect = items[p.bucketIndex].id === p.chipId;
      updated.push({ ...p, state: isCorrect ? 'correct' : 'wrong' });
      answers.push({ questionId: items[p.bucketIndex].id, correct: isCorrect });
      if (isCorrect) newlyCorrectIds.push(items[p.bucketIndex].id);
      else wrongCount++;
    });

    if (newlyCorrectIds.length > 0) {
      setCelebrating(new Set(newlyCorrectIds));
      setTimeout(() => setCelebrating(new Set()), 2000);
    }
    totalWrongRef.current += wrongCount;

    if (wrongCount > 0) {
      wrongSubmitCountRef.current += 1;
      onWrong();
      // Wrong chips bounce back to the tray; correct ones stay locked.
      setPlacements(updated.filter(p => p.state === 'correct'));
    } else {
      onCorrect();
      setPlacements(updated);
    }

    lastFeedbackTimeRef.current = Date.now();

    if (wrongCount === 0) {
      finishedRef.current = true;
      const signals = buildSignals();
      setTimeout(() => onComplete(answers, signals), 800);
    }
  }

  // Timeout: grade whatever is currently in the buckets as the final attempt.
  useEffect(() => {
    if (!timeUp || finishedRef.current) return;
    finishedRef.current = true;
    const finalAnswers: AnswerRecord[] = items
      .map((item, bi) => {
        const p = placements.find(pl => pl.bucketIndex === bi && pl.state !== 'wrong');
        const correct = !!p && items[bi].id === p.chipId;
        const touched = placements.some(pl => pl.bucketIndex === bi);
        return { questionId: item.id, correct, touched };
      })
      .filter(a => countUnplaced || a.touched)
      .map(({ questionId, correct }) => ({ questionId, correct }));
    onComplete(finalAnswers, buildSignals());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  const chipText  = (chipId: string) => items.find(i => i.id === chipId)?.definition ?? '';
  const placedIds = new Set(placements.map(p => p.chipId));
  const trayChips = shuffledChips.filter(chip => !placedIds.has(chip.id));
  const filledCount = placements.filter(p => p.state !== 'wrong').length;

  return (
    <form className="mode-layout" autoComplete="off" onSubmit={e => e.preventDefault()}>
      <div className="mode-side">
        {sidebar}
      </div>

      <div className="mode-main">
      <div className="mode-board mode-panel bucket-panel">
        <div
          ref={containerRef}
          className="bucket-arena"
          translate="no"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Buckets (labelled by term) */}
          <div className="bucket-grid">
            {items.map((item, bi) => {
              const p = bucketPlacement(bi);
              const locked = p?.state === 'correct';
              return (
                <div
                  key={item.id}
                  ref={el => { bucketRefs.current[bi] = el; }}
                  className={[
                    'bucket',
                    p?.state === 'correct' ? 'bucket-correct' : '',
                    p?.state === 'pending' ? 'bucket-pending' : '',
                    p?.state === 'wrong'   ? 'bucket-wrong'   : '',
                    celebrating.has(item.id) ? 'celebrating'  : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div className="bucket-label">
                    {locked && <CheckCircle size={15} weight="fill" className="bucket-label-check" />}
                    {item.term}
                  </div>
                  <div className="bucket-slot">
                    {p ? (
                      <div
                        className="bucket-chip"
                        onPointerDown={e => !locked && startDrag(e, p.chipId)}
                        style={{ opacity: dragChip === p.chipId ? 0.35 : 1 }}
                      >
                        {chipText(p.chipId)}
                        {!locked && (
                          <button
                            type="button"
                            className="bucket-remove-btn"
                            aria-label="Take item back"
                            title="Take back"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); removeChip(p.chipId); }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="bucket-empty-hint">Drop here</span>
                    )}
                  </div>
                  {celebrating.has(item.id) && <CardBird />}
                </div>
              );
            })}
          </div>

          {/* Tray of remaining items (definitions = answers) */}
          <div className="chip-tray">
            {trayChips.length === 0 ? (
              <span className="chip-tray-empty">
                All items placed — hit Submit! <Confetti size={16} weight="duotone" />
              </span>
            ) : (
              trayChips.map(chip => (
                <div
                  key={chip.id}
                  className="tray-chip"
                  onPointerDown={e => startDrag(e, chip.id)}
                  style={{ opacity: dragChip === chip.id ? 0.35 : 1 }}
                >
                  {chip.definition}
                </div>
              ))
            )}
          </div>

          {/* Floating chip that follows the cursor while dragging */}
          {dragChip !== null && dragPos && (
            <div className="chip-ghost" style={{ left: dragPos.x, top: dragPos.y }}>
              {chipText(dragChip)}
            </div>
          )}
        </div>
      </div>

        <div className="mode-footer">
          <div className="mode-footer-info">
            <div className="question-progress">
              Sorted: {filledCount} / {items.length}
            </div>
            <div className="rope-hint">
              {dragChip !== null
                ? <><Basket size={15} weight="duotone" /> Drop it in the right bucket!</>
                : <><HandPointing size={15} weight="duotone" /> Drag each item into its bucket · tap ✕ to take it back</>}
            </div>
          </div>
          <button
            type="submit"
            className="submit-btn"
            onClick={handleSubmit}
            disabled={!allFilled}
          >
            {allFilled
              ? <><CheckCircle size={18} weight="fill" /> Submit Answers</>
              : `Fill all ${items.length} buckets first`}
          </button>
        </div>
      </div>
    </form>
  );
}
