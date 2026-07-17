import { useEffect } from 'react';
import { playMusic, stopMusic, type TrackId } from './music';

/**
 * Plays a background track for as long as this screen is mounted.
 * Pass null for screens that should be silent.
 *
 * Deliberately does NOT stop on unmount: navigating avatar-select → mode-select
 * would otherwise cut the menu track and restart it mid-phrase. Switching to a
 * different track (or to null) stops the previous one, which is the only case
 * where a cut is actually wanted.
 */
export function useMusic(id: TrackId | null) {
  useEffect(() => {
    if (id) playMusic(id);
    else stopMusic();
  }, [id]);
}
