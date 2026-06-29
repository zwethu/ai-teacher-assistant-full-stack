// ─── Universal content unit ─────────────────────────────────────
export type GameItem = {
  id: string;
  term: string;
  definition: string;
};

// ─── Game modes ──────────────────────────────────────────────────
export type GameMode = 'mcq' | 'matching' | 'ropelink';

export type GameState = 'playing' | 'result';

export type CatMood = 'idle' | 'happy' | 'confused' | 'playful' | 'eating' | 'sleeping';

// ─── Answer record (shared across all modes) ─────────────────────
export type AnswerRecord = {
  questionId: string;
  correct: boolean;
};

// ─── Firebase documents ──────────────────────────────────────────
export type GameSession = {
  id: string;
  batchId: string;
  // gameMode removed — student picks at runtime
  status: 'open' | 'closed' | 'expired';
  items: GameItem[];          // replaces questions array
  createdAt: Date;
  expiresAt?: Date;
  gameModeStats?: {
    mcq: number;
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
  chosenGameMode: GameMode;   // NEW — which mode the student chose
  score: number;
  accuracy: number;
  fish: number;
  happiness: number;
  completedAt: Date;
};
