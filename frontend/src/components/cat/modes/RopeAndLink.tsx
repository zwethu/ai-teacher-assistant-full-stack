import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import type { GameItem, AnswerRecord, BehaviorSignals, AvatarType } from '../../../types/catGame.types';
import CardBird from '../CardBird';
import { useRoundSignals } from '../useRoundSignals';
import { playSnap, playUnsnap } from '../juice';

type Props = {
  items: GameItem[];
  timeUp: boolean;
  /** False only for a demo skip: score just the terms the player linked,
   *  instead of counting every untouched term as wrong. */
  countUnplaced?: boolean;
  sidebar?: ReactNode;
  /** "Round X of Y" node, shown in the footer's top row (left of Submit). */
  roundIndicator?: ReactNode;
  /** Chosen pet — drives the rope colour (pink for cat, blue for dog). */
  avatar?: AvatarType;
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[], signals: BehaviorSignals) => void;
};

type Connection = {
  leftIndex: number;
  rightIndex: number;
  state: 'pending' | 'correct' | 'wrong';
};

export default function RopeAndLink({ items, timeUp, countUnplaced = true, sidebar, roundIndicator, avatar = 'cat', onCorrect, onWrong, onComplete }: Props) {
  const shuffledRight = useMemo(
    () => [...items].sort(() => Math.random() - 0.5),
    [items]
  );

  const [connections, setConnections] = useState<Connection[]>([]);
  const [draggingFrom, setDraggingFrom] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [celebrating, setCelebrating] = useState<Set<string>>(new Set()); // item ids that just turned correct

  const containerRef = useRef<HTMLDivElement>(null);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const answerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  // ─── Behavior tracking ──────────────────────────────────────────────────
  const finishedRef = useRef(false);
  // Mirrors finishedRef for the button's disabled state — a ref alone wouldn't
  // re-render, and the button has to visibly close during the celebration.
  const [cleared, setCleared] = useState(false);
  const { resetRound, recordFirstAction, recordSubmit, buildSignals } = useRoundSignals();

  useEffect(() => {
    resetRound();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    setSvgSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCenter = useCallback((el: HTMLDivElement | null) => {
    if (!el || !containerRef.current) return null;
    const cr = containerRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
  }, []);

  function isRightConnected(idx: number) {
    return connections.some(c => c.rightIndex === idx && c.state !== 'wrong');
  }

  // Remove a not-yet-correct link so the student can redo it. The cue only
  // fires if a link was actually there to remove.
  function disconnectLeft(idx: number) {
    recordFirstAction();
    if (connections.some(c => c.leftIndex === idx && c.state !== 'correct')) playUnsnap();
    setConnections(prev => prev.filter(c => !(c.leftIndex === idx && c.state !== 'correct')));
  }
  function disconnectRight(idx: number) {
    recordFirstAction();
    if (connections.some(c => c.rightIndex === idx && c.state !== 'correct')) playUnsnap();
    setConnections(prev => prev.filter(c => !(c.rightIndex === idx && c.state !== 'correct')));
  }

  function handleQuestionPointerDown(e: React.PointerEvent, idx: number) {
    const conn = connections.find(c => c.leftIndex === idx);
    if (conn?.state === 'correct') return;   // locked once correct
    if (conn) { disconnectLeft(idx); return; } // pending → tap to undo
    recordFirstAction();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingFrom(idx);
    const cr = containerRef.current!.getBoundingClientRect();
    setDragPos({ x: e.clientX - cr.left, y: e.clientY - cr.top });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (draggingFrom === null) return;
    const cr = containerRef.current!.getBoundingClientRect();
    setDragPos({ x: e.clientX - cr.left, y: e.clientY - cr.top });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (draggingFrom === null) return;
    const px = e.clientX;
    const py = e.clientY;

    let droppedOnIdx: number | null = null;
    answerRefs.current.forEach((ref, idx) => {
      if (!ref) return;
      const r = ref.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) {
        droppedOnIdx = idx;
      }
    });

    if (droppedOnIdx !== null && !isRightConnected(droppedOnIdx)) {
      setConnections(prev => [
        ...prev.filter(c => c.leftIndex !== draggingFrom),
        { leftIndex: draggingFrom, rightIndex: droppedOnIdx!, state: 'pending' },
      ]);
      playSnap();
    }

    setDraggingFrom(null);
    setDragPos(null);
  }

  const allConnected = connections.filter(c => c.state !== 'wrong').length >= items.length
    && new Set(connections.filter(c => c.state !== 'wrong').map(c => c.leftIndex)).size === items.length;

  // `finishedRef` is the real lock, not the disabled attribute: the round stays
  // fully connected after a clean submit, so the button would otherwise remain
  // live through the 1.8s celebration. Spamming it there re-graded the same
  // board — inflating the submit counters the assessment reads and queueing one
  // page turn per press, which skipped whole rounds.
  function handleSubmit() {
    if (!allConnected || finishedRef.current) return;
    recordFirstAction();

    let wrongCount = 0;
    const answers: AnswerRecord[] = [];
    const updatedConns: Connection[] = [];

    connections.forEach(conn => {
      if (conn.state === 'correct') {
        updatedConns.push(conn);
        answers.push({ questionId: items[conn.leftIndex].id, correct: true });
        return;
      }
      const isCorrect = shuffledRight[conn.rightIndex].id === items[conn.leftIndex].id;
      const newState: Connection['state'] = isCorrect ? 'correct' : 'wrong';
      updatedConns.push({ ...conn, state: newState });
      answers.push({ questionId: items[conn.leftIndex].id, correct: isCorrect });
      if (!isCorrect) wrongCount++;
    });

    // The flock flies only when the WHOLE round comes back clean — birds on
    // each newly-correct link made a half-right board feel like a win.
    if (wrongCount === 0) {
      setCelebrating(new Set(items.map(i => i.id)));
      setTimeout(() => setCelebrating(new Set()), 2000);
    }
    recordSubmit(wrongCount);
    if (wrongCount > 0) {
      onWrong();
      setConnections(updatedConns.filter(c => c.state === 'correct'));
    } else {
      onCorrect();
      setConnections(updatedConns);
    }

    if (wrongCount === 0) {
      finishedRef.current = true;
      setCleared(true);
      const signals = buildSignals();
      // Long enough for the flock + fanfare to land before the page turns —
      // at the old 800ms the celebration was cut off mid-flight.
      setTimeout(() => onComplete(answers, signals), 1800);
    }
  }

  // Timeout: only links a submit has confirmed count as correct. A link that
  // was never submitted was never validated — grading the raw board here let a
  // player link everything, skip Submit, and run out the clock for full credit
  // with no wrong-submit on record.
  useEffect(() => {
    if (!timeUp || finishedRef.current) return;
    finishedRef.current = true;
    const finalAnswers: AnswerRecord[] = items
      .map((item, i) => {
        const conn = connections.find(c => c.leftIndex === i);
        const correct = conn?.state === 'correct';
        const touched = !!conn;
        return { questionId: item.id, correct, touched };
      })
      .filter(a => countUnplaced || a.touched)
      .map(({ questionId, correct }) => ({ questionId, correct }));
    onComplete(finalAnswers, buildSignals());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  // The rope follows the species brand — pink for cat, blue for dog (mirrors
  // `--g-rose-500` in index.css / `.theme-dog`). Pending and wrong share the
  // SAME colour so the rope never hints WHICH link is wrong (only motion does);
  // CONFIRMED-correct turns mint post-submit. SVG stroke can't read CSS vars,
  // so keep these hexes in sync with the tokens by hand.
  const ropeAccent = avatar === 'dog' ? '#4a9bec' : '#f4739e';
  const ROPE_COLORS: Record<Connection['state'], string> = {
    pending: ropeAccent,
    correct: '#4fc992',  // --g-mint-500
    wrong:   ropeAccent,
  };

  const lockedLines = connections.map(conn => {
    const from = getCenter(questionRefs.current[conn.leftIndex]);
    const to = getCenter(answerRefs.current[conn.rightIndex]);
    if (!from || !to) return null;
    return { from, to, key: `${conn.leftIndex}-${conn.rightIndex}`, color: ROPE_COLORS[conn.state] };
  });

  const dragLine = draggingFrom !== null ? getCenter(questionRefs.current[draggingFrom]) : null;

  // Only render SVG when there are actual lines to draw
  const hasSvgContent = lockedLines.some(l => l !== null) || (dragLine !== null && dragPos !== null);

  return (
    <form className="mode-layout" autoComplete="off" onSubmit={e => e.preventDefault()}>
      <div className="mode-side">
        {sidebar}
      </div>

      <div className="mode-main">
      <div className="mode-board mode-panel rope-panel">
        <div
          ref={containerRef}
          className="rope-arena"
          translate="no"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
        {/* Only mount SVG when there are lines to draw — prevents grey blob */}
        {hasSvgContent && (
          <svg
            ref={svgRef}
            className="rope-svg"
            width={svgSize.w}
            height={svgSize.h}
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
          >
            {lockedLines.map((line) =>
              line ? (
                <path
                  key={line.key}
                  d={`M ${line.from.x} ${line.from.y} C ${line.from.x + 60} ${line.from.y}, ${line.to.x - 60} ${line.to.y}, ${line.to.x} ${line.to.y}`}
                  stroke={line.color}
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              ) : null
            )}
            {dragLine && dragPos && (
              <path
                d={`M ${dragLine.x} ${dragLine.y} C ${dragLine.x + 60} ${dragLine.y}, ${dragPos.x - 60} ${dragPos.y}, ${dragPos.x} ${dragPos.y}`}
                stroke={ropeAccent}
                strokeWidth="2.5"
                fill="none"
                strokeDasharray="6 4"
                strokeLinecap="round"
                opacity="0.7"
              />
            )}
          </svg>
        )}

        {/* Terms column (left) */}
        <div className="rope-col rope-col-left">
          {items.map((item, idx) => {
            const conn = connections.find(c => c.leftIndex === idx);
            const isDisabled = conn?.state === 'correct';
            return (
              <div
                key={item.id}
                ref={el => { questionRefs.current[idx] = el; }}
                // Explicit row: term idx and definition idx share row idx+1, so
                // the two columns can't drift out of step (see .rope-arena).
                style={{ gridRow: idx + 1 }}
                role="button"
                tabIndex={isDisabled ? -1 : 0}
                aria-disabled={isDisabled}
                className={[
                  'rope-node rope-node-question',
                  conn?.state === 'correct'  ? 'rope-node-locked'   : '',
                  conn?.state === 'pending'  ? 'rope-node-pending'  : '',
                  conn?.state === 'wrong'    ? 'rope-node-wrong'    : '',
                  draggingFrom === idx       ? 'rope-node-dragging' : '',
                  celebrating.has(item.id)   ? 'celebrating'        : '',
                ].join(' ')}
                onPointerDown={e => !isDisabled && handleQuestionPointerDown(e, idx)}
              >
                {item.term}
                {celebrating.has(item.id) && <CardBird />}
              </div>
            );
          })}
        </div>

        {/* Definitions column (right, shuffled) */}
        <div className="rope-col rope-col-right">
          {shuffledRight.map((item, idx) => {
            const conn = connections.find(c => c.rightIndex === idx);
            const isDisabled = conn?.state === 'correct';
            const isPending = conn?.state === 'pending';
            return (
              <div
                key={item.id}
                ref={el => { answerRefs.current[idx] = el; }}
                style={{ gridRow: idx + 1 }}
                role="button"
                tabIndex={isDisabled ? -1 : 0}
                aria-disabled={isDisabled}
                onClick={() => !isDisabled && disconnectRight(idx)}
                className={[
                  'rope-node rope-node-answer',
                  conn?.state === 'correct' ? 'rope-node-locked'  : '',
                  conn?.state === 'pending' ? 'rope-node-pending' : '',
                  conn?.state === 'wrong'   ? 'rope-node-wrong'   : '',
                  celebrating.has(item.id)  ? 'celebrating'       : '',
                ].join(' ')}
              >
                {item.definition}
                {isPending && (
                  <button
                    type="button"
                    className="rope-disconnect-btn"
                    aria-label="Disconnect this rope"
                    title="Disconnect"
                    onClick={e => { e.stopPropagation(); disconnectRight(idx); }}
                  >
                    ✕
                  </button>
                )}
                {celebrating.has(item.id) && <CardBird />}
              </div>
            );
          })}
        </div>
      </div>

      </div>

        <div className="mode-footer">
          <div className="mode-footer-round">{roundIndicator}</div>
          <button
            type="submit"
            className="submit-btn"
            onClick={handleSubmit}
            disabled={!allConnected || cleared}
            title={
              cleared ? 'Round cleared — hang on'
              : allConnected ? undefined
              : `Connect all ${items.length} pairs first`
            }
          >
            <CheckCircle size={18} weight="fill" /> Submit Answers
          </button>
        </div>
      </div>
    </form>
  );
}
