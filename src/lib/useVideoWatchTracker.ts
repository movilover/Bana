import { useEffect, useRef } from 'react';
import { useAuth } from '@/src/contexts/AuthContext';
import { markSeen, recordVideoView, contentKeyFor, type VideoRef } from '@/src/lib/videoDistribution';

/**
 * Measures REAL playback time (video actually playing, tab visible, slide active) and reports one event when the video
 * stops being active. Time is accumulated from wall-clock ticks only while playing, so seeking/scrubbing cannot inflate it.
 * Loops accumulate naturally (rewatch). The server rules cap watchMs at 4x duration and dedupe per viewer/day.
 */
export function useVideoWatchTracker(opts: {
  video: VideoRef;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isActive: boolean;
  fallbackDurationSec?: number;
}) {
  const { firebaseUser } = useAuth();
  const { video, videoRef, isActive, fallbackDurationSec } = opts;
  const acc = useRef(0);
  const last = useRef(0);
  const seenMarked = useRef(false);

  useEffect(() => {
    if (!isActive) return;
    acc.current = 0;
    last.current = Date.now();
    seenMarked.current = false;
    const tick = window.setInterval(() => {
      const now = Date.now();
      const el = videoRef.current;
      const delta = Math.min(now - last.current, 1000);
      last.current = now;
      if (el && !el.paused && !el.ended && !document.hidden) acc.current += delta;
      if (!seenMarked.current && acc.current >= 1500) {
        seenMarked.current = true;
        markSeen(contentKeyFor(video.type, video.id));
      }
    }, 500);

    const flush = () => {
      window.clearInterval(tick);
      const el = videoRef.current;
      const durSec = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : fallbackDurationSec || 0;
      const watched = acc.current;
      acc.current = 0;
      if (firebaseUser && watched > 0 && durSec > 0) void recordVideoView(firebaseUser.uid, video, watched, durSec * 1000);
    };
    return flush;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, video.id, firebaseUser?.uid]);
}
