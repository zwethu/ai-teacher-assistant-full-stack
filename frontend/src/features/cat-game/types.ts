export type QuestionType = 'mcq' | 'pair';

export interface MCQOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  type: QuestionType;
  category: string;
  text: string;
  options?: MCQOption[];
  correctOptionId?: string;
  pairs?: { left: string; right: string }[];
}

export interface SubjectPack {
  id: string;
  name: string;
  icon: string;
  description: string;
  questions: Question[];
}

export type CatMood = 'idle' | 'happy' | 'confused' | 'playful' | 'purring';

export interface UserStats {
  coins: number;
  fish: number;
  happiness: number;
  questionsAnswered: number;
  correctAnswers: number;
  petCount: number;
}

export interface SessionResult {
  id: string;
  timestamp: string;
  subjectName: string;
  correctCount: number;
  totalQuestions: number;
  percentage: number;
  coinsEarned: number;
  finalHappiness: number;
}
