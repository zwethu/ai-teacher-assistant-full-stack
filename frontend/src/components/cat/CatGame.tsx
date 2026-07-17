import { useState, useRef, useEffect, useMemo } from 'react';
import { PuzzlePiece, LinkSimple, Basket, FastForward } from '@phosphor-icons/react';
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
import MusicToggle from './MusicToggle';
import PageSpinner from '../ui/PageSpinner';
import { playCorrect, playWrong } from './juice';
import { useMusic } from './useMusic';
import { saveAttempt, startTimedRun } from '../../lib/gameSession';
import './CatGame.css';

// Static gameplay parameters (methodology: defined in the engine, not by AI)
const SECONDS_PER_ITEM = 30;
const MIN_LIMIT_MS = 60_000;

// A board of 30 items would be unplayable, so items are dealt out in pages of
// 6. A page is cleared when all 6 are correct (same all-correct rule as before,
// just applied per page), then the next page is dealt. 30 items → 5 pages.
// Pagination lives here in the shared engine, so all three modes inherit it
// without change: each mode still only ever sees one page's worth of items.
const PAGE_SIZE = 6;

// Presentation escape hatch, off unless the URL carries `?demo=1`: shows a
// Skip control that ends the session immediately so a demo can reach the
// result screen without playing every round. A skipped run is scored only on
// what the player actually placed and is never written to Firestore — it is a
// stage prop, not an attempt.
function useDemoMode() {
  return useMemo(
    () => new URLSearchParams(window.location.search).get('demo') === '1',
    [],
  );
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Per-page signals → one summary. Sums the counters, keeps the FIRST page's
 *  planning delay (that's the "puzzle shown → first move" beat; later pages
 *  measure a warmed-up player and would dilute it). */
function mergeSignals(pages: BehaviorSignals[]): BehaviorSignals {
  return {
    firstActionDelayMs:     pages[0]?.firstActionDelayMs ?? 0,
    submitCount:            pages.reduce((n, p) => n + p.submitCount, 0),
    wrongSubmitCount:       pages.reduce((n, p) => n + p.wrongSubmitCount, 0),
    totalWrongLinksOrPairs: pages.reduce((n, p) => n + p.totalWrongLinksOrPairs, 0),
    reviewTimesMs:          pages.flatMap(p => p.reviewTimesMs),
  };
}

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

  // Whatever the session holds, dealt 6 at a time. A 6-item session is simply
  // a single page, so short sessions behave exactly as they did before.
  const pages      = useMemo(() => chunk(activeItems, PAGE_SIZE), [activeItems]);
  const totalPages = pages.length;

  const [pageIndex,   setPageIndex]   = useState(0);
  const [gameOver,    setGameOver]    = useState(false);
  const [answers,     setAnswers]     = useState<AnswerRecord[]>([]);
  const [behavior,    setBehavior]    = useState<BehaviorSummary | undefined>();
  const [catMood,     setCatMood]     = useState<CatMood>('idle');
  const [resultSaved, setResultSaved] = useState(false);

  const demoMode = useDemoMode();
  const [skipped, setSkipped] = useState(false);
  const skipRef = useRef(false);

  // Each avatar gets its own theme; the result screen drops back to the calm one.
  useMusic(gameOver ? 'menu' : avatar);

  // Answers/signals accumulate across pages in refs, not state: a page's
  // completion handler needs the running totals synchronously to decide
  // whether it's finalizing, and a state update wouldn't have landed yet.
  const pageAnswersRef = useRef<AnswerRecord[]>([]);
  const pageSignalsRef = useRef<BehaviorSignals[]>([]);

  // ─── Countdown timer (owned by the shared engine, spans ALL pages) ───────
  // Anchored to the server, not this device. `startTimedRun` stamps the run's
  // start with the server clock on first load and hands the same stamp back on
  // every later load, so refreshing mid-run resumes the countdown instead of
  // restarting it. Between round-trips we tick on performance.now(), which is
  // monotonic — winding the OS clock back doesn't slow it down.
  const [remainingMs, setRemainingMs] = useState(timeLimitMs);
  const [timeUp,      setTimeUp]      = useState(false);
  const timeUpRef = useRef(false);
  const doneRef   = useRef(false);

  // How much was left the last time the server told us, and the monotonic
  // reading at that moment. Everything else is derived from these two.
  const anchorRef = useRef<{ remainingAtSyncMs: number; perfAtSyncMs: number } | null>(null);
  const isTimedRun = Boolean(assessmentId && playerUid);
  const [syncing, setSyncing] = useState(isTimedRun);

  function remainingNow() {
    const anchor = anchorRef.current;
    if (!anchor) return timeLimitMs;
    return anchor.remainingAtSyncMs - (performance.now() - anchor.perfAtSyncMs);
  }

  function setAnchor(remainingAtSyncMs: number) {
    anchorRef.current = { remainingAtSyncMs, perfAtSyncMs: performance.now() };
  }

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      // Practice runs (no assessment) have nothing to cheat — no attempt is
      // ever written — so they just start the clock locally.
      let remaining = timeLimitMs;

      if (assessmentId && playerUid) {
        try {
          const run = await startTimedRun(assessmentId, playerUid);
          if (run) remaining = timeLimitMs - (run.serverNowMs - run.startedAtMs);
        } catch (e) {
          // Fails open: a network blip or a rules mistake shouldn't lock a
          // student out of an assessment they're entitled to sit. They get a
          // fresh local clock, which is the behaviour we had before this.
          console.error('Could not anchor the timer to the server clock:', e);
        }
      }

      if (cancelled) return;
      setAnchor(remaining);
      setRemainingMs(Math.max(0, remaining));
      // Already spent: they ran the clock out and came back for another go.
      if (remaining <= 0) {
        timeUpRef.current = true;
        setTimeUp(true);
      }
      setSyncing(false);
    }

    sync();
    return () => { cancelled = true; };
  }, [assessmentId, playerUid, timeLimitMs]);

  useEffect(() => {
    if (gameOver || syncing) return;
    const id = setInterval(() => {
      const left = remainingNow();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameOver, syncing]);

  function triggerMood(mood: 'happy' | 'confused' | 'playful', duration = 1400) {
    setCatMood(mood);
    setTimeout(() => setCatMood('idle'), duration);
  }

  function handleCorrect() { triggerMood('happy'); playCorrect(); }
  function handleWrong()   { triggerMood('confused'); playWrong(); }

  async function finalize() {
    const collected = pageAnswersRef.current;
    const isSkip    = skipRef.current;

    // Pages never reached (ran out of time) still have to count against the
    // total, or accuracy would be scored out of only what was played. A demo
    // skip is the deliberate exception: it ends the session on purpose, so the
    // rounds it cut short are left out of the score entirely.
    const answered = new Set(collected.map(a => a.questionId));
    const allAnswers: AnswerRecord[] = isSkip ? collected : [
      ...collected,
      ...activeItems
        .filter(i => !answered.has(i.id))
        .map(i => ({ questionId: i.id, correct: false })),
    ];
    setAnswers(allAnswers);

    // Derived from the same server-anchored clock the countdown runs on, so
    // duration — a signal the assessment reads — can't be shortened by a
    // refresh either.
    const summary: BehaviorSummary = {
      ...mergeSignals(pageSignalsRef.current),
      durationMs:  Math.min(timeLimitMs, Math.max(0, timeLimitMs - remainingNow())),
      timedOut:    timeUpRef.current,
      timeLimitMs,
    };
    setBehavior(summary);
    setGameOver(true);

    if (isSkip) return;   // a skipped run is a demo, never a real attempt

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

  // Fired by a mode when its page is all-correct OR by its timeout finalizer.
  async function handlePageComplete(newAnswers: AnswerRecord[], signals: BehaviorSignals) {
    if (doneRef.current) return;   // guard against double-finish (complete vs timeout race)

    pageAnswersRef.current = [...pageAnswersRef.current, ...newAnswers];
    pageSignalsRef.current = [...pageSignalsRef.current, signals];

    const isLastPage = pageIndex >= totalPages - 1;
    if (timeUpRef.current || skipRef.current || isLastPage) {
      doneRef.current = true;
      await finalize();
      return;
    }

    triggerMood('playful');
    setPageIndex(i => i + 1);
  }

  // Reuses the timeout path: the active mode already knows how to grade the
  // board it's holding and report it, so skip just tells it to do that now.
  // `skipped` rides along to keep untouched questions out of the score.
  function handleSkip() {
    if (doneRef.current || skipRef.current) return;
    skipRef.current = true;
    setSkipped(true);
    setTimeUp(true);
  }

  // Only offered on practice runs (see the ResultScreen call below) — a real
  // attempt can't be replayed, which is why resetting the clock here is fine.
  function handleRestart() {
    doneRef.current   = false;
    timeUpRef.current = false;
    skipRef.current   = false;
    setSkipped(false);
    pageAnswersRef.current = [];
    pageSignalsRef.current = [];
    setPageIndex(0);
    setGameOver(false);
    setAnswers([]);
    setBehavior(undefined);
    setCatMood('idle');
    setTimeUp(false);
    setRemainingMs(timeLimitMs);
    setAnchor(timeLimitMs);
  }

  // Hold the board back until the clock is real. Showing it first would start
  // the player on a full-time countdown that then snaps to the truth, and would
  // start measuring their planning delay against a puzzle they can't submit yet.
  if (syncing) {
    return <PageSpinner label="Starting your round…" tips={[]} />;
  }

  if (gameOver) {
    return (
      <ResultScreen
        answers={answers}
        totalQuestions={skipped ? answers.length : totalQuestions}
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

  // Left column of the Z: status (timer, sound) → avatar → what to do.
  // The submit CTA deliberately lives at the END of the board column instead,
  // so the eye finishes bottom-right rather than jumping back left.
  const sidebar = (
    <>
      <div className="mode-side-top">
        <GameTimer remainingMs={remainingMs} timeLimitMs={timeLimitMs} />
        <MusicToggle />
        {demoMode && (
          <button
            type="button"
            className="demo-skip-btn"
            onClick={handleSkip}
            title="Demo only — end now and show the result screen"
          >
            <FastForward size={16} weight="fill" /> Skip
          </button>
        )}
      </div>
      <CatSprite mood={catMood} species={avatar} />
      {totalPages > 1 && (
        <div className="page-indicator" aria-live="polite">
          <span className="page-indicator-text">Round {pageIndex + 1} of {totalPages}</span>
          <span className="page-dots" aria-hidden="true">
            {pages.map((_, i) => (
              <span
                key={i}
                className={[
                  'page-dot',
                  i < pageIndex  ? 'page-dot--done'    : '',
                  i === pageIndex ? 'page-dot--current' : '',
                ].filter(Boolean).join(' ')}
              />
            ))}
          </span>
        </div>
      )}
      <div className="mode-pill">{modePill}</div>
    </>
  );

  // key={pageIndex} remounts the mode on each new page, resetting the
  // per-page refs it tracks signals in (a prop change alone wouldn't).
  const pageItems = pages[pageIndex] ?? [];
  const modeProps = {
    sidebar,
    items:      pageItems,
    timeUp,
    // A real timeout grades the whole board (unplaced = wrong); a demo skip
    // grades only what the player touched, so cutting the round short early
    // doesn't read as a wall of wrong answers.
    countUnplaced: !skipped,
    onCorrect:  handleCorrect,
    onWrong:    handleWrong,
    onComplete: handlePageComplete,
  };

  return (
    <div className="cat-game-container">
      {gameMode === 'matching' && <MatchAndTreat key={pageIndex} {...modeProps} />}
      {gameMode === 'ropelink' && <RopeAndLink   key={pageIndex} {...modeProps} />}
      {gameMode === 'bucket'   && <BucketFill    key={pageIndex} {...modeProps} />}
    </div>
  );
}
