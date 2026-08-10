import { useState, useRef, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, Confetti } from '@phosphor-icons/react';
import type { GameItem, AnswerRecord, BehaviorSignals } from '../../../types/catGame.types';
import CardBird from '../CardBird';
import { useRoundSignals } from '../useRoundSignals';
import { playSnap, playUnsnap } from '../juice';

type Props = {
  items: GameItem[];
  timeUp: boolean;
  /** False only for a demo skip: score just the buckets the player filled,
   *  instead of counting every empty bucket as wrong. */
  countUnplaced?: boolean;
  sidebar?: ReactNode;
  /** "Round X of Y" node, shown in the footer's top row (left of Submit). */
  roundIndicator?: ReactNode;
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

export default function BucketFill({ items, timeUp, countUnplaced = true, sidebar, roundIndicator, onCorrect, onWrong, onComplete }: Props) {
  // Buckets keep their natural order (labelled by term); chips are shuffled.
  const shuffledChips = useMemo(() => [...items].sort(() => Math.random() - 0.5), [items]);

  const [placements, setPlacements] = useState<Placement[]>([]);
  const [dragChip, setDragChip] = useState<string | null>(null);
  const [dragPos, setDragPos]   = useState<{ x: number; y: number } | null>(null);
  const [celebrating, setCelebrating] = useState<Set<string>>(new Set()); // bucket item ids just turned correct

  const containerRef = useRef<HTMLDivElement>(null);
  const bucketRefs   = useRef<(HTMLDivElement | null)[]>([]);

  // ─── Behavior tracking (shared with the other modes) ────────────────────
  const finishedRef = useRef(false);
  const { resetRound, recordFirstAction, recordSubmit, buildSignals } = useRoundSignals();

  useEffect(() => {
    setPlacements([]);
    setDragChip(null);
    setDragPos(null);
    resetRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

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

  // Take a chip back out to the tray. The cue only fires if it was actually
  // still removable (a locked-correct chip stays put and stays silent).
  function removeChip(chipId: string) {
    recordFirstAction();
    if (placements.some(p => p.chipId === chipId && p.state !== 'correct')) playUnsnap();
    setPlacements(prev => prev.filter(p => !(p.chipId === chipId && p.state !== 'correct')));
  }

  const allFilled = placements.filter(p => p.state !== 'wrong').length >= items.length;

  function handleSubmit() {
    if (!allFilled) return;
    recordFirstAction();

    let wrongCount = 0;
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
      if (!isCorrect) wrongCount++;
    });

    // The flock flies only when the WHOLE round comes back clean — birds on
    // each newly-correct item made a half-right board feel like a win.
    if (wrongCount === 0) {
      setCelebrating(new Set(items.map(i => i.id)));
      setTimeout(() => setCelebrating(new Set()), 2000);
    }
    recordSubmit(wrongCount);

    if (wrongCount > 0) {
      onWrong();
      // Wrong chips bounce back to the tray; correct ones stay locked.
      setPlacements(updated.filter(p => p.state === 'correct'));
    } else {
      onCorrect();
      setPlacements(updated);
    }

    if (wrongCount === 0) {
      finishedRef.current = true;
      const signals = buildSignals();
      // Long enough for the flock + fanfare to land before the page turns —
      // at the old 800ms the celebration was cut off mid-flight.
      setTimeout(() => onComplete(answers, signals), 1800);
    }
  }

  // Timeout: only placements a submit has confirmed count as correct. A chip
  // that was never submitted was never validated — grading the raw board here
  // let a player fill every bucket, skip Submit, and run out the clock for
  // full credit with no wrong-submit on record.
  useEffect(() => {
    if (!timeUp || finishedRef.current) return;
    finishedRef.current = true;
    const finalAnswers: AnswerRecord[] = items
      .map((item, bi) => {
        const p = placements.find(pl => pl.bucketIndex === bi);
        const correct = p?.state === 'correct';
        const touched = !!p;
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
          <div className="mode-footer-round">{roundIndicator}</div>
          <button
            type="submit"
            className="submit-btn"
            onClick={handleSubmit}
            disabled={!allFilled}
            title={allFilled ? undefined : `Fill all ${items.length} buckets first`}
          >
            <CheckCircle size={18} weight="fill" /> Submit Answers
          </button>
        </div>
      </div>
    </form>
  );
}
