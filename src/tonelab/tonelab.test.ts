import { describe, expect, it } from 'vitest';
import { pack7, packedLength, unpack7 } from './pack';
import { SCALES, SPEED_TABLE_HZ } from './scales';
import * as sx from './sysex';
import { PROGRAM_SIZE, EFFECT_SLOTS, SLOT_KEYS, AMP_TYPES, CAB_TYPES } from './spec';
import { addressOf, blankProgram, controlFromAddress, getName, read, setName, write, type ControlRef } from './program';
import { applyRecipe, expTargetLabel, readRecipe, type PedalSettings } from './recipe';

describe('7-bit packing (NOTE 8)', () => {
  it('92 bytes pack to 106 (NOTE 1)', () => {
    expect(packedLength(PROGRAM_SIZE)).toBe(106);
    expect(pack7(new Uint8Array(PROGRAM_SIZE))).toHaveLength(106);
  });
  it('all-data and global sizes match the spec', () => {
    expect(packedLength(92 * 97 + 16)).toBe(10218); // NOTE 5
    expect(packedLength(16)).toBe(19); // NOTE 4
    expect(packedLength(92 * 96)).toBe(10094); // NOTE 3
  });
  it('round-trips arbitrary bytes and keeps every MIDI byte below 0x80', () => {
    const data = Uint8Array.from({ length: 92 }, (_, i) => (i * 37 + 200) & 0xff);
    const packed = pack7(data);
    expect(Array.from(packed).every((b) => b < 0x80)).toBe(true);
    expect(Array.from(unpack7(packed))).toEqual(Array.from(data));
  });
  it('puts the top bit of byte 7n+i in bit i of the first byte', () => {
    const data = Uint8Array.from([0x80, 0x00, 0x81, 0, 0, 0, 0xff]);
    const packed = pack7(data);
    expect(packed[0]).toBe(0b1000101);
    expect(Array.from(packed.subarray(1))).toEqual([0x00, 0x00, 0x01, 0, 0, 0, 0x7f]);
  });
});

describe('scales', () => {
  it('speed table matches the *4 anchors', () => {
    expect(SPEED_TABLE_HZ[0]).toBe(0.1);
    expect(SPEED_TABLE_HZ[9]).toBe(0.145);
    expect(SPEED_TABLE_HZ[0x18]).toBe(0.29);
    expect(SPEED_TABLE_HZ[0x27]).toBe(0.58);
    expect(SPEED_TABLE_HZ[0x2d]).toBe(0.8); // ROTARY minimum
    expect(SPEED_TABLE_HZ[0x32]).toBe(1.0); // U-VIBE / TEXTREM minimum
    expect(SPEED_TABLE_HZ[0x4a]).toBe(2.9);
    expect(SPEED_TABLE_HZ[0x59]).toBe(5.8);
    expect(SPEED_TABLE_HZ[0x63]).toBe(9.6);
    expect(SPEED_TABLE_HZ[0x64]).toBe(10);
    expect(SCALES.speedHz.toRaw(1.2)).toBe(54);
  });
  it('converts the common ranges', () => {
    expect(SCALES.k10.toRaw(6.8)).toBe(68);
    expect(SCALES.k1to10.toRaw(1.0)).toBe(0);
    expect(SCALES.k1to10.toRaw(10)).toBe(90);
    expect(SCALES.nr.toRaw(0)).toBe(0);
    expect(SCALES.nr.toRaw(10)).toBe(50);
    expect(SCALES.nr.format(1)).toBe('0.2');
    expect(SCALES.pitch.toRaw(-12)).toBe(12);
    expect(SCALES.ms2.toDisplay(5)).toBe(10);
  });
});

