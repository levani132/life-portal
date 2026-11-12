'use client';
import {
  MAX_IMAGE_EDGE,
  type MediaKind,
  type MediaUploadRequest,
  type MediaUploadTicket,
  type SignedUpload,
} from '@life-portal/shared-types';
import { fitWithin } from '@life-portal/shared-domain';
import { api } from './api';

/** A photo or video ready to upload: re-encoded, measured, and with a local preview. */
export interface PreparedMedia {
  kind: MediaKind;
  blob: Blob;
  width: number;
  height: number;
  durationMs?: number;
  poster?: Blob;
  /** An object URL for the composer's thumbnail. Revoke it when the item goes. */
  previewUrl: string;
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // `from-image` applies the EXIF rotation, so the pixels come out the right way up.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Some browsers decode formats (HEIC on Safari) only through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo.'))),
      'image/jpeg',
      quality,
    ),
  );
}

/** Draws any image source into a JPEG no larger than `maxEdge` on its long side. */
async function drawJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge: number,
  mirror = false,
) {
  const size = fitWithin(width, height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare photos.');
  if (mirror) {
    context.translate(size.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, 0, 0, size.width, size.height);
  return { blob: await toJpeg(canvas, 0.85), ...size };
}

/**
 * Re-encodes a photo on the device: resized to 2048 px and saved as a fresh JPEG. Drawing to a
 * canvas keeps only the pixels, which is what strips the location and camera details (EXIF).
 */
export async function prepareImage(file: Blob): Promise<PreparedMedia> {
  const image = await decode(file);
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  const result = await drawJpeg(image, width, height, MAX_IMAGE_EDGE);
  if ('close' in image) image.close();
  return { kind: 'image', ...result, previewUrl: URL.createObjectURL(result.blob) };
}

/** A profile photo's edge. Small enough to sit beside every post in a feed. */
const AVATAR_EDGE = 512;

/**
 * Re-encodes a profile photo: the centre square, at most 512 px. Re-drawing strips EXIF the same
 * way `prepareImage` does, so the location never reaches storage.
 */
export async function prepareAvatar(file: Blob): Promise<PreparedMedia> {
  const image = await decode(file);
  const width = 'naturalWidth' in image ? image.naturalWidth : image.width;
  const height = 'naturalHeight' in image ? image.naturalHeight : image.height;
  const side = Math.min(width, height);
  const edge = Math.max(1, Math.min(AVATAR_EDGE, side));
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare photos.');
  context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, edge, edge);
  if ('close' in image) image.close();
  const blob = await toJpeg(canvas, 0.88);
  return { kind: 'image', blob, width: edge, height: edge, previewUrl: URL.createObjectURL(blob) };
}

/** A photo taken from the live camera preview. The front camera is mirrored, like a mirror. */
export async function captureFrame(video: HTMLVideoElement, mirror: boolean) {
  const result = await drawJpeg(
    video,
    video.videoWidth,
    video.videoHeight,
    MAX_IMAGE_EDGE,
    mirror,
  );
  return {
    kind: 'image' as const,
    ...result,
    previewUrl: URL.createObjectURL(result.blob),
  };
}

/**
 * A recorded clip with its still. The duration comes from the recorder's own clock: a WebM
 * from MediaRecorder reports `Infinity` until it has been played to the end.
 */
export async function prepareVideo(blob: Blob, durationMs: number): Promise<PreparedMedia> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Could not read the video.'));
  });
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
    video.currentTime = Math.min(0.1, durationMs / 2000);
    setTimeout(resolve, 1500);
  });
  const poster = await drawJpeg(video, video.videoWidth, video.videoHeight, 1080);
  return {
    kind: 'video',
    blob,
    width: video.videoWidth || poster.width,
    height: video.videoHeight || poster.height,
    durationMs: Math.round(durationMs),
    poster: poster.blob,
    previewUrl: url,
  };
}

/** The recording type this browser supports, best first. Safari records MP4, Chrome WebM. */
export function recorderType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return [
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((type) => MediaRecorder.isTypeSupported(type));
}

function put(
  target: SignedUpload,
  body: Blob,
  contentType: string,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // XHR rather than fetch: only XHR reports upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target.url);
    for (const [name, value] of Object.entries(target.headers))
      xhr.setRequestHeader(name, name === 'content-type' ? contentType : value);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status}).`));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled.', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** The type sent to storage. The recorder's codec suffix is not part of it. */
function baseType(blob: Blob, kind: MediaKind): string {
  if (kind === 'image') return 'image/jpeg';
  const type = blob.type.split(';')[0];
  return type === 'video/webm' || type === 'video/quicktime' ? type : 'video/mp4';
}

/** Uploads straight to storage and returns the upload's id for the post. */
export async function uploadMedia(
  item: PreparedMedia,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<string> {
  const contentType = baseType(item.blob, item.kind);
  const request: MediaUploadRequest = {
    kind: item.kind,
    contentType,
    bytes: item.blob.size,
    width: item.width,
    height: item.height,
    ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}),
    ...(item.poster ? { poster: { bytes: item.poster.size } } : {}),
  };
  const ticket = await api.post<MediaUploadTicket>('/media', request);
  const total = item.blob.size + (item.poster?.size ?? 0);
  let posterDone = 0;
  if (item.poster && ticket.poster) {
    await put(ticket.poster, item.poster, 'image/jpeg', () => undefined, signal);
    posterDone = item.poster.size;
    onProgress(posterDone / total);
  }
  await put(
    ticket.upload,
    item.blob,
    contentType,
    (loaded) => onProgress((posterDone + loaded) / total),
    signal,
  );
  onProgress(1);
  return ticket.id;
}
