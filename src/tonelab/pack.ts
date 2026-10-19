// NOTE 8 "DUMP DATA CONVERSION": every 7 bytes of 8-bit data travel as 8 MIDI bytes.
// The first MIDI byte of each set carries the top bit (b7) of the next seven data bytes:
// bit 0 = b7 of byte 7n+0 ... bit 6 = b7 of byte 7n+6. A final partial set of k bytes
// becomes 1 + k MIDI bytes.

export function packedLength(dataLength: number): number {
  const full = Math.floor(dataLength / 7);
  const rest = dataLength % 7;
  return full * 8 + (rest ? rest + 1 : 0);
}

export function unpackedLength(midiLength: number): number {
  const full = Math.floor(midiLength / 8);
  const rest = midiLength % 8;
  return full * 7 + (rest ? rest - 1 : 0);
}

/** 8-bit data -> 7-bit MIDI data. */
export function pack7(data: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(packedLength(data.length));
  let o = 0;
  for (let i = 0; i < data.length; i += 7) {
    const n = Math.min(7, data.length - i);
    let msbs = 0;
    for (let j = 0; j < n; j++) msbs |= ((data[i + j] >> 7) & 1) << j;
    out[o++] = msbs;
    for (let j = 0; j < n; j++) out[o++] = data[i + j] & 0x7f;
  }
  return out;
}

/** 7-bit MIDI data -> 8-bit data. */
export function unpack7(midi: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(unpackedLength(midi.length));
  let o = 0;
  for (let i = 0; i < midi.length; i += 8) {
    const n = Math.min(8, midi.length - i) - 1;
    const msbs = midi[i];
    for (let j = 0; j < n; j++) out[o++] = (midi[i + 1 + j] & 0x7f) | (((msbs >> j) & 1) << 7);
  }
  return out;
}
