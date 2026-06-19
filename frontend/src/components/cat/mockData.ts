import type { MCQQuestion, MatchingQuestion } from '../../types/catGame.types';

export const MOCK_MCQ: MCQQuestion[] = [
  {
    id: 'mcq-1',
    type: 'mcq',
    question: 'What is the capital of France?',
    options: ['Berlin', 'Madrid', 'Paris', 'Rome'],
    correctIndex: 2,
  },
  {
    id: 'mcq-2',
    type: 'mcq',
    question: 'What is 7 × 8?',
    options: ['54', '56', '64', '48'],
    correctIndex: 1,
  },
  {
    id: 'mcq-3',
    type: 'mcq',
    question: 'Which planet is closest to the Sun?',
    options: ['Venus', 'Earth', 'Mars', 'Mercury'],
    correctIndex: 3,
  },
  {
    id: 'mcq-4',
    type: 'mcq',
    question: 'What gas do plants absorb from the air?',
    options: ['Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen'],
    correctIndex: 2,
  },
  {
    id: 'mcq-5',
    type: 'mcq',
    question: 'How many sides does a hexagon have?',
    options: ['5', '6', '7', '8'],
    correctIndex: 1,
  },
  {
    id: 'mcq-6',
    type: 'mcq',
    question: 'Who wrote Romeo and Juliet?',
    options: ['Dickens', 'Shakespeare', 'Hemingway', 'Austen'],
    correctIndex: 1,
  },
];

export const MOCK_MATCHING: MatchingQuestion[] = [
  {
    id: 'match-1',
    type: 'matching',
    pairs: [
      { left: 'Dog', right: 'Bark' },
      { left: 'Cat', right: 'Meow' },
      { left: 'Cow', right: 'Moo' },
      { left: 'Duck', right: 'Quack' },
      { left: 'Lion', right: 'Roar' },
      { left: 'Bee', right: 'Buzz' },
    ],
  },
];
