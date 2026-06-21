import type { MCQQuestion, MatchingQuestion, RopeLinkQuestion } from '../../types/catGame.types';

export const MOCK_MCQ: MCQQuestion[] = [
  {
    id: 'mcq-1',
    type: 'mcq',
    question: 'What is the powerhouse of the cell?',
    options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi Apparatus'],
    correctIndex: 1,
  },
  {
    id: 'mcq-2',
    type: 'mcq',
    question: 'What does CPU stand for?',
    options: ['Central Processing Unit', 'Computer Personal Unit', 'Core Power Unit', 'Central Program Utility'],
    correctIndex: 0,
  },
  {
    id: 'mcq-3',
    type: 'mcq',
    question: 'Which planet is closest to the Sun?',
    options: ['Venus', 'Earth', 'Mercury', 'Mars'],
    correctIndex: 2,
  },
];

export const MOCK_MATCHING: MatchingQuestion[] = [
  {
    id: 'match-1',
    type: 'matching',
    pairs: [
      { left: 'Dog',    right: 'Woof' },
      { left: 'Cat',    right: 'Meow' },
      { left: 'Cow',    right: 'Moo'  },
      { left: 'Duck',   right: 'Quack' },
      { left: 'Frog',   right: 'Ribbit' },
      { left: 'Snake',  right: 'Hiss' },
    ],
  },
];

export const MOCK_ROPELINK: RopeLinkQuestion[] = [
  {
    id: 'rope-1',
    type: 'ropelink',
    pairs: [
      { question: 'H₂O',       answer: 'Water' },
      { question: 'NaCl',      answer: 'Salt' },
      { question: 'O₂',        answer: 'Oxygen' },
      { question: 'CO₂',       answer: 'Carbon Dioxide' },
    ],
  },
  {
    id: 'rope-2',
    type: 'ropelink',
    pairs: [
      { question: 'Paris',     answer: 'France' },
      { question: 'Tokyo',     answer: 'Japan' },
      { question: 'Bangkok',   answer: 'Thailand' },
      { question: 'Berlin',    answer: 'Germany' },
    ],
  },
];
