import type { GameItem } from '../../types/catGame.types';

// One unified mock dataset — all three modes are generated from this
export const MOCK_ITEMS: GameItem[] = [
  { id: '1', term: 'Mitochondria',   definition: 'Powerhouse of the cell' },
  { id: '2', term: 'CPU',            definition: 'Central Processing Unit' },
  { id: '3', term: 'Mercury',        definition: 'Closest planet to the Sun' },
  { id: '4', term: 'H₂O',           definition: 'Water' },
  { id: '5', term: 'NaCl',           definition: 'Salt' },
  { id: '6', term: 'Photosynthesis', definition: 'Process plants use to make food' },
  { id: '7', term: 'Bangkok',        definition: 'Capital of Thailand' },
  { id: '8', term: 'Tokyo',          definition: 'Capital of Japan' },
];
