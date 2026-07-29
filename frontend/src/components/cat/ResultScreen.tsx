import { useEffect, useState } from 'react';
import { PawPrint, CheckCircle, Target, Timer, Hourglass, Medal, ArrowsClockwise } from '@phosphor-icons/react';
import type { AnswerRecord, AvatarType, BehaviorSummary } from '../../types/catGame.types';
import CatSprite from './CatSprite';
import Confetti from './Confetti';
import PartyPopper from './PartyPopper';
import CertificateModal from './CertificateModal';
import MusicToggle from './MusicToggle';
import { computeMedal, formatDuration } from './medal';
import { playWin } from './juice';

type Props = {
  answers: AnswerRecord[];
  totalQuestions: number;
  behavior?: BehaviorSummary;
  species?: AvatarType;
  nickname?: string;
  assessmentId?: string;
  playerUid?: string;
  onRestart?: () => void;
};

export default function ResultScreen({
  answers, totalQuestions, behavior, species = 'cat', nickname,
  assessmentId, playerUid, onRestart,
}: Props) {
  const correct  = answers.filter(a => a.correct).length;
  const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;
  const medal    = computeMedal(accuracy, behavior);

  const celebrate = medal.tier !== 'bronze';
  const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  // Firestore attempt doc id — the teacher's manual-verification key.
  // Only present for real saved attempts (absent in the no-auth preview).
  const certId = assessmentId && playerUid ? `${assessmentId}_${playerUid}` : undefined;

  const [show, setShow] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setShow(true); if (celebrate) playWin(); }, 600);
    return () => clearTimeout(t);
  }, [celebrate]);

  const spriteMood = medal.tier === 'bronze' ? 'idle' : 'happy';

  return (
    <div className={`result-screen result-screen--${medal.tier} theme-${species}`}>
      {show && celebrate && <Confetti />}
      {/* The popper fires on EVERY tier (bronze included) — the medal always
          deserves its pop-in moment; confetti/sound stay gated to celebrate. */}
      {show && <PartyPopper />}

      {/* Outside the `show` gate: the win chime and confetti fire here, so the
          mute has to be reachable from the first frame, not after the reveal. */}
      <MusicToggle className="result-mute" />

      <div className="result-card result-card--row">
        <div className="result-col result-col-left">
          {nickname && (
            <p className="result-nickname">
              <PawPrint size={14} weight="fill" /> {nickname}'s result
            </p>
          )}
          <div className="result-cat-wrap">
            <CatSprite mood={spriteMood} species={species} size="result" />
          </div>
        </div>

        {show && (
          <div className="result-col result-col-right">
            <div className={`result-medal result-medal--${medal.tier}`}>
              <span className="result-medal-emoji">{medal.emoji}</span>
              <h2 className="result-medal-title">{medal.title}</h2>
              <p className="result-medal-blurb">{medal.blurb}</p>
            </div>

            <div className="result-stats">
              <div className="stat-row">
                <span className="stat-label"><CheckCircle size={17} weight="duotone" /> Correct</span>
                <span className="stat-value">{correct} / {totalQuestions}</span>
              </div>
              <div className="stat-row">
                <span className="stat-label"><Target size={17} weight="duotone" /> Accuracy</span>
                <span className="stat-value">{accuracy}%</span>
              </div>
              {behavior && (
                <div className="stat-row">
                  <span className="stat-label"><Timer size={17} weight="duotone" /> Time</span>
                  <span className="stat-value">{formatDuration(behavior.durationMs)}</span>
                </div>
              )}
            </div>

            {behavior?.timedOut && (
              <p className="result-timeout-note">
                <Hourglass size={15} weight="duotone" /> Time's up — here's how far you got!
              </p>
            )}

            <button className="cert-open-btn" onClick={() => setCertOpen(true)}>
              <Medal size={20} weight="duotone" /> Get Certificate
            </button>

            {onRestart && (
              <button className="restart-btn" onClick={onRestart}>
                <ArrowsClockwise size={19} weight="bold" /> Play Again
              </button>
            )}
          </div>
        )}
      </div>

      {certOpen && (
        <CertificateModal
          nickname={nickname || 'Player'}
          medal={medal}
          correct={correct}
          total={totalQuestions}
          accuracy={accuracy}
          species={species}
          dateStr={dateStr}
          certId={certId}
          onClose={() => setCertOpen(false)}
        />
      )}
    </div>
  );
}
