import { useRef, useState } from 'react';
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

export default function CertificateModal({ onClose, ...data }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  async function download() {
    if (!ref.current) return;
    setSaving(true);
    try {
      const dataUrl = await toPng(ref.current, { pixelRatio: 2, cacheBust: true });
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
    <div className="cert-modal-overlay" onClick={onClose}>
      <div className="cert-modal" onClick={e => e.stopPropagation()}>
        <div className="cert-scroll">
          <Certificate ref={ref} {...data} />
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
