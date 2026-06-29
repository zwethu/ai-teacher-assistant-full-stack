// ─── Universal content unit ────────────────────────────────────────────────
export type GameItem = {
  id: string;
  term: string;
  definition: string;
};

// ─── Game modes (MCQ removed) ──────────────────────────────────────────────
export type GameMode = 'matching' | 'ropelink';

export type GameState = 'playing' | 'result';

export type CatMood = 'idle' | 'happy' | 'confused' | 'playful' | 'eating' | 'sleeping';

// ─── Answer record ─────────────────────────────────────────────────────────
export type AnswerRecord = {
  questionId: string;
  correct: boolean;
};

// ─── Behavior summary (stealth assessment signals) ─────────────────────────
export type BehaviorSummary = {
  firstActionDelayMs: number;       // planning: time from puzzle shown → first action
  submitCount: number;              // total submit presses
  wrongSubmitCount: number;         // submits that had at least one wrong pair/link
  totalWrongLinksOrPairs: number;   // cumulative wrong pairs across all submits
  reviewTimesMs: number[];          // durations between feedback shown → next change/submit
};

// ─── Firebase documents ────────────────────────────────────────────────────
export type GameSession = {
  id: string;
  batchId: string;
  status: 'open' | 'closed' | 'expired';
  items: GameItem[];
  createdAt: Date;
  expiresAt?: Date;
  gameModeStats?: {
    matching: number;
    ropelink: number;
  };
};

export type PlayerProfile = {
  uid: string;
  nickname: string;
  email: string;
};

export type AttemptResult = {
  playerUid: string;
  assessmentId: string;
  chosenGameMode: GameMode;
  score: number;
  accuracy: number;
  fish: number;
  happiness: number;
  completedAt: Date;
  behavior?: BehaviorSummary;       // stealth assessment data
};
