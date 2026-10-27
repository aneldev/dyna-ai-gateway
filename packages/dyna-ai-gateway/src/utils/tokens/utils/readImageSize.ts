/** Width and height of an image, read from its header bytes. */
export interface IImageSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SOI = [0xff, 0xd8];
/** JPEG markers that carry no frame size: the Huffman and arithmetic tables, the restart interval and the standalone restart markers. */
const JPEG_NON_FRAME_MARKERS = new Set([0xc4, 0xc8, 0xcc, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xdd]);

/**
 * Reads the pixel size from a PNG, JPEG, GIF or WebP header; undefined for anything else or a truncated file.
 * Only the header is parsed, never the pixels.
 */
export const readImageSize = (bytes: Uint8Array): IImageSize | undefined => {
  if (startsWith(bytes, PNG_SIGNATURE)) return readPng(bytes);
  if (startsWith(bytes, JPEG_SOI)) return readJpeg(bytes);
  if (ascii(bytes, 0, 3) === "GIF") return readGif(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return readWebp(bytes);
  return undefined;
};

/** IHDR: width and height as big-endian 32-bit integers right after the 8-byte signature and the 8-byte chunk header. */
const readPng = (bytes: Uint8Array): IImageSize | undefined => {
  if (bytes.length < 24) return undefined;
  return {
    width: be32(bytes, 16),
    height: be32(bytes, 20),
  };
};

/** Walks the segments to the first SOFn marker; its payload holds height then width as big-endian 16-bit integers. */
const readJpeg = (bytes: Uint8Array): IImageSize | undefined => {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];
    if (marker === undefined) return undefined;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && !JPEG_NON_FRAME_MARKERS.has(marker);
    if (isFrame) {
      return {
        height: be16(bytes, offset + 5),
        width: be16(bytes, offset + 7),
      };
    }
    offset += 2 + be16(bytes, offset + 2);
  }
  return undefined;
};

/** Logical screen width and height: little-endian 16-bit integers at offsets 6 and 8. */
const readGif = (bytes: Uint8Array): IImageSize | undefined => {
  if (bytes.length < 10) return undefined;
  return {
    width: le16(bytes, 6),
    height: le16(bytes, 8),
  };
};

/** Three WebP layouts: VP8 (lossy), VP8L (lossless, 14-bit fields) and VP8X (extended, 24-bit canvas size minus one). */
const readWebp = (bytes: Uint8Array): IImageSize | undefined => {
  if (bytes.length < 30) return undefined;
  const chunk = ascii(bytes, 12, 16);
  if (chunk === "VP8 ") {
    return {
      width: le16(bytes, 26) & 0x3fff,
      height: le16(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = le32(bytes, 21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X") {
    return {
      width: le24(bytes, 24) + 1,
      height: le24(bytes, 27) + 1,
    };
  }
  return undefined;
};

const startsWith = (bytes: Uint8Array, prefix: number[]): boolean => prefix.every((value, index) => bytes[index] === value);
const ascii = (bytes: Uint8Array, start: number, end: number): string => String.fromCharCode(...bytes.subarray(start, end));
const be16 = (bytes: Uint8Array, offset: number): number => ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
const be32 = (bytes: Uint8Array, offset: number): number => ((be16(bytes, offset) << 16) | be16(bytes, offset + 2)) >>> 0;
const le16 = (bytes: Uint8Array, offset: number): number => (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
const le24 = (bytes: Uint8Array, offset: number): number => le16(bytes, offset) | ((bytes[offset + 2] ?? 0) << 16);
const le32 = (bytes: Uint8Array, offset: number): number => (le16(bytes, offset) | (le16(bytes, offset + 2) << 16)) >>> 0;
