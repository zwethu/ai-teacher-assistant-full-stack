// ─── Universal content unit ────────────────────────────────────────────────
export type GameItem = {
  id: string;
  term: string;
  definition: string;
};

// ─── Game modes (MCQ removed) ──────────────────────────────────────────────
export type GameMode = 'matching' | 'ropelink' | 'bucket';

// ─── Player-chosen avatar (cat person vs dog person) ───────────────────────
export type AvatarType = 'cat' | 'dog';

export type GameState = 'playing' | 'result';

export type CatMood = 'idle' | 'happy' | 'confused' | 'playful' | 'eating' | 'sleeping';

// ─── Answer record ─────────────────────────────────────────────────────────
export type AnswerRecord = {
  questionId: string;
  correct: boolean;
};

// ─── One press of Submit ───────────────────────────────────────────────────
// A round is played as a series of submits — the player fills the board, sends
// it, gets told which parts were wrong, fixes them, sends again. Timing each
// press separately is what separates "thought hard once" from "guessed six
// times quickly"; the round total alone can't tell those apart.
//
// Deliberately just these two: position, "was it clean" and "when since round
// start" are all derivable (array order, wrongCount === 0, running sum), and a
// stored field nothing reads is a field a report can silently disagree with.
export type SubmissionRecord = {
  durationMs: number;               // time spent on it: since round start (1st) or since the previous submit
  wrongCount: number;               // wrong pairs/links/chips in THIS submit
};

// ─── Signals the individual game modes track during one round ──────────────
// All timings are monotonic (performance.now), so moving the device clock
// mid-round can't stretch or shrink them.
export type BehaviorSignals = {
  /** Planning: board shown → first action. Null when the player never acted —
   *  which is NOT the same as acting instantly, so it must not read as 0. */
  firstActionDelayMs: number | null;
  submitCount: number;              // submit presses in this round
  wrongSubmitCount: number;         // submits that had at least one wrong pair/link
  totalWrongLinksOrPairs: number;   // cumulative wrong pairs across this round's submits
  reviewTimesMs: number[];          // durations between feedback shown → next change/submit
  completed: boolean;               // a submit came back fully clean
  submissions: SubmissionRecord[];
};

// ─── One round (one page of items) as STORED on the attempt ────────────────
// Slimmer than the signals the mode reports: the per-round planning delay and
// review times are already rolled into the session totals every consumer reads,
// so persisting them twice would just be duplication.
export type RoundSummary = {
  roundIndex: number;               // 0-based
  itemCount: number;                // items dealt to this round
  /** Board dealt → round handed back to the engine. Includes the celebration
   *  animation, so consecutive rounds tile the session with no gaps. */
  durationMs: number;
  /** Time this round's board was on screen but the tab was NOT visible. The
   *  round clock keeps running in a background tab, so without this a player who
   *  left to look something up is indistinguishable from one who sat and
   *  thought — the two readings a long round could otherwise mean. */
  awayMs: number;
  submitCount: number;
  wrongSubmitCount: number;
  totalWrongLinksOrPairs: number;
  completed: boolean;               // cleared, vs cut short by timeout/skip
  submissions: SubmissionRecord[];
};

// ─── Full stealth-assessment summary = per-round data + session totals ─────
export type BehaviorSummary = {
  // Session totals, summed across every round the player reached.
  firstActionDelayMs: number | null;  // the FIRST round's planning delay (later rounds measure a warmed-up player)
  submitCount: number;                // total submits across the whole session
  wrongSubmitCount: number;
  totalWrongLinksOrPairs: number;
  reviewTimesMs: number[];

  /** Session time, capped at the limit — what the player is shown and what the
   *  medal's "fast" bonus reads. See `elapsedSinceStartMs` for the true figure. */
  durationMs: number;
  /** True wall-clock since the run's server stamp, UNCAPPED. A value far above
   *  `timeLimitMs` means the player left the run open and came back — the cap on
   *  `durationMs` hides exactly that. */
  elapsedSinceStartMs: number;
  /** Sum of the rounds' own durations: time actually spent on a board. The gap
   *  between this and `durationMs` is idle time, time away, and celebrations. */
  activePlayMs: number;

  /** Total time the tab was hidden during the run, and how many separate times
   *  they left. Long round + awayMs ≈ 0 reads as thinking; long round + a large
   *  awayMs reads as leaving. Blind to a second device — a phone beside the
   *  laptop never hides the tab. */
  awayMs: number;
  awayCount: number;

  timedOut: boolean;                // true if the countdown ran out before all-correct
  timeLimitMs: number;              // the time limit that was in effect
  totalRounds: number;              // rounds the session was dealt (reached or not)
  roundsCompleted: number;          // rounds actually cleared
  rounds: RoundSummary[];           // one entry per round REACHED, in play order
};

// ─── Firebase documents ────────────────────────────────────────────────────
export type GameSession = {
  id: string;
  batchId: string;
  /** 'active' is legacy: games created before the backend adopted this contract. */
  status: 'open' | 'closed' | 'expired' | 'active';
  items: GameItem[];
  createdAt: Date;
  expiresAt?: Date;
  /**
   * Lecturer's due date. Past it, entry is refused; absent means no deadline.
   * Typed loosely because it arrives as a Firestore Timestamp from the player's
   * direct read and as an ISO string from the lecturer API.
   */
  deadlineAt?: { toDate: () => Date } | Date | string | null;
  gameModeStats?: {
    matching: number;
    ropelink: number;
    bucket: number;
  };
};

export type PlayerProfile = {
  uid: string;
  nickname: string;
  email: string;
};

// The server's answer to "when did this run start, and what time is it now?".
// Both read off the server clock, so the gap between them is elapsed time the
// player can't touch by refreshing or moving their device clock.
export type TimedRun = {
  startedAtMs: number;
  serverNowMs: number;
};

/** Encouragement, not a rank — but it is what the student was shown, so the
 *  lecturer's export has to report the same word rather than recompute one. */
export type MedalTier = 'gold' | 'silver' | 'bronze';

export type AttemptResult = {
  playerUid: string;
  assessmentId: string;
  chosenGameMode: GameMode;
  chosenAvatar?: AvatarType;        // cat person vs dog person
  score: number;
  accuracy: number;
  completedAt: Date;
  behavior?: BehaviorSummary;       // stealth assessment data

  // ─── Denormalised for the lecturer's results export ──────────────────────
  // These already exist elsewhere (players/{uid}, and the medal is derived from
  // accuracy + behavior), but copying them here at write time is what keeps the
  // export a single query. Reading them back through joins would cost a read per
  // student per export and would need rules letting a lecturer read every
  // player profile — a wider door than the feature is worth.
  nickname: string;
  email: string;
  /** The name on the Google account, which is not the nickname they chose and
   *  not necessarily the name on the class roster either. All three can differ,
   *  so the export carries whichever ones exist. */
  oauthName: string;
  /** Copied so a results export never has to read the game document back just
   *  to learn which class the attempt belongs to. */
  batchId: string;
  /** The tier the student actually saw on their result screen. */
  medalTier: MedalTier;
};

// A saved attempt read back from Firestore. `id` is the doc id
// (`{assessmentId}_{playerUid}`) — the certificate's verification key.
// completedAt comes back as a Firestore Timestamp, so keep it loose.
export type StoredAttempt = Omit<AttemptResult, 'completedAt'> & {
  id: string;
  completedAt: unknown;
};
