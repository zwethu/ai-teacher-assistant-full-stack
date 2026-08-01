import { useRef } from 'react';
import type { BehaviorSignals, SubmissionRecord } from '../../types/catGame.types';

/**
 * The stealth-assessment stopwatch for ONE round, shared by all three modes.
 *
 * It used to be ~30 lines of refs copy-pasted into MatchAndTreat, RopeAndLink
 * and BucketFill. Three copies meant three chances to drift, and the drift was
 * real: none of them measured how long a submit took, so a round that took six
 * frantic guesses and one that took a single considered answer produced the
 * same numbers.
 *
 * Everything here is `performance.now()` — monotonic, so winding the device
 * clock back mid-round can't stretch or shrink a measurement. (`Date.now()`,
 * which this replaces, could be moved at will.)
 *
 * The engine remounts the mode per round (`key={pageIndex}`), so the hook's
 * first render IS the round's start; `resetRound` exists for the modes that
 * re-stamp once the board has actually painted.
 */
export function useRoundSignals() {
  const roundStartRef    = useRef(performance.now());
  const firstActionRef   = useRef<number | null>(null);
  const clearedAtRef     = useRef<number | null>(null);
  const lastSubmitAtRef  = useRef<number | null>(null);
  // Set when feedback lands, cleared by the next player action — the gap
  // between the two is how long they spent reading it.
  const lastFeedbackAtRef = useRef<number | null>(null);
  const submissionsRef   = useRef<SubmissionRecord[]>([]);
  const wrongSubmitsRef  = useRef(0);
  const totalWrongRef    = useRef(0);
  const reviewTimesRef   = useRef<number[]>([]);

  /** Re-anchors the round to now. Call once the board is on screen. */
  function resetRound() {
    roundStartRef.current     = performance.now();
    firstActionRef.current    = null;
    clearedAtRef.current      = null;
    lastSubmitAtRef.current   = null;
    lastFeedbackAtRef.current = null;
    submissionsRef.current    = [];
    wrongSubmitsRef.current   = 0;
    totalWrongRef.current     = 0;
    reviewTimesRef.current    = [];
  }

  /** Any player interaction with the board: a tap, a drag, a submit. */
  function recordFirstAction() {
    const now = performance.now();
    if (firstActionRef.current === null) firstActionRef.current = now;
    if (lastFeedbackAtRef.current !== null) {
      reviewTimesRef.current.push(Math.round(now - lastFeedbackAtRef.current));
      lastFeedbackAtRef.current = null;
    }
  }

  /**
   * One press of Submit, already graded. Call it once per press, after the
   * board has been marked — it owns every counter the round reports, so the
   * modes never touch them directly.
   */
  function recordSubmit(wrongCount: number) {
    const now  = performance.now();
    // First submit is timed from the board appearing; later ones from the
    // previous submit, which is the fix-and-resend beat we're after.
    const from = lastSubmitAtRef.current ?? roundStartRef.current;

    submissionsRef.current.push({
      index:               submissionsRef.current.length + 1,
      atMsSinceRoundStart: Math.round(now - roundStartRef.current),
      durationMs:          Math.round(now - from),
      clean:               wrongCount === 0,
      wrongCount,
    });

    lastSubmitAtRef.current = now;
    totalWrongRef.current  += wrongCount;
    if (wrongCount > 0) wrongSubmitsRef.current += 1;
    else                clearedAtRef.current = now;

    // Feedback is on screen from this moment.
    lastFeedbackAtRef.current = now;
  }

  /** Snapshot for the engine. Arrays are copied so a later submit can't
   *  rewrite a round that has already been reported. */
  function buildSignals(): BehaviorSignals {
    return {
      firstActionDelayMs: firstActionRef.current === null
        ? null
        : Math.round(firstActionRef.current - roundStartRef.current),
      submitCount:            submissionsRef.current.length,
      wrongSubmitCount:       wrongSubmitsRef.current,
      totalWrongLinksOrPairs: totalWrongRef.current,
      reviewTimesMs:          [...reviewTimesRef.current],
      solveDurationMs: clearedAtRef.current === null
        ? null
        : Math.round(clearedAtRef.current - roundStartRef.current),
      submissions:            [...submissionsRef.current],
    };
  }

  return { resetRound, recordFirstAction, recordSubmit, buildSignals };
}
