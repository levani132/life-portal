/**
 * One camera (and microphone) stream for the whole session.
 *
 * iOS asks for camera permission again on every `getUserMedia` call once no capture is live —
 * in the installed app that meant a prompt each time the new post page opened. So the stream is
 * kept: putting the camera away *disables* its tracks (iOS turns the camera and its indicator off
 * for disabled tracks) and only a long idle stops them for good. Flipping cameras asks for the
 * new one while the old is still live, which iOS answers without a prompt.
 */
type Facing = 'environment' | 'user';

/** After this long unused the camera is really stopped; the next open may prompt again. */
const IDLE_STOP_MS = 10 * 60 * 1000;

let video: { stream: MediaStream; facing: Facing } | null = null;
let microphone: MediaStreamTrack | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

const live = (stream: MediaStream) =>
  stream.getVideoTracks().some((track) => track.readyState === 'live');

function stopAll() {
  video?.stream.getTracks().forEach((track) => track.stop());
  video = null;
  microphone?.stop();
  microphone = null;
}

/** The camera facing this way, live and enabled. */
export async function acquireCamera(facing: Facing): Promise<MediaStream> {
  clearTimeout(idleTimer);
  if (video && video.facing === facing && live(video.stream)) {
    video.stream.getTracks().forEach((track) => (track.enabled = true));
    return video.stream;
  }
  const previous = video;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  // Stopped only now, so the new request was made while a capture was still running.
  previous?.stream.getTracks().forEach((track) => track.stop());
  video = { stream, facing };
  return stream;
}

/** The camera is out of sight: pause it, and stop it if it stays unused. */
export function releaseCamera() {
  video?.stream.getTracks().forEach((track) => (track.enabled = false));
  if (microphone) microphone.enabled = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stopAll, IDLE_STOP_MS);
}

/** The microphone for a recording, asked for once per session. Null when it was refused. */
export async function acquireMicrophone(): Promise<MediaStreamTrack | null> {
  if (microphone?.readyState === 'live') {
    microphone.enabled = true;
    return microphone;
  }
  microphone = await navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((media) => media.getAudioTracks()[0] ?? null)
    .catch(() => null);
  return microphone;
}

/** Between recordings the microphone is muted, which turns iOS's indicator off. */
export function muteMicrophone() {
  if (microphone) microphone.enabled = false;
}
