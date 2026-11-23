import { cleanJpeg } from './jpeg';

const segment = (marker: number, data: number[]) => [0xff, marker, ((data.length + 2) >> 8) & 0xff, (data.length + 2) & 0xff, ...data];
const text = (value: string) => [...value].map((char) => char.charCodeAt(0));
const SOI = [0xff, 0xd8];
const jfif = segment(0xe0, [...text('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
/** A frame header: precision, height 480, width 640, one component. */
const frame = segment(0xc0, [8, 0x01, 0xe0, 0x02, 0x80, 1, 1, 0x11, 0]);
const scan = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9];
const exif = segment(0xe1, [...text('Exif\0\0'), 0x4d, 0x4d, 0, 42, 9, 9, 9]);
const xmp = segment(0xe1, text('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'));
const icc = segment(0xe2, [...text('ICC_PROFILE\0'), 1, 1, 7, 7]);
const flashpix = segment(0xe2, text('FPXR\0'));
const iptc = segment(0xed, text('Photoshop 3.0\0'));
const adobe = segment(0xee, [...text('Adobe'), 0, 100, 0, 0, 0, 0, 1]);
const comment = segment(0xfe, text('Shot at home'));

const file = (...parts: number[][]) => new Uint8Array(parts.flat());

describe('cleanJpeg (spec 041)', () => {
  it('reads the size and leaves a clean file untouched', () => {
    const clean = file(SOI, jfif, frame, scan);
    const result = cleanJpeg(clean);
    expect(result).toMatchObject({ width: 640, height: 480, changed: false });
    expect(result?.bytes).toBe(clean);
  });

  it('drops Exif, XMP, IPTC, comments and other app data, and keeps what decides the colours', () => {
    const result = cleanJpeg(file(SOI, jfif, exif, xmp, icc, flashpix, iptc, adobe, comment, frame, scan));
    expect(result).toMatchObject({ width: 640, height: 480, changed: true });
    expect([...(result?.bytes ?? [])]).toEqual([...file(SOI, jfif, icc, adobe, frame, scan)]);
    const kept = String.fromCharCode(...(result?.bytes ?? []));
    for (const gone of ['Exif', 'xmpmeta', 'Photoshop', 'Shot at home', 'FPXR']) expect(kept).not.toContain(gone);
  });

  it('leaves the image data alone, even where it looks like a marker', () => {
    const data = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 0xff, 0x00, 0xff, 0xe1, 0x00, 0x08, ...text('Exif\0\0'), 0xff, 0xd9];
    const result = cleanJpeg(file(SOI, exif, frame, data));
    expect([...(result?.bytes ?? [])]).toEqual([...file(SOI, frame, data)]);
  });

  it('tolerates fill bytes before a marker', () => {
    expect(cleanJpeg(file(SOI, [0xff, 0xff], jfif, frame, scan))).toMatchObject({ width: 640, height: 480 });
  });

  it('refuses what is not a whole JPEG header', () => {
    expect(cleanJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull(); // a PNG
    expect(cleanJpeg(file(SOI))).toBeNull();
    expect(cleanJpeg(file(SOI, jfif, scan))).toBeNull(); // no frame, so no size
    expect(cleanJpeg(file(SOI, jfif, frame))).toBeNull(); // no image data
    expect(cleanJpeg(file(SOI, [0xff, 0xe1, 0xff, 0xff, 1, 2]))).toBeNull(); // a length past the end
    expect(cleanJpeg(file(SOI, [0x00, 0x01], frame, scan))).toBeNull(); // junk where a marker belongs
    expect(cleanJpeg(new Uint8Array())).toBeNull();
  });
});
