// Stored ZIP entries avoid recompressing already-compressed GIF/WebP images.
// Blob parts retain the outputs without loading every animation into RAM at once.
const table = new Uint32Array(256).map((_, n) => {
  let value = n;
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const value of bytes) crc = table[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function outputName(name: string, extension: string) {
  return `${name.replace(/\.glb$/i, '').replace(/[\\/<>:"|?*\x00-\x1f]/g, '_').slice(0, 120) || 'turntable'}.${extension}`;
}
export async function makeBatchZip(entries: { name: string; blob: Blob }[], signal: AbortSignal): Promise<Blob> {
  if (!entries.length) throw new Error('There are no completed exports to download.');
  if (entries.length > 65535) throw new Error('Please download a smaller batch.');
  const files: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    signal.throwIfAborted();
    const entry = entries[i];
    const name = new TextEncoder().encode(`${String(i + 1).padStart(3, '0')}-${entry.name}`);
    const crc = crc32(new Uint8Array(await entry.blob.arrayBuffer()));
    signal.throwIfAborted();
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); view.setUint16(6, 0x800, true);
    view.setUint16(12, 33, true); // 1980-01-01, valid DOS date
    view.setUint32(14, crc, true);
    view.setUint32(18, entry.blob.size, true); view.setUint32(22, entry.blob.size, true);
    view.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const header = new DataView(central.buffer);
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true); header.setUint16(6, 20, true); header.setUint16(8, 0x800, true);
    header.setUint16(14, 33, true); header.setUint32(16, crc, true);
    header.setUint32(20, entry.blob.size, true); header.setUint32(24, entry.blob.size, true);
    header.setUint16(28, name.length, true); header.setUint32(42, offset, true);
    central.set(name, 46);
    files.push(local, entry.blob); directory.push(central);
    offset += local.length + entry.blob.size;
    if (offset > 0xffffffff) throw new Error('This ZIP is too large. Download the completed files individually.');
  }
  const directorySize = directory.reduce((sum, item) => sum + item.length, 0);
  if (offset + directorySize + 22 > 0xffffffff) throw new Error('This ZIP is too large. Download the completed files individually.');
  const end = new Uint8Array(22);
  const header = new DataView(end.buffer);
  header.setUint32(0, 0x06054b50, true);
  header.setUint16(8, entries.length, true); header.setUint16(10, entries.length, true);
  header.setUint32(12, directorySize, true); header.setUint32(16, offset, true);
  return new Blob([...files, ...directory, end], { type: 'application/zip' });
}
