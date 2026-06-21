import { useState, useRef, useEffect, useCallback } from 'react';
import type { RopeLinkQuestion, AnswerRecord } from '../../../types/catGame.types';

type Props = {
  questions: RopeLinkQuestion[];
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[]) => void;
};

type Connection = {
  questionIndex: number;
  answerIndex: number;
};

export default function RopeAndLink({ questions, onCorrect, onWrong, onComplete }: Props) {
  const [roundIndex, setRoundIndex] = useState(0);
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

  const round = questions[roundIndex];
  const pairs = round.pairs;
  // Shuffle answers display order once per round
  const [shuffledAnswerOrder] = useState<number[]>(() =>
    [...Array(pairs.length).keys()].sort(() => Math.random() - 0.5)
  );

  // Resize observer to keep SVG dimensions synced
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSvgSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    ro.observe(el);
    setSvgSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, []);

  const getCenter = useCallback((el: HTMLButtonElement | null): { x: number; y: number } | null => {
    if (!el || !containerRef.current) return null;
    const containerRect = containerRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - containerRect.left,
      y: rect.top + rect.height / 2 - containerRect.top,
    };
  }, []);

  function isConnected(qIdx: number) {
    return connections.some(c => c.questionIndex === qIdx);
  }

  function getConnectionForAnswer(aIdx: number) {
    return connections.find(c => c.answerIndex === shuffledAnswerOrder[aIdx]);
  }

  function handleQuestionPointerDown(e: React.PointerEvent, qIdx: number) {
    if (isConnected(qIdx)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingFrom(qIdx);
    const containerRect = containerRef.current!.getBoundingClientRect();
    setDragPos({ x: e.clientX - containerRect.left, y: e.clientY - containerRect.top });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (draggingFrom === null) return;
    const containerRect = containerRef.current!.getBoundingClientRect();
    setDragPos({ x: e.clientX - containerRect.left, y: e.clientY - containerRect.top });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (draggingFrom === null) return;

    // Check if released over an answer button
    const containerRect = containerRef.current!.getBoundingClientRect();
    const px = e.clientX;
    const py = e.clientY;

    let droppedOnAnswerDisplayIdx: number | null = null;
    answerRefs.current.forEach((ref, displayIdx) => {
      if (!ref) return;
      const rect = ref.getBoundingClientRect();
      if (px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom) {
        droppedOnAnswerDisplayIdx = displayIdx;
      }
    });

    if (droppedOnAnswerDisplayIdx !== null) {
      const realAnswerIdx = shuffledAnswerOrder[droppedOnAnswerDisplayIdx];
      const isCorrect = realAnswerIdx === draggingFrom;

      if (isCorrect) {
        const newConn: Connection = { questionIndex: draggingFrom, answerIndex: realAnswerIdx };
        const newConnections = [...connections, newConn];
        setConnections(newConnections);
        const newAnswer: AnswerRecord = { questionId: `${round.id}-pair-${draggingFrom}`, correct: true };
        const updatedAnswers = [...answers, newAnswer];
        setAnswers(updatedAnswers);
        onCorrect();

        if (newConnections.length >= pairs.length) {
          // Round complete
          setTimeout(() => {
            if (roundIndex + 1 >= questions.length) {
              onComplete(updatedAnswers);
            } else {
              setRoundIndex(r => r + 1);
              setConnections([]);
              setAnswers(updatedAnswers);
            }
          }, 800);
        }
      } else {
        // Wrong — shake both nodes
        setShakeAnswer(droppedOnAnswerDisplayIdx);
        setShakeQuestion(draggingFrom);
        onWrong();
        const newAnswer: AnswerRecord = { questionId: `${round.id}-pair-${draggingFrom}`, correct: false };
        setAnswers(prev => [...prev, newAnswer]);
        setTimeout(() => {
          setShakeAnswer(null);
          setShakeQuestion(null);
        }, 600);
      }
    }

    setDraggingFrom(null);
    setDragPos(null);
  }

  // Build SVG lines for locked connections
  const lockedLines = connections.map(conn => {
    const qEl = questionRefs.current[conn.questionIndex];
    const displayIdx = shuffledAnswerOrder.indexOf(conn.answerIndex);
    const aEl = answerRefs.current[displayIdx];
    const from = getCenter(qEl);
    const to = getCenter(aEl);
    if (!from || !to) return null;
    return { from, to, key: `${conn.questionIndex}-${conn.answerIndex}` };
  });

  // Live drag line
  const dragLine = draggingFrom !== null && dragPos
    ? getCenter(questionRefs.current[draggingFrom])
    : null;

  const ROPE_COLORS = ['#f4a261', '#5cb85c', '#5b9bd5', '#d9534f'];

  return (
    <div className="mode-panel rope-panel">
      <div className="question-progress">
        Round {roundIndex + 1} of {questions.length} &nbsp;·&nbsp; Connected: {connections.length} / {pairs.length}
      </div>

      <div
        ref={containerRef}
        className="rope-arena"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* SVG overlay for ropes */}
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

        {/* Questions column (left) */}
        <div className="rope-col rope-col-left">
          {pairs.map((pair, qIdx) => (
            <button
              key={qIdx}
              ref={el => { questionRefs.current[qIdx] = el; }}
              className={[
                'rope-node rope-node-question',
                isConnected(qIdx) ? 'rope-node-locked' : '',
                draggingFrom === qIdx ? 'rope-node-dragging' : '',
                shakeQuestion === qIdx ? 'rope-shake' : '',
              ].join(' ')}
              onPointerDown={e => handleQuestionPointerDown(e, qIdx)}
              disabled={isConnected(qIdx)}
            >
              {pair.question}
            </button>
          ))}
        </div>

        {/* Answers column (right) */}
        <div className="rope-col rope-col-right">
          {shuffledAnswerOrder.map((realIdx, displayIdx) => {
            const conn = getConnectionForAnswer(displayIdx);
            return (
              <button
                key={displayIdx}
                ref={el => { answerRefs.current[displayIdx] = el; }}
                className={[
                  'rope-node rope-node-answer',
                  conn ? 'rope-node-locked' : '',
                  shakeAnswer === displayIdx ? 'rope-shake' : '',
                ].join(' ')}
                disabled={!!conn}
              >
                {pairs[realIdx].answer}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rope-hint">
        {draggingFrom !== null ? '🪢 Drop on the matching answer!' : '👆 Drag from a question to its answer'}
      </div>
    </div>
  );
}
