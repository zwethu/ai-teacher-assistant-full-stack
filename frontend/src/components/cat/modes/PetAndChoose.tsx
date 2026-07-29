import { useState, useMemo } from 'react';
import type { GameItem, AnswerRecord } from '../../../types/catGame.types';

type Props = {
  items: GameItem[];
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[]) => void;
};

// Build MCQ questions from GameItem[]
// Each item's term becomes the question, its definition is the correct answer,
// and 3 other definitions are picked randomly as distractors.
function buildQuestions(items: GameItem[]) {
  return items.map((item, i) => {
    const distractors = items
      .filter((_, j) => j !== i)
      .map(d => d.definition)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    const options = [...distractors, item.definition].sort(() => Math.random() - 0.5);
    const correctIndex = options.indexOf(item.definition);
    return { id: item.id, question: item.term, options, correctIndex };
  });
}

export default function PetAndChoose({ items, onCorrect, onWrong, onComplete }: Props) {
  const questions = useMemo(() => buildQuestions(items), [items]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);

  const current = questions[index];

  function handleAnswer(optionIndex: number) {
    if (selected !== null) return;
    const isCorrect = optionIndex === current.correctIndex;
    setSelected(optionIndex);
    setFeedback(isCorrect ? 'correct' : 'wrong');
    isCorrect ? onCorrect() : onWrong();

    const newAnswer: AnswerRecord = { questionId: current.id, correct: isCorrect };
    const updatedAnswers = [...answers, newAnswer];

    setTimeout(() => {
      setSelected(null);
      setFeedback(null);
      if (index + 1 >= questions.length) {
        onComplete(updatedAnswers);
      } else {
        setIndex(i => i + 1);
        setAnswers(updatedAnswers);
      }
    }, 900);
  }

  return (
    <div className="mode-panel">
      <div className="question-progress">
        Question {index + 1} of {questions.length}
      </div>
      <div className="question-text">{current.question}</div>
      <div className="options-grid">
        {current.options.map((opt, i) => {
          let cls = 'option-btn';
          if (selected !== null) {
            if (i === current.correctIndex) cls += ' correct';
            else if (i === selected) cls += ' wrong';
          }
          return (
            <button key={i} className={cls} onClick={() => handleAnswer(i)} disabled={selected !== null}>
              <span className="option-letter">{String.fromCharCode(65 + i)}</span>
              {opt}
            </button>
          );
        })}
      </div>
      {feedback && (
        <div className={`feedback-banner ${feedback}`}>
          {feedback === 'correct' ? '🐟 +5 fish! Great answer!' : '😿 Try again next time!'}
        </div>
      )}
    </div>
  );
}
