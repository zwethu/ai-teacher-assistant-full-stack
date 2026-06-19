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
  const [fish, setFish] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [catMood, setCatMood] = useState<'idle' | 'happy' | 'confused' | 'playful' | 'eating'>('idle');

  const totalQuestions = MOCK_MCQ.length + MOCK_MATCHING.reduce((acc, q) => acc + q.pairs.length, 0);
  const answered = answers.length;

  function triggerMood(mood: 'happy' | 'confused' | 'playful', duration = 1400) {
    setCatMood(mood);
    setTimeout(() => setCatMood('idle'), duration);
  }

  function handleMCQComplete(newAnswers: AnswerRecord[]) {
    setAnswers(prev => [...prev, ...newAnswers]);
    setGameState('playing_b');
  }

  function handleMatchComplete(newAnswers: AnswerRecord[]) {
    setAnswers(prev => [...prev, ...newAnswers]);
    setGameState('result');
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

  function handleRestart() {
    setGameState('playing_a');
    setHappiness(60);
    setFish(0);
    setAnswers([]);
    setCatMood('idle');
  }

  if (gameState === 'result') {
    return (
      <ResultScreen
        answers={answers}
        totalQuestions={totalQuestions}
        happiness={happiness}
        fish={fish}
        onRestart={handleRestart}
      />
    );
  }

  return (
    <div className="cat-game-container">
      {/* Cozy room decorations */}
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
        <div className="mode-pill">
          {gameState === 'playing_a'
            ? '🐾 Answer questions to earn 🐟 fish!'
            : '🧩 Match the pairs for more 🐟 fish!'}
        </div>
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
