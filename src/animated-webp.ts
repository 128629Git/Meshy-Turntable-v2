// Assemble browser-encoded still WebP frames using the WebP RIFF specification:
// https://developers.google.com/speed/webp/docs/riff_container
const ascii = (text: string) => new TextEncoder().encode(text);
const fourCC = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));

function uint24(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
}

function chunk(name: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(8 + data.length + (data.length % 2));
  result.set(ascii(name));
  new DataView(result.buffer).setUint32(4, data.length, true);
  result.set(data, 8);
  return result;
}

export class AnimatedWebP {
  private frames: Uint8Array<ArrayBuffer>[] = [];
  private hasAlpha = false;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 16383)) {
      throw new Error("Invalid WebP image dimensions.");
    }
    this.width = width;
    this.height = height;
  }

  async addFrame(blob: Blob, durationMs: number) {
    if (blob.type !== "image/webp") {
      throw new Error("This browser cannot export WebP. Please choose Classic GIF or try Chrome, Edge, or Firefox.");
    }
    if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 0xffffff) {
      throw new Error("Invalid WebP frame duration.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 20 || fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WEBP") {
      throw new Error("The browser returned an invalid WebP frame.");
    }
    const view = new DataView(bytes.buffer);
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error("Incomplete WebP frame.");
    const imageChunks: Uint8Array[] = [];
    let images = 0;
    let alpha = false;
    let width = 0;
    let height = 0;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const name = fourCC(bytes, offset);
      const length = view.getUint32(offset + 4, true);
      const end = offset + 8 + length + (length % 2);
      if (end > bytes.length) throw new Error("Incomplete WebP image data.");
      const data = offset + 8;
      if (name === "ANIM" || name === "ANMF") throw new Error("Expected a still WebP frame.");
      if (name === "ALPH") {
        if (images || alpha) throw new Error("Invalid WebP alpha data.");
        alpha = true;
        imageChunks.push(bytes.subarray(offset, end));
      }
      if (name === "VP8 " || name === "VP8L") {
        images++;
        if (name === "VP8 ") {
          if (length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 1 || bytes[data + 5] !== 0x2a) {
            throw new Error("Invalid WebP color data.");
          }
          width = view.getUint16(data + 6, true) & 0x3fff;
          height = view.getUint16(data + 8, true) & 0x3fff;
        } else {
          if (length < 5 || bytes[data] !== 0x2f || alpha) throw new Error("Invalid lossless WebP frame.");
          const bits = view.getUint32(data + 1, true);
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
          alpha = !!(bits & (1 << 28));
        }
        imageChunks.push(bytes.subarray(offset, end));
      }
      offset = end;
    }
    if (offset !== bytes.length || images !== 1 || width !== this.width || height !== this.height) {
      throw new Error("WebP frame dimensions or image data did not match the export.");
    }
    const data = new Uint8Array(16 + imageChunks.reduce((sum, item) => sum + item.length, 0));
    uint24(data, 6, this.width - 1);
    uint24(data, 9, this.height - 1);
    uint24(data, 12, durationMs);
    // Full-frame replacement (no blending) prevents transparent motion trails.
    data[15] = 2;
    let position = 16;
    for (const item of imageChunks) {
      data.set(item, position);
      position += item.length;
    }
    this.frames.push(chunk("ANMF", data));
    this.hasAlpha ||= alpha;
  }

  finish(): Blob {
    if (!this.frames.length) throw new Error("No frames were captured.");
    const extended = new Uint8Array(10);
    extended[0] = 2 | (this.hasAlpha ? 16 : 0);
    uint24(extended, 4, this.width - 1);
    uint24(extended, 7, this.height - 1);
    // Transparent canvas, infinite loop. Each frame overwrites the entire canvas.
    const parts = [chunk("VP8X", extended), chunk("ANIM", new Uint8Array(6)), ...this.frames];
    const length = 4 + parts.reduce((sum, part) => sum + part.length, 0);
    if (length > 0xfffffff6) throw new Error("This animation is too large. Try a smaller export size.");
    const header = new Uint8Array(12);
    header.set(ascii("RIFF"));
    new DataView(header.buffer).setUint32(4, length, true);
    header.set(ascii("WEBP"), 8);
    return new Blob([header, ...parts], { type: "image/webp" });
  }
}

export function captureWebP(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // High-quality full-color RGB and native alpha; no GIF color key or palette.
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== "image/webp") {
        reject(new Error("WebP export is unavailable in this browser. Choose Classic GIF or try Chrome, Edge, or Firefox."));
      } else resolve(blob);
    }, "image/webp", 0.98);
  });
}
