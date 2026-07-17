import { useEffect, useState } from 'react';
import { SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { isMuted, toggleMuted, onMuteChange } from './audio';

/** Mutes music and sound effects together; the choice persists across sessions. */
export default function MusicToggle({ className = '' }: { className?: string }) {
  const [muted, setMuted] = useState(isMuted);

  useEffect(() => onMuteChange(setMuted), []);

  return (
    <button
      type="button"
      className={`music-toggle ${className}`.trim()}
      onClick={() => toggleMuted()}
      aria-pressed={muted}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      title={muted ? 'Unmute sound' : 'Mute sound'}
    >
      {muted
        ? <SpeakerSlash size={18} weight="fill" />
        : <SpeakerHigh size={18} weight="fill" />}
    </button>
  );
}
