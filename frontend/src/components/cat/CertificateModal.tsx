import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DownloadSimple } from '@phosphor-icons/react';
import { toBlob } from 'html-to-image';
import type { AvatarType } from '../../types/catGame.types';
import type { Medal } from './medal';
import Certificate from './Certificate';
import './certificate.css';

/**
 * WebKit — Safari on Mac, and EVERY browser on iPhone/iPad (they are all
 * Safari's engine underneath). Two of its quirks shape the download path:
 * the first html-to-image capture renders with missing fonts/emoji, and
 * anchor-click downloads of big data: URLs fail (silently on iOS Chrome,
 * after the permission prompt on Safari).
 */
const isWebKit =
  typeof navigator !== 'undefined' &&
  /AppleWebKit/i.test(navigator.userAgent) &&
  !/Chrome\/|Chromium\//.test(navigator.userAgent);

/** iPhone/iPad — including iPadOS, which masquerades as a Mac but has touch. */
const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

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
      const options = {
        pixelRatio: 2,
        cacheBust: true,
        width: ref.current.offsetWidth,
        height: ref.current.offsetHeight,
        style: { transform: 'none', transformOrigin: 'top left' },
      };

      // WebKit renders the first capture before the inlined fonts and emoji
      // have settled — a well-known html-to-image bug. Two throwaway passes
      // warm the cache so the pass we keep is complete.
      if (isWebKit) {
        await toBlob(ref.current, options);
        await toBlob(ref.current, options);
      }
      // A Blob, never a data: URL. The base64 data URL this replaced was
      // 1–3MB of text in an href — iOS Chrome dropped it silently, and Safari
      // asked for download permission and then failed on it.
      const blob = await toBlob(ref.current, options);
      if (!blob) throw new Error('capture produced no image');

      const filename = `certificate-${data.nickname.replace(/\s+/g, '_')}.png`;

      // iPhone/iPad: anchor downloads are second-class there; the share sheet
      // is the path Apple actually supports, and it offers "Save Image".
      if (isIOS && typeof navigator.canShare === 'function') {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file] });
            return;
          } catch (err) {
            // Cancelling the sheet is a choice, not a failure.
            if (err instanceof DOMException && err.name === 'AbortError') return;
            // Anything else: fall through to the anchor download below.
          }
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      // In the document before the click — Safari can ignore detached anchors.
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke late: Safari starts the download after the permission prompt,
      // and revoking immediately yanks the URL out from under it.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
