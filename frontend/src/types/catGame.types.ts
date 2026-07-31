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

// ─── Signals the individual game modes track during play ───────────────────
export type BehaviorSignals = {
  firstActionDelayMs: number;       // planning: time from puzzle shown → first action
  submitCount: number;              // total submit presses
  wrongSubmitCount: number;         // submits that had at least one wrong pair/link
  totalWrongLinksOrPairs: number;   // cumulative wrong pairs across all submits
  reviewTimesMs: number[];          // durations between feedback shown → next change/submit
};

// ─── Full stealth-assessment summary = mode signals + engine-owned timing ──
export type BehaviorSummary = BehaviorSignals & {
  durationMs: number;               // total time from puzzle shown → finish (or timeout)
  timedOut: boolean;                // true if the countdown ran out before all-correct
  timeLimitMs: number;              // the time limit that was in effect
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

export type AttemptResult = {
  playerUid: string;
  assessmentId: string;
  chosenGameMode: GameMode;
  chosenAvatar?: AvatarType;        // cat person vs dog person
  score: number;
  accuracy: number;
  completedAt: Date;
  behavior?: BehaviorSummary;       // stealth assessment data
};

// A saved attempt read back from Firestore. `id` is the doc id
// (`{assessmentId}_{playerUid}`) — the certificate's verification key.
// completedAt comes back as a Firestore Timestamp, so keep it loose.
export type StoredAttempt = Omit<AttemptResult, 'completedAt'> & {
  id: string;
  completedAt: unknown;
};
