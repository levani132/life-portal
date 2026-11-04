'use client';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { MAX_VIDEO_SECONDS } from '@life-portal/shared-types';
import {
  captureFrame,
  prepareImage,
  prepareVideo,
  recorderType,
  type PreparedMedia,
} from '../lib/media';

/** Holding the shutter this long starts a video instead of taking a photo. */
const HOLD_MS = 300;
const RING = 2 * Math.PI * 38;

/**
 * The in-app camera. Tap the shutter for a photo, hold it to record (up to 30 seconds, with a
 * ring filling around the button), release to stop. Video only comes from here: a recording
 * made in the app is short and known, a library video is neither.
 */
export function PostCamera({
  onCapture,
  onClose,
}: {
  onCapture: (media: PreparedMedia) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const holdTimer = useRef<number>(0);
  const startedAt = useRef(0);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [failed, setFailed] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const fallback = useRef<HTMLInputElement>(null);
  const canRecord = !!recorderType();

  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed('This browser cannot open the camera here.');
      return;
    }
    const open = async () => {
      try {
        const media = await navigator.mediaDevices
          .getUserMedia({
            video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: canRecord,
          })
          // A camera without a microphone still takes photos and silent clips.
          .catch(() =>
            navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false }),
          );
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setFailed(null);
      } catch {
        if (!cancelled) setFailed('Camera access was not allowed.');
      }
    };
    void open();
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, [facing, canRecord]);

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
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function startRecording() {
    const type = recorderType();
    if (!stream.current || !type) return;
    const chunks: Blob[] = [];
    const next = new MediaRecorder(stream.current, {
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
      if (duration < 500 || !chunks.length) return;
      setBusy(true);
      void prepareVideo(new Blob(chunks, { type: next.mimeType || type }), duration)
        .then((media) => {
          onCapture(media);
          onClose();
        })
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
    if (busy) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    window.clearTimeout(holdTimer.current);
    holdTimer.current = canRecord ? window.setTimeout(startRecording, HOLD_MS) : 0;
  }
  function pressEnd() {
    if (recorder.current) {
      recorder.current.stop();
      return;
    }
    if (holdTimer.current || !canRecord) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = 0;
      void takePhoto();
    }
  }

  const progress = Math.min(1, elapsed / (MAX_VIDEO_SECONDS * 1000));
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
      data-no-tab-swipe
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <button
          type="button"
          aria-label="Close camera"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
          onClick={() => {
            recorder.current?.stop();
            onClose();
          }}
        >
          <X size={22} />
        </button>
        {recording && (
          <span className="rounded-full bg-rose-500 px-3 py-1 text-xs font-semibold tabular-nums">
            0:{String(Math.floor(elapsed / 1000)).padStart(2, '0')}
          </span>
        )}
        <span className="h-10 w-10" />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={video}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`}
        />
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-sm text-white/80">{failed}</p>
            <button
              type="button"
              className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
              onClick={() => fallback.current?.click()}
            >
              Take a photo instead
            </button>
            {/* The system camera, for photos only: a library or system video is not allowed. */}
            <input
              ref={fallback}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void prepareImage(file).then((media) => {
                  onCapture(media);
                  onClose();
                });
              }}
            />
          </div>
        )}
      </div>
      <div className="flex items-center justify-around px-6 pb-3 pt-5">
        <span className="h-12 w-12" />
        <button
          type="button"
          aria-label={canRecord ? 'Shutter: tap for a photo, hold to record' : 'Take photo'}
          disabled={!!failed || busy}
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
          className="relative flex h-[84px] w-[84px] touch-none select-none items-center justify-center disabled:opacity-40"
        >
          <svg viewBox="0 0 84 84" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="42" cy="42" r="38" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="5" />
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
            className={`block rounded-full transition-all duration-200 ${recording ? 'h-8 w-8 rounded-lg bg-rose-500' : 'h-[66px] w-[66px] bg-white'}`}
          />
        </button>
        <button
          type="button"
          aria-label="Switch camera"
          disabled={recording}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 disabled:opacity-30"
          onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
        >
          <RefreshCw size={22} />
        </button>
      </div>
      <p className="pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-center text-[11px] text-white/60">
        {canRecord ? `Tap for a photo · hold to record up to ${MAX_VIDEO_SECONDS}s` : 'Tap for a photo'}
      </p>
    </div>
  );
}
