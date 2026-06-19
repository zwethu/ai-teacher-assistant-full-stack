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

export type Question = MCQQuestion | MatchingQuestion;

export type AnswerRecord = {
  questionId: string;
  correct: boolean;
};

export type GameState = 'playing_a' | 'playing_b' | 'result';

export type CatMood = 'idle' | 'happy' | 'confused' | 'playful';
