'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { FeedMetricEvent, PostMedia } from '@life-portal/shared-types';
import { FEED_METRICS_CONFIG, clampAspect, videoMilestones } from '@life-portal/shared-domain';
import { usePostMetrics } from '../lib/feed-metrics';

/**
 * A post's photos and videos, swiped sideways. The first item sets the frame (between 4:5 and
 * 1.91:1, like Instagram) and the rest fit inside it. Videos play muted while on screen; a tap
 * turns the sound on. The carousel owns horizontal swipes, so it never changes tabs.
 */
export function PostMediaCarousel({
  media,
  className = 'sm:rounded-xl',
}: {
  media: PostMedia[];
  /** Rounding: none when the carousel is the top of a merged food card. */
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const first = media[0];
  const aspect = clampAspect(first.width, first.height);
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setIndex(Math.round(element.scrollLeft / Math.max(1, element.clientWidth))),
      );
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className={`relative overflow-hidden bg-black ${className}`} data-no-tab-swipe>
      <div
        ref={track}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        style={{ aspectRatio: String(aspect) }}
      >
        {media.map((item, position) => (
          <div key={item.id} className="relative h-full w-full shrink-0 snap-center">
            {item.kind === 'video' ? (
              <PostVideo
                item={item}
                active={position === index}
                muted={muted}
                onToggleSound={() => setMuted((value) => !value)}
              />
            ) : (
              <img
                src={item.url}
                alt={`Photo ${position + 1} of ${media.length}`}
                loading={position === 0 ? 'eager' : 'lazy'}
                decoding="async"
                className="h-full w-full object-cover"
              />
            )}
          </div>
        ))}
      </div>
      {media.length > 1 && (
        <>
          <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {index + 1}/{media.length}
          </span>
          <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1">
            {media.map((item, position) => (
              <span
                key={item.id}
                className={`h-1.5 w-1.5 rounded-full ${position === index ? 'bg-white' : 'bg-white/45'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PostVideo({
  item,
  active,
  muted,
  onToggleSound,
}: {
  item: PostMedia;
  active: boolean;
  muted: boolean;
  onToggleSound: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.intersectionRatio >= 0.6),
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (visible && active && !document.hidden) void element.play().catch(() => undefined);
    else element.pause();
  }, [visible, active]);
  useVideoMetrics(video, visible && active);
  return (
    <button
      type="button"
      className="relative block h-full w-full"
      aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      onClick={onToggleSound}
    >
      <video
        ref={video}
        src={item.url}
        poster={item.posterUrl}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
      <span className="absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
      </span>
    </button>
  );
}

/**
 * For You measurement (#11) for one video: a start, how far the first loop got (25/50/75/100%),
 * and a quick skip when it leaves the screen after less than 2 s of play. Only inside a measured
 * For You card; elsewhere `usePostMetrics()` is null and nothing is attached.
 */
function useVideoMetrics(video: RefObject<HTMLVideoElement | null>, onScreen: boolean) {
  const record = usePostMetrics();
  const state = useRef({ started: false, finished: false, skipped: false, maxTime: 0, sent: new Set<FeedMetricEvent>() });
  useEffect(() => {
    const element = video.current;
    if (!element || !record) return;
    const s = state.current;
    const send = (type: FeedMetricEvent) => {
      s.sent.add(type);
      record(type);
    };
    const onPlaying = () => {
      if (s.started) return;
      s.started = true;
      send('videoStart');
    };
    const onTime = () => {
      if (!s.started || s.finished || !element.duration) return;
      // A loop starting over means the first play reached the end.
      if (element.currentTime + 0.5 < s.maxTime) s.finished = true;
      s.maxTime = Math.max(s.maxTime, element.currentTime);
      const fraction = s.finished ? 1 : s.maxTime / element.duration;
      for (const type of videoMilestones(fraction, s.sent)) send(type);
    };
    element.addEventListener('playing', onPlaying);
    element.addEventListener('timeupdate', onTime);
    return () => {
      element.removeEventListener('playing', onPlaying);
      element.removeEventListener('timeupdate', onTime);
    };
  }, [video, record]);
  useEffect(() => {
    if (onScreen || !record) return;
    const s = state.current;
    if (s.started && !s.skipped && !s.sent.has('video100') && s.maxTime * 1000 < FEED_METRICS_CONFIG.quickSkipMs) {
      s.skipped = true;
      record('quickSkip');
    }
  }, [onScreen, record]);
}