describe('sysex messages', () => {
  it('builds the header with the MIDI channel', () => {
    expect(sx.toHex(sx.currentProgramDumpRequest(0))).toBe('F0 42 30 6D 08 10 F7');
    expect(sx.toHex(sx.modeRequest(15))).toBe('F0 42 3F 6D 08 12 F7');
    expect(sx.toHex(sx.deviceInquiry())).toBe('F0 7E 7F 06 01 F7');
  });
  it('encodes a parameter change with a 14-bit value', () => {
    expect(sx.toHex(sx.parameterChange(0, 0x08, 0x02, 68))).toBe('F0 42 30 6D 08 41 08 02 00 44 F7');
    expect(sx.toHex(sx.parameterChange(0, 0x06, 0x00, 2000))).toBe('F0 42 30 6D 08 41 06 00 0F 50 F7');
  });
  it('encodes write and mode change', () => {
    expect(sx.toHex(sx.programWriteRequest(0, 95))).toBe('F0 42 30 6D 08 11 00 5F F7');
    expect(sx.toHex(sx.programDumpRequest(0, 3))).toBe('F0 42 30 6D 08 1C 20 03 F7');
    expect(sx.toHex(sx.modeChange(0, { program: 5 }))).toBe('F0 42 30 6D 08 4E 20 05 F7');
    expect(sx.toHex(sx.modeChange(0, { mode: 'fx' }))).toBe('F0 42 30 6D 08 4E 50 00 F7');
  });
  it('round-trips a current program dump', () => {
    const p = blankProgram();
    const m = sx.currentProgramDump(2, p);
    expect(m).toHaveLength(5 + 1 + 106 + 1);
    const parsed = sx.parse(m);
    expect(parsed.kind).toBe('currentProgram');
    if (parsed.kind === 'currentProgram') {
      expect(parsed.channel).toBe(2);
      expect(Array.from(parsed.data)).toEqual(Array.from(p));
    }
  });
  it('parses replies', () => {
    expect(sx.parse(sx.fromHex('F0 42 30 6D 08 23 F7')).kind).toBe('ack');
    expect(sx.parse(sx.fromHex('F0 42 30 6D 08 24 F7')).kind).toBe('nak');
    const pc = sx.parse(sx.fromHex('F0 42 30 6D 08 41 08 02 00 44 F7'));
    expect(pc).toMatchObject({ kind: 'parameterChange', id: 8, sub: 2, value: 68 });
    const inquiry = sx.parse(sx.fromHex('F0 7E 00 06 02 42 6D 00 08 00 03 00 01 00 F7'));
    expect(inquiry).toMatchObject({ kind: 'deviceInquiryReply', family: 0x6d, member: 0x08, version: '1.03' });
    expect(sx.isToneLabSE(inquiry)).toBe(true);
    expect(sx.parse(sx.fromHex('F0 42 30 6D 08 42 40 07 F7'))).toMatchObject({ kind: 'modeData', mode: 'fx', program: 7 });
  });
});

describe('program controls', () => {
  it('name is 8 upper-case characters', () => {
    expect(getName(setName(blankProgram(), 'Back in black!'))).toBe('BACK IN');
  });
  it('status bits toggle independently', () => {
    let p = blankProgram();
    p = write(p, { kind: 'status', key: 'reverb' }, 1);
    p = write(p, { kind: 'status', key: 'pedal' }, 0);
    expect(read(p, { kind: 'status', key: 'reverb' })).toBe(1);
    expect(read(p, { kind: 'status', key: 'ampA' })).toBe(1);
    expect(read(p, { kind: 'status', key: 'pedal' })).toBe(0);
  });
  it('clamps to the parameter range of the current type', () => {
    let p = write(blankProgram(), { kind: 'effectType', slot: 'mod' }, 0x06); // ROTARY, speed 45..100
    p = write(p, { kind: 'effectParam', slot: 'mod', key: 'speed1' }, 0);
    expect(read(p, { kind: 'effectParam', slot: 'mod', key: 'speed1' })).toBe(45);
  });
  it('stores the 2-byte delay time', () => {
    let p = write(blankProgram(), { kind: 'effectType', slot: 'delay' }, 0x09); // HOLD DELAY up to 8000
    p = write(p, { kind: 'effectParam', slot: 'delay', key: 'time' }, 8000);
    expect(read(p, { kind: 'effectParam', slot: 'delay', key: 'time' })).toBe(8000);
  });
  it('maps every control to a parameter-change address and back', () => {
    const p = blankProgram();
    const refs: ControlRef[] = [
      { kind: 'status', key: 'channelB' },
      { kind: 'chain' },
      { kind: 'ampParam', ch: 'B', key: 'presence' },
      { kind: 'ampType', ch: 'A' },
      { kind: 'cabType', ch: 'B' },
      { kind: 'expMax', pedal: 'exp2' },
      { kind: 'ctrlFactor' },
      ...SLOT_KEYS.map((slot) => ({ kind: 'effectType', slot }) as ControlRef),
      ...SLOT_KEYS.flatMap((slot) =>
        EFFECT_SLOTS[slot].types[0].params.map((d) => ({ kind: 'effectParam', slot, key: d.key }) as ControlRef),
      ),
    ];
    for (const ref of refs) {
      const a = addressOf(p, ref);
      expect(controlFromAddress(p, a.id, a.sub)).toEqual(ref);
    }
    expect(addressOf(p, { kind: 'ampParam', ch: 'A', key: 'treble' })).toEqual({ id: 0x08, sub: 0x02 });
    expect(addressOf(p, { kind: 'effectParam', slot: 'delay', key: 'mix' })).toEqual({ id: 0x06, sub: 0x05 });
  });
});

