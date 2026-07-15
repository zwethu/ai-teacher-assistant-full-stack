import { useState, useRef, useEffect } from 'react';
import { PuzzlePiece, LinkSimple, Basket } from '@phosphor-icons/react';
import type {
  AnswerRecord, GameMode, GameItem, AvatarType,
  CatMood, BehaviorSignals, BehaviorSummary,
} from '../../types/catGame.types';
import { MOCK_ITEMS } from './mockData';
import CatSprite from './CatSprite';
import GameTimer from './GameTimer';
import MatchAndTreat from './modes/MatchAndTreat';
import RopeAndLink from './modes/RopeAndLink';
import BucketFill from './modes/BucketFill';
import ResultScreen from './ResultScreen';
import { playCorrect, playWrong } from './juice';
import { saveAttempt } from '../../lib/gameSession';
import './CatGame.css';

// Static gameplay parameters (methodology: defined in the engine, not by AI)
const SECONDS_PER_ITEM = 30;
const MIN_LIMIT_MS = 60_000;

type Props = {
  gameMode: GameMode;
  avatar?: AvatarType;
  items?: GameItem[];
  nickname?: string;
  playerUid?: string;
  assessmentId?: string;
};

export default function CatGame({
  gameMode,
  avatar = 'cat',
  items,
  nickname = 'Player',
  playerUid,
  assessmentId,
}: Props) {
  const activeItems    = items && items.length > 0 ? items : MOCK_ITEMS;
  const totalQuestions = activeItems.length;
  const timeLimitMs    = Math.max(MIN_LIMIT_MS, totalQuestions * SECONDS_PER_ITEM * 1000);

  const [gameOver,    setGameOver]    = useState(false);
  const [answers,     setAnswers]     = useState<AnswerRecord[]>([]);
  const [behavior,    setBehavior]    = useState<BehaviorSummary | undefined>();
  const [catMood,     setCatMood]     = useState<CatMood>('idle');
  const [resultSaved, setResultSaved] = useState(false);

  // ─── Countdown timer (owned by the shared engine) ───────────────────────
  const [remainingMs, setRemainingMs] = useState(timeLimitMs);
  const [timeUp,      setTimeUp]      = useState(false);
  const startRef  = useRef<number>(Date.now());
  const timeUpRef = useRef(false);
  const doneRef   = useRef(false);

  useEffect(() => {
    if (gameOver) return;
    startRef.current = Date.now();
    const id = setInterval(() => {
      const left = timeLimitMs - (Date.now() - startRef.current);
      if (left <= 0) {
        setRemainingMs(0);
        timeUpRef.current = true;
        setTimeUp(true);
        clearInterval(id);
      } else {
        setRemainingMs(left);
      }
    }, 200);
    return () => clearInterval(id);
  }, [timeLimitMs, gameOver]);

  function triggerMood(mood: 'happy' | 'confused' | 'playful', duration = 1400) {
    setCatMood(mood);
    setTimeout(() => setCatMood('idle'), duration);
  }

  function handleCorrect() { triggerMood('happy'); playCorrect(); }
  function handleWrong()   { triggerMood('confused'); playWrong(); }

  // Fired by a mode on all-correct OR by the mode's timeout finalizer.
  async function handleComplete(newAnswers: AnswerRecord[], signals: BehaviorSignals) {
    if (doneRef.current) return;   // guard against double-finish (complete vs timeout race)
    doneRef.current = true;

    const allAnswers = [...answers, ...newAnswers];
    setAnswers(allAnswers);

    const summary: BehaviorSummary = {
      ...signals,
      durationMs:  Math.min(timeLimitMs, Date.now() - startRef.current),
      timedOut:    timeUpRef.current,
      timeLimitMs,
    };
    setBehavior(summary);
    setGameOver(true);

    if (playerUid && assessmentId && !resultSaved) {
      const correct  = allAnswers.filter(a => a.correct).length;
      const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
      try {
        await saveAttempt({
          playerUid,
          assessmentId,
          chosenGameMode: gameMode,
          chosenAvatar:   avatar,
          score:          correct,
          accuracy,
          completedAt:    new Date(),
          behavior:       summary,
        });
        setResultSaved(true);
      } catch (e) {
        console.error('Failed to save attempt:', e);
      }
    }
  }

  function handleRestart() {
    doneRef.current   = false;
    timeUpRef.current = false;
    setGameOver(false);
    setAnswers([]);
    setBehavior(undefined);
    setCatMood('idle');
    setTimeUp(false);
    setRemainingMs(timeLimitMs);
    startRef.current = Date.now();
  }

  if (gameOver) {
    return (
      <ResultScreen
        answers={answers}
        totalQuestions={totalQuestions}
        behavior={behavior}
        species={avatar}
        nickname={nickname}
        assessmentId={assessmentId}
        playerUid={playerUid}
        onRestart={!assessmentId ? handleRestart : undefined}
      />
    );
  }

  const modePill =
    gameMode === 'matching' ? (
      <><PuzzlePiece size={17} weight="duotone" /> Match all pairs then submit!</>
    ) : gameMode === 'ropelink' ? (
      <><LinkSimple size={17} weight="duotone" /> Connect all terms then submit!</>
    ) : (
      <><Basket size={17} weight="duotone" /> Sort each item into its bucket!</>
    );

  // Avatar + timer + mode pill — stacked on the left, above each mode's controls.
  const sidebar = (
    <>
      <GameTimer remainingMs={remainingMs} timeLimitMs={timeLimitMs} />
      <CatSprite mood={catMood} species={avatar} />
      <div className="mode-pill">{modePill}</div>
    </>
  );

  return (
    <div className="cat-game-container">
      {gameMode === 'matching' && (
        <MatchAndTreat
          sidebar={sidebar}
          items={activeItems}
          timeUp={timeUp}
          onCorrect={handleCorrect}
          onWrong={handleWrong}
          onComplete={handleComplete}
        />
      )}
      {gameMode === 'ropelink' && (
        <RopeAndLink
          sidebar={sidebar}
          items={activeItems}
          timeUp={timeUp}
          onCorrect={handleCorrect}
          onWrong={handleWrong}
          onComplete={handleComplete}
        />
      )}
      {gameMode === 'bucket' && (
        <BucketFill
          sidebar={sidebar}
          items={activeItems}
          timeUp={timeUp}
          onCorrect={handleCorrect}
          onWrong={handleWrong}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}
