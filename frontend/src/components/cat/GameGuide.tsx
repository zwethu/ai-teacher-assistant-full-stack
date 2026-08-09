import { useState } from 'react';
import {
  Question, X, PuzzlePiece, LinkSimple, Basket,
  Timer, CheckCircle, HandPointing, Trophy,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { GameMode } from '../../types/catGame.types';

type Guide = { icon: Icon; title: string; goal: string; steps: string[] };

// One guide per mode — the "how do I play THIS game" info, in a friendly
// game-manual voice. Kept here (not in the mode files) so all three read the
// same and the dialog can render any of them.
const GUIDES: Record<GameMode, Guide> = {
  matching: {
    icon: PuzzlePiece,
    title: 'Match & Treat',
    goal: 'Pair every term with its matching definition.',
    steps: [
      'Tap a card to pick it up — it lights up in your buddy’s colour.',
      'Tap the card that matches it (a term ↔ its definition) to link the pair.',
      'Linked one by mistake? Tap the ✕ on the card to unpair it.',
      'Pair all the cards, then press “Submit Answers”.',
    ],
  },
  ropelink: {
    icon: LinkSimple,
    title: 'Rope & Link',
    goal: 'Connect each term on the left to its definition on the right.',
    steps: [
      'Drag from a term on the left across to its definition on the right.',
      'A rope connects them — connected cards light up in your buddy’s colour.',
      'Want to redo one? Tap the connected card, or its ✕, to disconnect.',
      'Connect them all, then press “Submit Answers”.',
    ],
  },
  bucket: {
    icon: Basket,
    title: 'Fill the Bucket',
    goal: 'Sort every item into the bucket it belongs to.',
    steps: [
      'Drag an item from the tray into the bucket it belongs in.',
      'Each bucket holds one item — it lights up in your buddy’s colour.',
      'Put one in the wrong spot? Tap the ✕ to send it back to the tray.',
      'Fill every bucket, then press “Submit Answers”.',
    ],
  },
};

// Shared across every mode — the rules of the whole game, not one board.
const TIPS: { icon: Icon; text: string }[] = [
  { icon: Timer,       text: 'Beat the timer! When it runs out, your board is scored just as it is.' },
  { icon: CheckCircle, text: 'After you submit, correct answers glow green with a ✅.' },
  { icon: HandPointing,text: 'A wrong answer only wiggles — no penalty, just try again.' },
  { icon: Trophy,      text: 'Finish to earn a medal — the faster and fewer tries, the shinier!' },
];

/** Floating “?” help button that opens a game-manual dialog for the mode.
 *
 *  Opens by itself the moment the board appears: a player who has never seen
 *  this mode shouldn't have to guess that the “?” in the corner is where the
 *  rules live. The button stays for re-reading it mid-round.
 *
 *  This component mounts once per game page (it sits outside the keyed mode),
 *  so the dialog shows once per load — turning to round 2 doesn't reopen it. */
export default function GameGuide({ gameMode }: { gameMode: GameMode }) {
  const [open, setOpen] = useState(true);
  const guide = GUIDES[gameMode];
  const ModeIcon = guide.icon;

  return (
    <>
      <button
        type="button"
        className="game-guide-btn"
        onClick={() => setOpen(true)}
        aria-label="How to play"
        title="How to play"
      >
        <Question size={20} weight="bold" />
        <span className="game-guide-btn-label">Guide</span>
      </button>

      {open && (
        <div className="guide-overlay" onClick={() => setOpen(false)}>
          <div
            className="guide-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Game guide"
            onClick={e => e.stopPropagation()}
          >
            <button className="guide-close" onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} weight="bold" />
            </button>

            <div className="guide-head">
              <span className="guide-badge"><Question size={22} weight="fill" /></span>
              <div>
                <p className="guide-kicker">Game Guide</p>
                <h2 className="guide-title"><ModeIcon size={20} weight="duotone" /> {guide.title}</h2>
              </div>
            </div>

            <p className="guide-goal"><Trophy size={16} weight="fill" /> {guide.goal}</p>

            <ol className="guide-steps">
              {guide.steps.map((s, i) => (
                <li key={i}>
                  <span className="guide-step-num">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>

            <div className="guide-tips">
              <p className="guide-tips-head">Good to know</p>
              {TIPS.map(({ icon: TipIcon, text }, i) => (
                <p key={i} className="guide-tip">
                  <TipIcon size={17} weight="duotone" /> <span>{text}</span>
                </p>
              ))}
            </div>

            <button className="guide-got-it" onClick={() => setOpen(false)}>
              Got it — let’s play!
            </button>
          </div>
        </div>
      )}
    </>
  );
}
