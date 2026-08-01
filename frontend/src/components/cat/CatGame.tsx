import { useState, useRef, useEffect, useMemo } from 'react';
import { FastForward, ArrowsClockwise } from '@phosphor-icons/react';
import type {
  AnswerRecord, GameMode, GameItem, AvatarType,
  CatMood, BehaviorSignals, BehaviorSummary, RoundSummary, TimedRun,
} from '../../types/catGame.types';
import { MOCK_ITEMS } from './mockData';
import CatSprite from './CatSprite';
import GameTimer from './GameTimer';
import MatchAndTreat from './modes/MatchAndTreat';
import RopeAndLink from './modes/RopeAndLink';
import BucketFill from './modes/BucketFill';
import ResultScreen from './ResultScreen';
import MusicToggle from './MusicToggle';
import GameGuide from './GameGuide';
import PageSpinner from '../ui/PageSpinner';
import { playRoundClear, playWrong } from './juice';
import { computeMedal } from './medal';
import { useMusic } from './useMusic';
import { saveAttempt, startTimedRun } from '../../lib/gameSession';
import { gameTimeLimitMs } from '../../lib/gameTiming';
import './CatGame.css';
// The can't-reach-the-server card below is the same family as the entry page's
// gates (invalid link, not enrolled, past deadline), so it wears their clothes.
// Imported explicitly rather than leaning on the entry page having loaded first
// — this component also renders from the standalone preview route.
import '../../pages/PlayEntryPage.css';

// Static gameplay parameters (methodology: defined in the engine, not by AI).
// Shared with the lecturer's generator form so the round length it quotes and
// the clock the student actually gets can't drift apart.

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

// ─── Anchoring the run to the server clock ─────────────────────────────────
// This used to fail OPEN: if the anchor call threw, the error was logged and
// the player kept a fresh full-length clock. That was a working cheat — block
// Firestore's write channel in devtools, reload, and the countdown resets every
// time, which is exactly the "go look the answers up and come back" case the
// server anchor exists to stop.
//
// So an UNREACHABLE server now fails CLOSED. Real network blips are absorbed by
// retrying first; only a persistent failure reaches the student, and then as a
// retryable screen rather than a lockout — the run doc lives on the server, so a
// later retry resumes the genuine remaining time rather than handing out a new one.
//
// A REJECTED write is a different animal and must not be treated the same way.
// `permission-denied` means the project has no rules for `gameRuns`, i.e. the
// timed-run feature was never provisioned. A student cannot manufacture that by
// pulling their network — going offline raises `unavailable`, never
// `permission-denied` — so the cheat this guard exists to stop is unaffected,
// while treating it as fatal would lock every honest student out of an exam
// because of an ops gap they cannot see or fix. So: play on a local clock, and
// make enough noise in the console that whoever deploys sees why.
const ANCHOR_RETRY_DELAYS_MS = [400, 1200];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type AnchorResult =
  | { kind: 'anchored'; run: TimedRun }
  /** Rules rejected the write — the server has no timed-run support configured. */
  | { kind: 'unconfigured' }
  /** Server could not be reached. Retrying may genuinely help. */
  | { kind: 'unreachable' };

function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 'permission-denied';
}

async function anchorRun(assessmentId: string, playerUid: string): Promise<AnchorResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      const run = await startTimedRun(assessmentId, playerUid);
      if (run) return { kind: 'anchored', run };
      // A null run is the same problem wearing a different hat: the read-back
      // found no doc, so we have no idea when this run started.
    } catch (e) {
      if (isPermissionDenied(e)) {
        console.error(
          'Timed runs are not provisioned: Firestore rejected the write to `gameRuns`. ' +
            'Deploy a `/gameRuns/{runId}` rule (see docs/firestore.rules) or the countdown ' +
            'cannot be anchored to the server clock and students play on a local timer.',
          e,
        );
        return { kind: 'unconfigured' };
      }
      console.error('Could not anchor the timer to the server clock:', e);
    }
    if (attempt >= ANCHOR_RETRY_DELAYS_MS.length) return { kind: 'unreachable' };
    await sleep(ANCHOR_RETRY_DELAYS_MS[attempt]);
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Per-round data → session totals. Sums the counters, keeps the FIRST round's
 *  planning delay (that's the "puzzle shown → first move" beat; later rounds
 *  measure a warmed-up player and would dilute it). The rounds themselves are
 *  carried through untouched — summing them was the old behaviour, and it threw
 *  away every per-round timing before anything reached storage. */
