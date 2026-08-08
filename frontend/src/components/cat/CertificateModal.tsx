import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { toPng } from 'html-to-image';
import type { AvatarType } from '../../types/catGame.types';
import type { Medal } from './medal';
import Certificate from './Certificate';
import './certificate.css';

type Props = {
  nickname: string;
  medal: Medal;
  correct: number;
  total: number;
  accuracy: number;
  species: AvatarType;
  dateStr: string;
  certId?: string;
  onClose: () => void;
};

/** The certificate's fixed layout width — see .certificate in certificate.css. */
const CERT_WIDTH = 640;

export default function CertificateModal({ onClose, ...data }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [fit, setFit] = useState({ scale: 1, height: 0 });

  // The card is 640px wide by design (it exports that way), which overflows any
  // phone — so the on-screen copy is scaled to fit.
  // The available width comes from the VIEWPORT, not from the wrapper's parent:
  // the parent shrink-wraps its content, so measuring it would feed the already
  // scaled-down width back in and shrink the card again on every pass.
  useLayoutEffect(() => {
    const measure = () => {
      // .cert-modal-overlay caps the modal at 92vw (and its own 20px padding
      // caps it again on tiny screens); the modal then spends 20px a side.
      const avail = Math.min(window.innerWidth * 0.92, window.innerWidth - 40) - 40;
      setFit({
        scale: Math.min(1, Math.max(0.35, avail / CERT_WIDTH)),
        height: ref.current?.offsetHeight ?? 0,
      });
    };
    measure();
    // offsetHeight is measured before the fonts/emoji settle, so re-measure
    // when the card's own box changes. Safe from feedback: the scale is a
    // transform, and transforms don't change the node's layout size.
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  async function download() {
    if (!ref.current) return;
    setSaving(true);
    try {
      // Explicit size + transform:none on the clone, so the downloaded PNG is
      // always the full 640px card no matter how far the screen copy is scaled
      // down. (html-to-image would otherwise size it from the scaled rect;
      // offsetWidth/offsetHeight ignore transforms.)
      const dataUrl = await toPng(ref.current, {
        pixelRatio: 2,
        cacheBust: true,
        width: ref.current.offsetWidth,
        height: ref.current.offsetHeight,
        style: { transform: 'none', transformOrigin: 'top left' },
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `certificate-${data.nickname.replace(/\s+/g, '_')}.png`;
      a.click();
    } catch (e) {
      console.error('Certificate export failed:', e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`cert-modal-overlay theme-${data.species}`} onClick={onClose}>
      <div className="cert-modal" onClick={e => e.stopPropagation()}>
        <div className="cert-scroll">
          <div
            className="cert-fit"
            style={{ '--cert-scale': String(fit.scale), '--cert-height': `${fit.height}px` } as CSSProperties}
          >
            <Certificate ref={ref} {...data} />
          </div>
        </div>
        <div className="cert-modal-actions">
          <button className="cert-download-btn" onClick={download} disabled={saving}>
            {saving ? 'Preparing…' : <><DownloadSimple size={18} weight="bold" /> Download PNG</>}
          </button>
          <button className="cert-close-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
