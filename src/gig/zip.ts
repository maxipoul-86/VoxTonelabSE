// A minimal ZIP writer (files stored, not compressed): enough for the few small bridge scripts.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(entries: ZipEntry[], date = new Date()): Uint8Array<ArrayBuffer> {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    // Shared by the local header (from byte 4) and the central directory entry (from byte 6).
    const common = (v: DataView, at: number) => {
      v.setUint16(at, 20, true); // version needed
      v.setUint16(at + 2, 0x0800, true); // UTF-8 names
      v.setUint16(at + 4, 0, true); // stored
      v.setUint16(at + 6, dosTime, true);
      v.setUint16(at + 8, dosDate, true);
      v.setUint32(at + 10, crc, true);
      v.setUint32(at + 14, e.data.length, true);
      v.setUint32(at + 18, e.data.length, true);
      v.setUint16(at + 22, name.length, true);
    };
    const head = new Uint8Array(30 + name.length);
    const hv = new DataView(head.buffer);
    hv.setUint32(0, 0x04034b50, true);
    common(hv, 4);
    head.set(name, 30);
    local.push(head, e.data);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true); // made by
    common(dv, 6);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);
    offset += head.length + e.data.length;
  }

  const dirSize = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
