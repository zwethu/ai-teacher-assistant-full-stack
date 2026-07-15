import { forwardRef } from 'react';
import { PawPrint } from '@phosphor-icons/react';
import type { AvatarType } from '../../types/catGame.types';
import type { Medal } from './medal';

type Props = {
  nickname: string;
  medal: Medal;
  correct: number;
  total: number;
  accuracy: number;
  species: AvatarType;
  dateStr: string;
  certId?: string;   // Firestore attempt id — teacher's manual-verification key
};

// Fixed-size printable card. Rendered to PNG via html-to-image, so keep it
// self-contained (emoji + inline-styled text, no Lottie/animation).
const Certificate = forwardRef<HTMLDivElement, Props>(function Certificate(
  { nickname, medal, correct, total, accuracy, dateStr, certId }, ref,
) {
  return (
    <div ref={ref} className={`certificate certificate--${medal.tier}`}>
      <div className="cert-inner">
        <p className="cert-kicker"><PawPrint size={14} weight="fill" /> Learning Game</p>
        <h1 className="cert-title">Certificate of Completion</h1>
        <div className="cert-rule" />

        <p className="cert-awarded">This certificate is proudly presented to</p>
        <p className="cert-name">{nickname}</p>
        <p className="cert-desc">for completing the assessment game and earning</p>

        <div className="cert-medal">
          <span className="cert-medal-emoji">{medal.emoji}</span>
          <span className="cert-medal-title">{medal.title}</span>
        </div>

        <div className="cert-stats">
          <div className="cert-stat">
            <span className="cert-stat-num">{correct}/{total}</span>
            <span className="cert-stat-lbl">Correct</span>
          </div>
          <div className="cert-stat">
            <span className="cert-stat-num">{accuracy}%</span>
            <span className="cert-stat-lbl">Accuracy</span>
          </div>
        </div>

        <div className="cert-footer">
          <span>{dateStr}</span>
          <span>Teaching Assistant</span>
        </div>

        {certId && (
          <p className="cert-verify">
            Verification ID: <span className="cert-verify-code">{certId}</span>
          </p>
        )}
      </div>
    </div>
  );
});

export default Certificate;
