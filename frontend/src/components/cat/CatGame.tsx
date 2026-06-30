import { useState } from 'react';
import type { AnswerRecord, GameMode, GameItem, BehaviorSummary } from '../../types/catGame.types';
import { MOCK_ITEMS } from './mockData';
import CatSprite from './CatSprite';
import MatchAndTreat from './modes/MatchAndTreat';
import RopeAndLink from './modes/RopeAndLink';
import ResultScreen from './ResultScreen';
import { saveAttempt } from '../../lib/gameSession';
import './CatGame.css';

type Props = {
  gameMode: GameMode;
  items?: GameItem[];
  nickname?: string;
  playerUid?: string;
  assessmentId?: string;
};

export default function CatGame({
  gameMode,
  items,
  nickname = 'Player',
  playerUid,
  assessmentId,
}: Props) {
  const activeItems    = items && items.length > 0 ? items : MOCK_ITEMS;
  const totalQuestions = activeItems.length;

  const [gameOver,    setGameOver]    = useState(false);
  const [answers,     setAnswers]     = useState<AnswerRecord[]>([]);
  const [catMood,     setCatMood]     = useState<'idle' | 'happy' | 'confused' | 'playful' | 'eating'>('idle');
  const [resultSaved, setResultSaved] = useState(false);

  function triggerMood(mood: 'happy' | 'confused' | 'playful', duration = 1400) {
    setCatMood(mood);
    setTimeout(() => setCatMood('idle'), duration);
  }

  function handleCorrect() { triggerMood('happy'); }
  function handleWrong()   { triggerMood('confused'); }

  async function handleComplete(newAnswers: AnswerRecord[], behavior?: BehaviorSummary) {
    const allAnswers = [...answers, ...newAnswers];
    setAnswers(allAnswers);
    setGameOver(true);

    if (playerUid && assessmentId && !resultSaved) {
      const correct  = allAnswers.filter(a => a.correct).length;
      const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
      try {
        await saveAttempt({
          playerUid,
          assessmentId,
          chosenGameMode: gameMode,
          score: correct,
          accuracy,
          completedAt: new Date(),
          behavior,
        });
        setResultSaved(true);
      } catch (e) {
        console.error('Failed to save attempt:', e);
      }
    }
  }

  function handleRestart() {
    setGameOver(false);
    setAnswers([]);
    setCatMood('idle');
  }

  if (gameOver) {
    return (
      <ResultScreen
        answers={answers}
        totalQuestions={totalQuestions}
        nickname={nickname}
        onRestart={!assessmentId ? handleRestart : undefined}
      />
    );
  }

  const modePill =
    gameMode === 'matching'
      ? '🧩 Match all pairs then submit!'
      : '🪢 Connect all terms then submit!';

  return (
    <div className="cat-game-container">
      <div className="cat-center-area">
        <CatSprite mood={catMood} />
        <div className="mode-pill">{modePill}</div>
      </div>

      <div className="interaction-area">
        {gameMode === 'matching' && (
          <MatchAndTreat
            items={activeItems}
            onCorrect={handleCorrect}
            onWrong={handleWrong}
            onComplete={handleComplete}
          />
        )}
        {gameMode === 'ropelink' && (
          <RopeAndLink
            items={activeItems}
            onCorrect={handleCorrect}
            onWrong={handleWrong}
            onComplete={handleComplete}
          />
        )}
      </div>
    </div>
  );
}
