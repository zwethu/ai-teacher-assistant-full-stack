import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { GameItem, AnswerRecord, BehaviorSummary } from '../../../types/catGame.types';

type Props = {
  items: GameItem[];
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[], behavior: BehaviorSummary) => void;
};

type Connection = {
  leftIndex: number;
  rightIndex: number;
  state: 'pending' | 'correct' | 'wrong';
};

export default function RopeAndLink({ items, onCorrect, onWrong, onComplete }: Props) {
  const shuffledRight = useMemo(
    () => [...items].sort(() => Math.random() - 0.5),
    [items]
  );

  const [connections, setConnections] = useState<Connection[]>([]);
  const [draggingFrom, setDraggingFrom] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [shakeLeft, setShakeLeft] = useState<number | null>(null);
  const [shakeRight, setShakeRight] = useState<number | null>(null);

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

  function isLeftConnected(idx: number) {
    return connections.some(c => c.leftIndex === idx && c.state !== 'wrong');
  }

  function isRightConnected(idx: number) {
    return connections.some(c => c.rightIndex === idx && c.state !== 'wrong');
  }

  function handleQuestionPointerDown(e: React.PointerEvent, idx: number) {
    if (isLeftConnected(idx)) return;
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
      const behavior: BehaviorSummary = {
        firstActionDelayMs: firstActionRef.current
          ? firstActionRef.current - startTimeRef.current
          : 0,
        submitCount: submitCountRef.current,
        wrongSubmitCount: wrongSubmitCountRef.current,
        totalWrongLinksOrPairs: totalWrongLinksRef.current,
        reviewTimesMs: reviewTimesRef.current,
      };
      setTimeout(() => onComplete(answers, behavior), 800);
    }
  }

  const ROPE_COLORS: Record<Connection['state'], string> = {
    pending: '#aaa',
    correct: '#5cb85c',
    wrong:   '#d9534f',
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
    <form className="mode-panel rope-panel" autoComplete="off" onSubmit={e => e.preventDefault()}>
      <div className="question-progress">
        Connected: {connections.filter(c => c.state !== 'wrong').length} / {items.length}
      </div>

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
            {lockedLines.map((line, i) =>
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
                  shakeLeft === idx          ? 'rope-shake'         : '',
                ].join(' ')}
                onPointerDown={e => !isDisabled && handleQuestionPointerDown(e, idx)}
              >
                {item.term}
              </div>
            );
          })}
        </div>

        {/* Definitions column (right, shuffled) */}
        <div className="rope-col rope-col-right">
          {shuffledRight.map((item, idx) => {
            const conn = connections.find(c => c.rightIndex === idx);
            const isDisabled = conn?.state === 'correct';
            return (
              <div
                key={item.id}
                ref={el => { answerRefs.current[idx] = el; }}
                role="button"
                tabIndex={isDisabled ? -1 : 0}
                aria-disabled={isDisabled}
                className={[
                  'rope-node rope-node-answer',
                  conn?.state === 'correct' ? 'rope-node-locked'  : '',
                  conn?.state === 'pending' ? 'rope-node-pending' : '',
                  conn?.state === 'wrong'   ? 'rope-node-wrong'   : '',
                  shakeRight === idx        ? 'rope-shake'        : '',
                ].join(' ')}
              >
                {item.definition}
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        className="submit-btn"
        onClick={handleSubmit}
        disabled={!allConnected}
      >
        {allConnected ? '✅ Submit Answers' : `Connect all ${items.length} pairs first`}
      </button>

      <div className="rope-hint">
        {draggingFrom !== null
          ? '🪢 Drop on the matching definition!'
          : '👆 Drag from a term to its definition'}
      </div>
    </form>
  );
}
