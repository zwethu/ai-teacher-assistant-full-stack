import type { GameItem } from '../../types/catGame.types';

// One unified mock dataset — all three modes are generated from this.
// 30 items = 5 pages of 6 (PAGE_SIZE in CatGame.tsx), so /play-preview
// exercises the full paged flow. Real sessions use gameSessions.items.
export const MOCK_ITEMS: GameItem[] = [
  // Biology
  { id: '1',  term: 'Mitochondria',   definition: 'Powerhouse of the cell' },
  { id: '2',  term: 'Photosynthesis', definition: 'Process plants use to make food' },
  { id: '3',  term: 'Ribosome',       definition: 'Builds proteins in the cell' },
  { id: '4',  term: 'Chlorophyll',    definition: 'Green pigment that absorbs sunlight' },
  { id: '5',  term: 'Osmosis',        definition: 'Water moving across a membrane' },
  { id: '6',  term: 'Herbivore',      definition: 'Animal that eats only plants' },

  // Computing
  { id: '7',  term: 'CPU',            definition: 'Central Processing Unit' },
  { id: '8',  term: 'RAM',            definition: 'Temporary working memory' },
  { id: '9',  term: 'Algorithm',      definition: 'Step-by-step set of instructions' },
  { id: '10', term: 'Pixel',          definition: 'Smallest dot in a digital image' },
  { id: '11', term: 'Binary',         definition: 'Number system using only 0 and 1' },
  { id: '12', term: 'Firewall',       definition: 'Blocks unwanted network traffic' },

  // Space
  { id: '13', term: 'Mercury',        definition: 'Closest planet to the Sun' },
  { id: '14', term: 'Jupiter',        definition: 'Largest planet in the Solar System' },
  { id: '15', term: 'Comet',          definition: 'Icy body that grows a tail near the Sun' },
  { id: '16', term: 'Galaxy',         definition: 'Huge system of stars and dust' },
  { id: '17', term: 'Orbit',          definition: 'Curved path one object takes around another' },
  { id: '18', term: 'Eclipse',        definition: 'One body passing into another’s shadow' },

  // Chemistry
  { id: '19', term: 'H₂O',            definition: 'Water' },
  { id: '20', term: 'NaCl',           definition: 'Salt' },
  { id: '21', term: 'O₂',             definition: 'Oxygen gas' },
  { id: '22', term: 'CO₂',            definition: 'Carbon dioxide' },
  { id: '23', term: 'Atom',           definition: 'Smallest unit of an element' },
  { id: '24', term: 'Alloy',          definition: 'Mixture of two or more metals' },

  // Geography
  { id: '25', term: 'Bangkok',        definition: 'Capital of Thailand' },
  { id: '26', term: 'Tokyo',          definition: 'Capital of Japan' },
  { id: '27', term: 'Nile',           definition: 'Longest river in Africa' },
  { id: '28', term: 'Everest',        definition: 'Highest mountain on Earth' },
  { id: '29', term: 'Sahara',         definition: 'Largest hot desert in the world' },
  { id: '30', term: 'Amazon',         definition: 'Largest rainforest in the world' },
];