describe('recipes', () => {
  const pedal: PedalSettings = {
    name: 'BACKBLAK',
    chain: 'M-D-R',
    activeChannel: 'A',
    channelA: { amp: 'UK 68P', cabinet: 'UK T75 4x12', gain: 6, vrGain: 5, treble: 6, middle: 7, bass: 5, presence: 6, volume: 7, nr: 3 },
    channelB: { amp: 'uk 68p', cabinet: 'uk t75 4x12', gain: 7.5, vrGain: 6, treble: 6.5, middle: 7.5, bass: 5, presence: 6.5, volume: 8, nr: 3 },
    pedal: { on: false, type: 'TREBLE BOOST', params: { drive: 5, level: 6, tone: 5 } },
    mod: { on: false },
    delay: { on: true, type: 'ANALOG DELAY', params: { time: 380, feedback: 2.5, tone: 5, mix: 2 } },
    reverb: { on: true, type: 'ROOM 1', params: { time: 3, mix: 2, predelay: 20 } },
    exp1: 'VOLUME',
    exp2: 'A/GAIN B',
  };

  it('applies and reads back the same values', () => {
    const { bytes, warnings } = applyRecipe(pedal);
    expect(warnings).toEqual([]);
    const back = readRecipe(bytes);
    expect(back.name).toBe('BACKBLAK');
    expect(back.channelA.amp).toBe('UK 68P');
    expect(back.channelB?.cabinet).toBe('UK T75 4x12');
    expect(back.channelA.gain).toBe(6);
    expect(back.channelB?.gain).toBe(7.5);
    expect(back.channelA.nr).toBe(3);
    expect(back.delay).toMatchObject({ on: true, type: 'ANALOG DELAY', params: { time: 380, feedback: 2.5, tone: 5, mix: 2 } });
    expect(back.reverb.params?.predelay).toBe(20);
    expect(back.exp1).toBe('VOLUME');
    expect(back.exp2).toBe('A/GAIN B');
    expect(read(bytes, { kind: 'status', key: 'cabA' })).toBe(1);
  });

  it('clamps and warns about bad values', () => {
    const { bytes, warnings } = applyRecipe({ ...pedal, channelA: { ...pedal.channelA, amp: 'Marshall', gain: 14 } });
    expect(warnings.some((w) => w.includes('Marshall'))).toBe(true);
    expect(warnings.some((w) => w.includes('Gain'))).toBe(true);
    expect(read(bytes, { kind: 'ampParam', ch: 'A', key: 'gain' })).toBe(100);
  });

  it('labels expression targets from the current effect types', () => {
    let p = write(blankProgram(), { kind: 'effectType', slot: 'pedal' }, 0x02); // VOX WAH
    expect(expTargetLabel(p, 0b001000)).toBe('P/MANUAL');
  });

  it('knows every amp and cabinet in the spec', () => {
    expect(AMP_TYPES).toHaveLength(16);
    expect(CAB_TYPES).toHaveLength(11);
    expect(EFFECT_SLOTS.pedal.types).toHaveLength(16);
    expect(EFFECT_SLOTS.mod.types).toHaveLength(11);
    expect(EFFECT_SLOTS.delay.types).toHaveLength(11);
    expect(EFFECT_SLOTS.reverb.types).toHaveLength(11);
  });
});
