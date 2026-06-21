import { useState } from 'react';
import type { AnswerRecord, GameMode } from '../../types/catGame.types';
import type { MCQQuestion, MatchingQuestion, RopeLinkQuestion, Question } from '../../types/catGame.types';
import { MOCK_MCQ, MOCK_MATCHING, MOCK_ROPELINK } from './mockData';
import HUD from './HUD';
import CatSprite from './CatSprite';
import PetAndChoose from './modes/PetAndChoose';
import MatchAndTreat from './modes/MatchAndTreat';
import RopeAndLink from './modes/RopeAndLink';
import ResultScreen from './ResultScreen';
import { saveAttempt } from '../../lib/gameSession';
import './CatGame.css';

type Props = {
  gameMode?: GameMode;
  questions?: Question[];
  nickname?: string;
  playerUid?: string;
  assessmentId?: string;
};

export default function CatGame({
  gameMode = 'mcq',
  questions,
  nickname = 'Player',
  playerUid,
  assessmentId,
}: Props) {
  const mcqQuestions = questions
    ? (questions.filter(q => q.type === 'mcq') as MCQQuestion[])
    : MOCK_MCQ;
  const matchingQuestions = questions
    ? (questions.filter(q => q.type === 'matching') as MatchingQuestion[])
    : MOCK_MATCHING;
  const ropeLinkQuestions = questions
    ? (questions.filter(q => q.type === 'ropelink') as RopeLinkQuestion[])
    : MOCK_ROPELINK;

  const totalQuestions =
    gameMode === 'mcq'
      ? mcqQuestions.length
      : gameMode === 'matching'
      ? matchingQuestions.reduce((acc, q) => acc + q.pairs.length, 0)
      : ropeLinkQuestions.reduce((acc, q) => acc + q.pairs.length, 0);

  const [gameOver, setGameOver] = useState(false);
  const [happiness, setHappiness] = useState(60);
  const [fish, setFish] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [catMood, setCatMood] = useState<'idle' | 'happy' | 'confused' | 'playful' | 'eating'>('idle');
  const [resultSaved, setResultSaved] = useState(false);

  const answered = answers.length;

  function triggerMood(mood: 'happy' | 'confused' | 'playful', duration = 1400) {
    setCatMood(mood);
    setTimeout(() => setCatMood('idle'), duration);
  }

  function handleCorrect() {
    triggerMood('happy');
    setHappiness(h => Math.min(100, h + 10));
    setFish(f => f + 5);
  }

  function handleWrong() {
    triggerMood('confused');
    setHappiness(h => Math.max(0, h - 5));
  }

  function handleMatchPlay() {
    triggerMood('playful');
    setFish(f => f + 5);
    setHappiness(h => Math.min(100, h + 8));
  }

  async function handleComplete(newAnswers: AnswerRecord[]) {
    const allAnswers = [...answers, ...newAnswers];
    setAnswers(allAnswers);
    setGameOver(true);

    if (playerUid && assessmentId && !resultSaved) {
      const correct = allAnswers.filter(a => a.correct).length;
      const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
      try {
        await saveAttempt({
          playerUid,
          assessmentId,
          score: fish,
          accuracy,
          fish,
          happiness,
          completedAt: new Date(),
        });
        setResultSaved(true);
      } catch (e) {
        console.error('Failed to save attempt:', e);
      }
    }
  }

  function handleRestart() {
    setGameOver(false);
    setHappiness(60);
    setFish(0);
    setAnswers([]);
    setCatMood('idle');
  }

  if (gameOver) {
    return (
      <ResultScreen
        answers={answers}
        totalQuestions={totalQuestions}
        happiness={happiness}
        fish={fish}
        nickname={nickname}
        onRestart={!assessmentId ? handleRestart : undefined}
      />
    );
  }

  const modePill =
    gameMode === 'mcq'
      ? '🐾 Answer questions to earn 🐟 fish!'
      : gameMode === 'matching'
      ? '🧩 Match the pairs for more 🐟 fish!'
      : '🪢 Connect each question to its answer!';

  return (
    <div className="cat-game-container">
      <div className="room-deco window">🪟</div>
      <div className="room-deco plant">🪴</div>
      <div className="room-deco shelf">🕯️ 📚</div>
      <div className="room-deco rug">🟫</div>

      <HUD
        happiness={happiness}
        answered={answered}
        totalQuestions={totalQuestions}
        fish={fish}
      />

      <div className="cat-center-area">
        <CatSprite mood={catMood} />
        <div className="mode-pill">{modePill}</div>
      </div>

      <div className="interaction-area">
        {gameMode === 'mcq' && (
          <PetAndChoose
            questions={mcqQuestions}
            onCorrect={handleCorrect}
            onWrong={handleWrong}
            onComplete={handleComplete}
          />
        )}
        {gameMode === 'matching' && (
          <MatchAndTreat
            questions={matchingQuestions}
            onMatch={handleMatchPlay}
            onComplete={handleComplete}
          />
        )}
        {gameMode === 'ropelink' && (
          <RopeAndLink
            questions={ropeLinkQuestions}
            onCorrect={handleCorrect}
            onWrong={handleWrong}
            onComplete={handleComplete}
          />
        )}
      </div>
    </div>
  );
}
