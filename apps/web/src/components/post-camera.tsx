'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Images, RefreshCw } from 'lucide-react';
import { MAX_VIDEO_SECONDS } from '@life-portal/shared-types';
import {
  captureFrame,
  prepareImage,
  prepareVideo,
  recorderType,
  type PreparedMedia,
} from '../lib/media';
import {
  acquireCamera,
  acquireMicrophone,
  muteMicrophone,
  releaseCamera,
} from '../lib/camera-stream';

/** Holding the shutter this long starts a video instead of taking a photo. */
const HOLD_MS = 300;
const RING = 2 * Math.PI * 38;

/**
 * The live camera, sized by its parent (the bottom of the new post page). Tap the shutter for a
 * photo, hold it to record (up to 30 seconds, with a ring filling around the button), release
 * to stop. The camera runs only while `active` (one stream per session, see `camera-stream.ts`).
 * The microphone is asked for right after the camera, so the first video starts when held
 * instead of stopping for a permission prompt.
 */
export function CameraView({
  active,
  onCapture,
  onLibrary,
  top,
  disabled,
}: {
  active: boolean;
  onCapture: (media: PreparedMedia) => void;
  /** Opens the photo library. */
  onLibrary?: () => void;
  /** Controls drawn over the top of the preview (the drag handle, close…). */
  top?: ReactNode;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const microphone = useRef<MediaStreamTrack | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const holdTimer = useRef<number>(0);
  const holding = useRef(false);
  const startedAt = useRef(0);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [failed, setFailed] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const fallback = useRef<HTMLInputElement>(null);
  const canRecord = !!recorderType();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed('This browser cannot open the camera here.');
      return;
    }
    void acquireCamera(facing)
      .then(async (media) => {
        if (cancelled) return;
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setFailed(null);
        // Asked now, right after the camera, so the first hold of the shutter records instead of
        // stopping for a prompt. Muted until a recording starts (that turns iOS's indicator off).
        if (canRecord && !microphone.current) {
          const track = await acquireMicrophone();
          if (!recorder.current) muteMicrophone();
          if (!cancelled) microphone.current = track;
        }
      })
      .catch(() => {
        if (!cancelled) setFailed('Camera access was not allowed.');
      });
    return () => {
      cancelled = true;
      recorder.current?.stop();
      stream.current = null;
      // Paused, not stopped: a fresh request would make iOS ask for permission again.
      releaseCamera();
    };
  }, [active, facing]);

  // The ring and the 30-second stop.
  useEffect(() => {
    if (!recording) return;
    let frame = 0;
    const tick = () => {
      const ms = performance.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= MAX_VIDEO_SECONDS * 1000) recorder.current?.stop();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recording]);

  async function takePhoto() {
    if (!video.current || !video.current.videoWidth || busy) return;
    setBusy(true);
    try {
      onCapture(await captureFrame(video.current, facing === 'user'));
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    const type = recorderType();
    if (!stream.current || !type) return;
    // Normally granted when the camera opened; asked here only if that has not finished yet.
    // A clip without sound beats no clip.
    microphone.current = await acquireMicrophone();
    // The finger may have lifted while the microphone prompt was up.
    if (!holding.current || !stream.current) return;
    const tracks = [
      ...stream.current.getVideoTracks(),
      ...(microphone.current ? [microphone.current] : []),
    ];
    const chunks: Blob[] = [];
    const next = new MediaRecorder(new MediaStream(tracks), {
      mimeType: type,
      videoBitsPerSecond: 2_500_000,
    });
    next.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    next.onstop = () => {
      const duration = Math.min(
        performance.now() - startedAt.current,
        MAX_VIDEO_SECONDS * 1000,
      );
      setRecording(false);
      recorder.current = null;
      muteMicrophone();
      if (duration < 500 || !chunks.length) return;
      setBusy(true);
      void prepareVideo(new Blob(chunks, { type: next.mimeType || type }), duration)
        .then(onCapture)
        .catch(() => setFailed('Could not save the video.'))
        .finally(() => setBusy(false));
    };
    recorder.current = next;
    startedAt.current = performance.now();
    setElapsed(0);
    next.start(1000);
    setRecording(true);
    navigator.vibrate?.(15);
  }

  function pressStart(event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (busy || disabled) return;
    holding.current = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    window.clearTimeout(holdTimer.current);
    holdTimer.current = canRecord
      ? window.setTimeout(() => {
          holdTimer.current = 0;
          void startRecording();
        }, HOLD_MS)
      : 0;
  }
  function pressEnd(event: React.PointerEvent) {
    event.stopPropagation();
    const wasHolding = holding.current;
    holding.current = false;
    if (recorder.current) {
      recorder.current.stop();
      return;
    }
    if (wasHolding && (holdTimer.current || !canRecord)) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = 0;
      void takePhoto();
    }
  }

  const progress = Math.min(1, elapsed / (MAX_VIDEO_SECONDS * 1000));
  return (
    <div className="relative h-full w-full overflow-hidden bg-black text-white" data-no-tab-swipe>
      <video
        ref={video}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`}
      />
      {top}
      {recording && (
        <span className="absolute left-1/2 top-10 -translate-x-1/2 rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold tabular-nums">
          0:{String(Math.floor(elapsed / 1000)).padStart(2, '0')}
        </span>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-white/80">{failed}</p>
          <button
            type="button"
            className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
            onClick={() => fallback.current?.click()}
          >
            Take a photo instead
          </button>
          {/* The system camera, for photos only: a system video's length is unknown. */}
          <input
            ref={fallback}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void prepareImage(file).then(onCapture);
            }}
          />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-around px-6 pb-4 pt-6">
        <button
          type="button"
          aria-label="Add photos from library"
          disabled={!onLibrary || recording}
          onClick={onLibrary}
          onPointerDown={(event) => event.stopPropagation()}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur disabled:opacity-30"
        >
          <Images size={21} />
        </button>
        <button
          type="button"
          aria-label={canRecord ? 'Shutter: tap for a photo, hold to record' : 'Take photo'}
          disabled={!!failed || busy || disabled}
          onPointerDown={pressStart}
          onPointerUp={pressEnd}
          onPointerCancel={pressEnd}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              void takePhoto();
            }
          }}
          className="relative flex h-[76px] w-[76px] touch-none select-none items-center justify-center disabled:opacity-40"
        >
          <svg viewBox="0 0 84 84" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="42" cy="42" r="38" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="5" />
            {recording && (
              <circle
                cx="42"
                cy="42"
                r="38"
                fill="none"
                stroke="#f43f5e"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - progress)}
              />
            )}
          </svg>
          <span
            className={`block rounded-full transition-all duration-200 ${recording ? 'h-7 w-7 rounded-lg bg-rose-500' : 'h-[60px] w-[60px] bg-white'}`}
          />
        </button>
        <button
          type="button"
          aria-label="Switch camera"
          disabled={recording}
          onPointerDown={(event) => event.stopPropagation()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur disabled:opacity-30"
          onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
        >
          <RefreshCw size={20} />
        </button>
      </div>
    </div>
  );
}
