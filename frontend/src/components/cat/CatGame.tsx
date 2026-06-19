import { useState } from 'react';
import type { AnswerRecord, GameState } from '../../types/catGame.types';
import { MOCK_MCQ, MOCK_MATCHING } from './mockData';
import HUD from './HUD';
import CatSprite from './CatSprite';
import PetAndChoose from './modes/PetAndChoose';
import MatchAndTreat from './modes/MatchAndTreat';
import ResultScreen from './ResultScreen';
import './CatGame.css';

export default function CatGame() {
  const [gameState, setGameState] = useState<GameState>('playing_a');
  const [happiness, setHappiness] = useState(60);
  const [coins, setCoins] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [catMood, setCatMood] = useState<'idle' | 'happy' | 'confused' | 'playful'>('idle');

  const totalQuestions = MOCK_MCQ.length + MOCK_MATCHING.reduce((acc, q) => acc + q.pairs.length, 0);
  const answered = answers.length;

  function handleMCQComplete(newAnswers: AnswerRecord[]) {
    setAnswers(prev => [...prev, ...newAnswers]);
    setGameState('playing_b');
  }

  function handleMatchComplete(newAnswers: AnswerRecord[]) {
    setAnswers(prev => [...prev, ...newAnswers]);
    setGameState('result');
  }

  function handleCorrect() {
    setCatMood('happy');
    setHappiness(h => Math.min(100, h + 10));
    setCoins(c => c + 5);
    setTimeout(() => setCatMood('idle'), 1200);
  }

  function handleWrong() {
    setCatMood('confused');
    setHappiness(h => Math.max(0, h - 5));
    setTimeout(() => setCatMood('idle'), 1200);
  }

  function handleMatchPlay() {
    setCatMood('playful');
    setCoins(c => c + 5);
    setHappiness(h => Math.min(100, h + 8));
    setTimeout(() => setCatMood('idle'), 1200);
  }

  function handleRestart() {
    setGameState('playing_a');
    setHappiness(60);
    setCoins(0);
    setAnswers([]);
    setCatMood('idle');
  }

  if (gameState === 'result') {
    return (
      <ResultScreen
        answers={answers}
        totalQuestions={totalQuestions}
        happiness={happiness}
        coins={coins}
        onRestart={handleRestart}
      />
    );
  }

  return (
    <div className="cat-game-container">
      {/* Decorative room background elements */}
      <div className="room-deco window">🪟</div>
      <div className="room-deco plant">🪴</div>
      <div className="room-deco pillow">🛋️</div>

      <HUD
        happiness={happiness}
        answered={answered}
        totalQuestions={totalQuestions}
        coins={coins}
      />

      <div className="cat-center-area">
        <CatSprite mood={catMood} />
        {gameState === 'playing_a' && (
          <p className="mode-label">🐾 Pet & Choose – Answer to earn treats!</p>
        )}
        {gameState === 'playing_b' && (
          <p className="mode-label">🧩 Match & Treat – Find the right pairs!</p>
        )}
      </div>

      <div className="interaction-area">
        {gameState === 'playing_a' && (
          <PetAndChoose
            questions={MOCK_MCQ}
            onCorrect={handleCorrect}
            onWrong={handleWrong}
            onComplete={handleMCQComplete}
          />
        )}
        {gameState === 'playing_b' && (
          <MatchAndTreat
            questions={MOCK_MATCHING}
            onMatch={handleMatchPlay}
            onComplete={handleMatchComplete}
          />
        )}
      </div>
    </div>
  );
}
