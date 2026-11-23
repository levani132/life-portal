/**
 * Reading and cleaning a JPEG without an image library (spec 041).
 *
 * A photo taken by the app is re-encoded in the browser, which drops everything a camera writes
 * into the file. A picture an assistant uploads never passes through a browser, so the server
 * does the dropping: it walks the file's segments and removes the ones that can describe a
 * person or a place (Exif with its GPS, XMP, IPTC, comments, maker notes), keeping what decides
 * how the picture looks (the JFIF header, the colour profile, Adobe's colour marker).
 */

export interface CleanJpeg {
  width: number;
  height: number;
  /** The file without its descriptive metadata. The same bytes when there was nothing to drop. */
  bytes: Uint8Array;
  /** Whether anything was removed. */
  changed: boolean;
}

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP2 = 0xe2;
const APP14 = 0xee;
const COM = 0xfe;

const isApp = (marker: number) => marker >= 0xe0 && marker <= 0xef;
/** Start-of-frame markers carry the size. C4 (Huffman), C8 and CC are not frames. */
const isFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

const startsWith = (bytes: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/**
 * The picture's size and a copy without descriptive metadata, or `null` when the bytes are not
 * a well-formed JPEG up to the start of its image data.
 */
export function cleanJpeg(bytes: Uint8Array): CleanJpeg | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  let width = 0;
  let height = 0;
  let changed = false;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    // Fill bytes before a marker are allowed.
    while (bytes[at + 1] === 0xff) at++;
    const marker = bytes[at + 1];
    if (marker === undefined || marker === 0x00 || marker === SOI) return null;
    if (marker === EOI) return null; // ended before any image data
    if (marker === SOS) {
      // Image data runs to the end of the file; nothing after this point is a metadata segment.
      if (!width || !height) return null;
      kept.push(bytes.subarray(at));
      const length = kept.reduce((sum, part) => sum + part.length, 0);
      if (!changed) return { width, height, bytes, changed: false };
      const out = new Uint8Array(length);
      let offset = 0;
      for (const part of kept) {
        out.set(part, offset);
        offset += part.length;
      }
      return { width, height, bytes: out, changed: true };
    }
    if (at + 4 > bytes.length) return null;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    if (isFrame(marker)) {
      if (length < 7) return null;
      height = (bytes[at + 5] << 8) | bytes[at + 6];
      width = (bytes[at + 7] << 8) | bytes[at + 8];
    }
    const data = at + 4;
    const keep =
      marker === COM
        ? false
        : !isApp(marker) ||
          (marker === APP0 && (startsWith(bytes, data, 'JFIF\0') || startsWith(bytes, data, 'JFXX\0'))) ||
          (marker === APP2 && startsWith(bytes, data, 'ICC_PROFILE\0')) ||
          (marker === APP14 && startsWith(bytes, data, 'Adobe'));
    if (keep) kept.push(bytes.subarray(at, end));
    else changed = true;
    at = end;
  }
  return null;
}
