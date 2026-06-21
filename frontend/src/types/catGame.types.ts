export type MCQQuestion = {
  id: string;
  type: 'mcq';
  question: string;
  options: string[];
  correctIndex: number;
};

export type MatchingQuestion = {
  id: string;
  type: 'matching';
  pairs: { left: string; right: string }[];
};

export type RopeLinkQuestion = {
  id: string;
  type: 'ropelink';
  pairs: { question: string; answer: string }[];
};

export type Question = MCQQuestion | MatchingQuestion | RopeLinkQuestion;

export type AnswerRecord = {
  questionId: string;
  correct: boolean;
};

export type GameMode = 'mcq' | 'matching' | 'ropelink';

export type GameState = 'playing' | 'result';

export type CatMood = 'idle' | 'happy' | 'confused' | 'playful' | 'eating';

export type GameSession = {
  id: string;
  batchId: string;
  gameMode: GameMode;
  status: 'open' | 'closed' | 'expired';
  questions: Question[];
  createdAt: Date;
  expiresAt?: Date;
};

export type PlayerProfile = {
  uid: string;
  nickname: string;
  email: string;
};

export type AttemptResult = {
  playerUid: string;
  assessmentId: string;
  score: number;
  accuracy: number;
  fish: number;
  happiness: number;
  completedAt: Date;
};
