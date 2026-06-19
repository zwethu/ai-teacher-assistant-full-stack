import { useState } from 'react';
import type { MCQQuestion, AnswerRecord } from '../../../types/catGame.types';

type Props = {
  questions: MCQQuestion[];
  onCorrect: () => void;
  onWrong: () => void;
  onComplete: (answers: AnswerRecord[]) => void;
};

export default function PetAndChoose({ questions, onCorrect, onWrong, onComplete }: Props) {
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
