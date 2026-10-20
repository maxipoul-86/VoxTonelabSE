import { describe, expect, it } from 'vitest';
import { crc32, makeZip } from './zip';

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  it('writes stored files with a central directory', () => {
    const data = new TextEncoder().encode('Write-Host hi\r\n');
    const zip = makeZip([{ name: 'Tonelab bridge/a.ps1', data }], new Date(2026, 9, 19, 12, 0, 0));
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint32(14, true)).toBe(crc32(data));
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(1);
    const dirAt = v.getUint32(end + 16, true);
    expect(v.getUint32(dirAt, true)).toBe(0x02014b50);
    expect(new TextDecoder().decode(zip.subarray(30, 30 + 20))).toBe('Tonelab bridge/a.ps1');
  });
});
