import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, LinkSimple, HandPointing } from '@phosphor-icons/react';
import type { GameItem, AnswerRecord, BehaviorSignals } from '../../../types/catGame.types';
import CardBird from '../CardBird';

type Props = {
  items: GameItem[];
  timeUp: boolean;
  sidebar?: ReactNode;
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[], signals: BehaviorSignals) => void;
};

type Connection = {
  leftIndex: number;
  rightIndex: number;
  state: 'pending' | 'correct' | 'wrong';
};

export default function RopeAndLink({ items, timeUp, sidebar, onCorrect, onWrong, onComplete }: Props) {
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

  // ─── Behavior tracking refs ─────────────────────────────────────────────
  const startTimeRef = useRef<number>(Date.now());
  const firstActionRef = useRef<number | null>(null);
  const submitCountRef = useRef(0);
  const wrongSubmitCountRef = useRef(0);
  const totalWrongLinksRef = useRef(0);
  const lastFeedbackTimeRef = useRef<number | null>(null);
  const reviewTimesRef = useRef<number[]>([]);
  const finishedRef = useRef(false);

  function buildSignals(): BehaviorSignals {
    return {
      firstActionDelayMs: firstActionRef.current ? firstActionRef.current - startTimeRef.current : 0,
      submitCount: submitCountRef.current,
      wrongSubmitCount: wrongSubmitCountRef.current,
      totalWrongLinksOrPairs: totalWrongLinksRef.current,
      reviewTimesMs: reviewTimesRef.current,
    };
  }

  useEffect(() => {
    startTimeRef.current = Date.now();
    firstActionRef.current = null;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    setSvgSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  const getCenter = useCallback((el: HTMLDivElement | null) => {
    if (!el || !containerRef.current) return null;
    const cr = containerRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
  }, []);

  function recordFirstAction() {
    if (firstActionRef.current === null) {
      firstActionRef.current = Date.now();
    }
    if (lastFeedbackTimeRef.current !== null) {
      reviewTimesRef.current.push(Date.now() - lastFeedbackTimeRef.current);
      lastFeedbackTimeRef.current = null;
    }
  }

  function isRightConnected(idx: number) {
    return connections.some(c => c.rightIndex === idx && c.state !== 'wrong');
  }

  // Remove a not-yet-correct link so the student can redo it.
  function disconnectLeft(idx: number) {
    recordFirstAction();
    setConnections(prev => prev.filter(c => !(c.leftIndex === idx && c.state !== 'correct')));
  }
  function disconnectRight(idx: number) {
    recordFirstAction();
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
    }

    setDraggingFrom(null);
    setDragPos(null);
  }

  const allConnected = connections.filter(c => c.state !== 'wrong').length >= items.length
    && new Set(connections.filter(c => c.state !== 'wrong').map(c => c.leftIndex)).size === items.length;

  function handleSubmit() {
    if (!allConnected) return;
    recordFirstAction();

    submitCountRef.current += 1;
    let wrongCount = 0;
    const newlyCorrectIds: string[] = [];
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
      if (isCorrect) newlyCorrectIds.push(items[conn.leftIndex].id);
      else wrongCount++;
    });

    if (newlyCorrectIds.length > 0) {
      setCelebrating(new Set(newlyCorrectIds));
      setTimeout(() => setCelebrating(new Set()), 2000);
    }
    totalWrongLinksRef.current += wrongCount;
    if (wrongCount > 0) {
      wrongSubmitCountRef.current += 1;
      onWrong();
      setConnections(updatedConns.filter(c => c.state === 'correct'));
    } else {
      onCorrect();
      setConnections(updatedConns);
    }

    lastFeedbackTimeRef.current = Date.now();

    if (wrongCount === 0) {
      finishedRef.current = true;
      const signals = buildSignals();
      setTimeout(() => onComplete(answers, signals), 800);
    }
  }

  // Timeout: grade whatever's currently linked as the final attempt.
  useEffect(() => {
    if (!timeUp || finishedRef.current) return;
    finishedRef.current = true;
    const finalAnswers: AnswerRecord[] = items.map((item, i) => {
      const conn = connections.find(c => c.leftIndex === i && c.state !== 'wrong');
      const correct = !!conn && shuffledRight[conn.rightIndex].id === item.id;
      return { questionId: item.id, correct };
    });
    onComplete(finalAnswers, buildSignals());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp]);

  // Pending/wrong stay neutral (no hint during play); CONFIRMED-correct turns
  // vivid green — that's post-submit feedback, not a during-play cue.
  const ROPE_COLORS: Record<Connection['state'], string> = {
    pending: '#b8a58f',
    correct: '#10b981',
    wrong:   '#b8a58f',
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
        <div className="question-progress">
          Connected: {connections.filter(c => c.state !== 'wrong').length} / {items.length}
        </div>
        <button
          type="submit"
          className="submit-btn"
          onClick={handleSubmit}
          disabled={!allConnected}
        >
          {allConnected
            ? <><CheckCircle size={18} weight="fill" /> Submit Answers</>
            : `Connect all ${items.length} pairs first`}
        </button>
        <div className="rope-hint">
          {draggingFrom !== null
            ? <><LinkSimple size={15} weight="duotone" /> Drop on the matching definition!</>
            : <><HandPointing size={15} weight="duotone" /> Drag a term to its match · tap a link to undo</>}
        </div>
      </div>

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
                stroke="#bbb"
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
    </form>
  );
}