function sessionTotals(rounds: RoundSummary[]) {
  return {
    firstActionDelayMs:     rounds[0]?.firstActionDelayMs ?? null,
    submitCount:            rounds.reduce((n, r) => n + r.submitCount, 0),
    wrongSubmitCount:       rounds.reduce((n, r) => n + r.wrongSubmitCount, 0),
    totalWrongLinksOrPairs: rounds.reduce((n, r) => n + r.totalWrongLinksOrPairs, 0),
    reviewTimesMs:          rounds.flatMap(r => r.reviewTimesMs),
    activePlayMs:           rounds.reduce((n, r) => n + r.durationMs, 0),
    roundsCompleted:        rounds.filter(r => r.completed).length,
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
  const timeLimitMs    = gameTimeLimitMs(totalQuestions);

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

  // One theme per pet, held through the result screen — there's no separate
  // lobby track to fall back to, and a switch mid-celebration reads as a glitch.
  useMusic(avatar);

  // Answers/signals accumulate across pages in refs, not state: a page's
  // completion handler needs the running totals synchronously to decide
  // whether it's finalizing, and a state update wouldn't have landed yet.
  const pageAnswersRef = useRef<AnswerRecord[]>([]);
  const roundsRef      = useRef<RoundSummary[]>([]);

  // When the current round's board went up. The engine owns this rather than
  // the mode: it's the only place that sees both ends of a round, so it can
  // time a round the mode never got to finish, and it measures right through
  // the post-clear celebration — which keeps consecutive rounds tiling the
  // session instead of leaving a 1.8s hole between each one.
  const roundStartRef = useRef(performance.now());

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
  const [syncing,     setSyncing]     = useState(isTimedRun);
  const [syncFailed,  setSyncFailed]  = useState(false);
  // Bumped by the Try Again button; re-runs the effect below.
  const [syncAttempt, setSyncAttempt] = useState(0);

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
      if (!assessmentId || !playerUid) {
        setAnchor(timeLimitMs);
        setRemainingMs(timeLimitMs);
        setSyncing(false);
        return;
      }

      const result = await anchorRun(assessmentId, playerUid);
      if (cancelled) return;

      // Unreachable: no anchor, no game. See anchorRun for why.
      if (result.kind === 'unreachable') {
        setSyncFailed(true);
        setSyncing(false);
        return;
      }

      // Unconfigured: the feature isn't provisioned server-side. Blocking the
      // student would punish them for that, so they get a local clock — which is
      // exactly the behaviour this whole flow had before the anchor existed.
      if (result.kind === 'unconfigured') {
        setAnchor(timeLimitMs);
        setRemainingMs(timeLimitMs);
        setSyncing(false);
        return;
      }

      const { run } = result;
      const remaining = timeLimitMs - (run.serverNowMs - run.startedAtMs);
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
  }, [assessmentId, playerUid, timeLimitMs, syncAttempt]);

  function handleRetrySync() {
    setSyncFailed(false);
    setSyncing(true);
    setSyncAttempt(n => n + 1);
  }

  useEffect(() => {
    if (gameOver || syncing || syncFailed) return;
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
  }, [gameOver, syncing, syncFailed]);

  // A board becomes visible on the first render after the clock syncs, and
  // again on every page turn. Both are the same event as far as timing goes.
  useEffect(() => {
    if (!syncing && !gameOver) roundStartRef.current = performance.now();
  }, [pageIndex, syncing, gameOver]);

  function triggerMood(mood: 'happy' | 'confused' | 'playful', duration = 1400) {
    setCatMood(mood);
    setTimeout(() => setCatMood('idle'), duration);
  }

  // ─── "Wrong" screen shake ────────────────────────────────────────────────
  // The whole board jolts (and the phone buzzes, via playWrong) on a wrong
  // submit. It's a whole-screen motion cue, not a colour one, so it doesn't
  // point at WHICH pair was wrong — the per-card shake already does that, and
  // colour-coding wrong is off-limits (it would coach the player).
  const [shaking, setShaking] = useState(false);
  const shakeTimerRef = useRef<number | undefined>(undefined);

  function shakeScreen() {
    // Drop the class and re-add it on the next frame, otherwise a second wrong
    // submit while the class is still on wouldn't restart the animation.
    setShaking(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setShaking(true)));
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = window.setTimeout(() => setShaking(false), 600);
  }

  useEffect(() => () => clearTimeout(shakeTimerRef.current), []);

  // Modes call onCorrect only on a submit that comes back entirely clean, so
  // this IS the round-cleared moment — hence the fanfare rather than a ping.
  function handleCorrect() { triggerMood('happy'); playRoundClear(); }
  function handleWrong()   { triggerMood('confused'); playWrong(); shakeScreen(); }

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
    const elapsed = Math.max(0, timeLimitMs - remainingNow());
    const rounds  = roundsRef.current;

    const summary: BehaviorSummary = {
      ...sessionTotals(rounds),
      // Capped: this is the number the player is shown and the medal reads.
      durationMs: Math.min(timeLimitMs, elapsed),
      // Uncapped. The two only differ when the player was away longer than the
      // limit — a student who left the run open and came back — and the cap
      // above is what would otherwise hide that.
      elapsedSinceStartMs: elapsed,
      timedOut:    timeUpRef.current,
      timeLimitMs,
      totalRounds: totalPages,
      rounds,
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
          nickname,
          chosenGameMode: gameMode,
          chosenAvatar:   avatar,
          score:          correct,
          accuracy,
          // Stored, not recomputed later: the lecturer's export should report
          // the medal this student was actually shown. Deriving it again in
          // another language is how a report starts disagreeing with the app.
          medalTier:      computeMedal(accuracy, summary).tier,
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
    roundsRef.current = [...roundsRef.current, {
      ...signals,
      roundIndex: pageIndex,
      itemCount:  pages[pageIndex]?.length ?? 0,
      durationMs: Math.round(performance.now() - roundStartRef.current),
      // The mode only stamps a solve time on the submit that came back clean,
      // so this distinguishes "cleared it" from "the clock/skip ended it".
      completed:  signals.solveDurationMs !== null,
    }];

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
    roundsRef.current      = [];
    roundStartRef.current  = performance.now();
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

  // The closed door. Deliberately NOT a playable board with a local clock —
  // that was the cheat. Retrying is safe and cheap: the run is already stamped
  // server-side, so a successful retry picks up the real remaining time.
  if (syncFailed) {
    return (
      <div className={`play-entry-bg theme-${avatar}`}>
        <div className="play-card">
          <CatSprite mood="confused" species={avatar} />
          <h2 className="play-title">Can't Reach the Server</h2>
          <p className="play-subtitle">
            Your round can't start until we check how much time you have left.
          </p>
          <p className="play-hint">Check your connection and try again 🐾</p>
          <button className="play-primary-btn" onClick={handleRetrySync}>
            <ArrowsClockwise size={18} weight="bold" /> Try Again
          </button>
        </div>
      </div>
    );
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

  // The mode hint rides in the pet's speech bubble (it "talks" the tip).
  const hintText =
    gameMode === 'matching' ? 'Tap a card, then tap its match!'
    : gameMode === 'ropelink' ? 'Drag a term across to its match!'
    : 'Drag each item into its bucket!';

  // Rides in the board's top row, left of Submit. The left column is just the
  // hint bubble + pet, sitting at the bottom of the row.
  const roundIndicator = totalPages > 1 ? (
    <div className="page-indicator" aria-live="polite">
      <span className="page-indicator-text">Round {pageIndex + 1} of {totalPages}</span>
    </div>
  ) : null;

  const sidebar = (
    <>
      {demoMode && (
        <div className="mode-side-top">
          <button
            type="button"
            className="demo-skip-btn"
            onClick={handleSkip}
            title="Demo only — end now and show the result screen"
          >
            <FastForward size={16} weight="fill" /> Skip
          </button>
        </div>
      )}
      <CatSprite mood={catMood} species={avatar} size="game" hint={hintText} />
    </>
  );

  // key={pageIndex} remounts the mode on each new page, resetting the
  // per-page refs it tracks signals in (a prop change alone wouldn't).
  const pageItems = pages[pageIndex] ?? [];
  const modeProps = {
    sidebar,
    roundIndicator,
    avatar,
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
    <div className={`cat-game-container theme-${avatar}${shaking ? ' cat-game-container--shake' : ''}`}>
      <div className="game-timer-corner">
        <GameTimer remainingMs={remainingMs} timeLimitMs={timeLimitMs} />
      </div>
      <MusicToggle className="game-mute" />
      <GameGuide gameMode={gameMode} />
      {gameMode === 'matching' && <MatchAndTreat key={pageIndex} {...modeProps} />}
      {gameMode === 'ropelink' && <RopeAndLink   key={pageIndex} {...modeProps} />}
      {gameMode === 'bucket'   && <BucketFill    key={pageIndex} {...modeProps} />}
    </div>
  );
}
