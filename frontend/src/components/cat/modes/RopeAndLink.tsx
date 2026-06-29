import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { GameItem, AnswerRecord } from '../../../types/catGame.types';

type Props = {
  items: GameItem[];
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[]) => void;
};

type Connection = {
  leftIndex: number;   // index in items (term side)
  rightIndex: number;  // index in shuffledRight
};

export default function RopeAndLink({ items, onCorrect, onWrong, onComplete }: Props) {
  // Shuffle the right (definition) column once on mount
  const shuffledRight = useMemo(
    () => [...items].sort(() => Math.random() - 0.5),
    [items]
  );

  const [connections, setConnections] = useState<Connection[]>([]);
  const [draggingFrom, setDraggingFrom] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [shakeAnswer, setShakeAnswer] = useState<number | null>(null);
  const [shakeQuestion, setShakeQuestion] = useState<number | null>(null);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const questionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const answerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    setSvgSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  const getCenter = useCallback((el: HTMLButtonElement | null) => {
    if (!el || !containerRef.current) return null;
    const cr = containerRef.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
  }, []);

  function isLeftConnected(idx: number) {
    return connections.some(c => c.leftIndex === idx);
  }

  function isRightConnected(idx: number) {
    return connections.some(c => c.rightIndex === idx);
  }

  function handleQuestionPointerDown(e: React.PointerEvent, idx: number) {
    if (isLeftConnected(idx)) return;
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

    if (droppedOnIdx !== null) {
      // Correct if the right-column item at droppedOnIdx is the same item as items[draggingFrom]
      const isCorrect = shuffledRight[droppedOnIdx].id === items[draggingFrom].id;

      if (isCorrect) {
        const newConn: Connection = { leftIndex: draggingFrom, rightIndex: droppedOnIdx };
        const newConnections = [...connections, newConn];
        setConnections(newConnections);
        const newAnswer: AnswerRecord = { questionId: items[draggingFrom].id, correct: true };
        const updatedAnswers = [...answers, newAnswer];
        setAnswers(updatedAnswers);
        onCorrect();
        if (newConnections.length >= items.length) {
          setTimeout(() => onComplete(updatedAnswers), 800);
        }
      } else {
        setShakeAnswer(droppedOnIdx);
        setShakeQuestion(draggingFrom);
        onWrong();
        setAnswers(prev => [...prev, { questionId: items[draggingFrom].id, correct: false }]);
        setTimeout(() => { setShakeAnswer(null); setShakeQuestion(null); }, 600);
      }
    }

    setDraggingFrom(null);
    setDragPos(null);
  }

  const lockedLines = connections.map(conn => {
    const from = getCenter(questionRefs.current[conn.leftIndex]);
    const to = getCenter(answerRefs.current[conn.rightIndex]);
    if (!from || !to) return null;
    return { from, to, key: `${conn.leftIndex}-${conn.rightIndex}` };
  });

  const dragLine = draggingFrom !== null ? getCenter(questionRefs.current[draggingFrom]) : null;
  const ROPE_COLORS = ['#f4a261', '#5cb85c', '#5b9bd5', '#d9534f', '#9b59b6', '#1abc9c'];

  return (
    <div className="mode-panel rope-panel">
      <div className="question-progress">
        Connected: {connections.length} / {items.length}
      </div>

      <div
        ref={containerRef}
        className="rope-arena"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
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
                stroke={ROPE_COLORS[i % ROPE_COLORS.length]}
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
                opacity="0.85"
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

        {/* Terms column (left) */}
        <div className="rope-col rope-col-left">
          {items.map((item, idx) => (
            <button
              key={item.id}
              ref={el => { questionRefs.current[idx] = el; }}
              className={[
                'rope-node rope-node-question',
                isLeftConnected(idx) ? 'rope-node-locked' : '',
                draggingFrom === idx ? 'rope-node-dragging' : '',
                shakeQuestion === idx ? 'rope-shake' : '',
              ].join(' ')}
              onPointerDown={e => handleQuestionPointerDown(e, idx)}
              disabled={isLeftConnected(idx)}
            >
              {item.term}
            </button>
          ))}
        </div>

        {/* Definitions column (right, shuffled) */}
        <div className="rope-col rope-col-right">
          {shuffledRight.map((item, idx) => (
            <button
              key={item.id}
              ref={el => { answerRefs.current[idx] = el; }}
              className={[
                'rope-node rope-node-answer',
                isRightConnected(idx) ? 'rope-node-locked' : '',
                shakeAnswer === idx ? 'rope-shake' : '',
              ].join(' ')}
              disabled={isRightConnected(idx)}
            >
              {item.definition}
            </button>
          ))}
        </div>
      </div>

      <div className="rope-hint">
        {draggingFrom !== null ? '🪢 Drop on the matching definition!' : '👆 Drag from a term to its definition'}
      </div>
    </div>
  );
}
