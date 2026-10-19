// Parameter map transcribed from the VOX ToneLabSE MIDI Implementation v1.0 (2003-11-20).
// Table numbers in comments refer to that document.
//
// Items marked VERIFY are not fully specified by the document and must be confirmed
// against a real dump from the pedal (see docs/HARDWARE-TEST.md).

import type { ScaleId } from './scales';

export const PROGRAM_SIZE = 92; // NOTE 1: 92 bytes per program
export const GLOBAL_SIZE = 16; // NOTE 4
export const PROGRAM_COUNT = 96; // 24 banks x 4

/** Format of the 2-byte fields (delay time, expression ranges). Confirmed on hardware: ANALOG DELAY 1000 ms reads 03 E8. */
export const TWO_BYTE_ORDER: 'msb-first' | 'lsb-first' = 'msb-first';

export interface ParamDef {
  key: string;
  label: string;
  /** Offset inside the effect's parameter block (effects) or absolute byte (amp). */
  offset: number;
  /** Parameter SUB ID for PARAMETER CHANGE (func 41). */
  sub: number;
  min: number;
  max: number;
  scale: ScaleId;
  options?: readonly string[];
  /** 2-byte value (delay TIME). */
  wide?: boolean;
  /** 6-bit expression-pedal target code, when the parameter can be assigned (TABLE 1-1..1-4). */
  exp?: number;
}

export interface EffectTypeDef {
  id: number;
  name: string;
  params: readonly ParamDef[];
}

export interface EffectSlotDef {
  slot: SlotKey;
  label: string;
  /** Byte holding the effect type. */
  typeByte: number;
  /** First byte of the 8-byte parameter block. */
  paramBase: number;
  /** PARAMETER CHANGE ids: type = 03,<typeSub>; parameters = <paramId>,<sub>. */
  typeSub: number;
  paramId: number;
  /** Expression target prefix (3 high bits of the 6-bit code). */
  expPrefix: number;
  types: readonly EffectTypeDef[];
}

export type SlotKey = 'pedal' | 'mod' | 'delay' | 'reverb';

const UPDOWN = ['UP', 'DOWN'] as const;
const WAHTYPE = ['V847', 'V848'] as const;
const ORDER = ['PRE', 'POST'] as const;

// helper: p(key, label, offset, sub, min, max, scale, exp?, options?)
function p(
  key: string,
  label: string,
  offset: number,
  sub: number,
  min: number,
  max: number,
  scale: ScaleId,
  exp?: number,
  options?: readonly string[],
): ParamDef {
  return { key, label, offset, sub, min, max, scale, exp, options };
}

// ---------- TABLE 1-1 PEDAL ----------
const driveParams = [
  p('drive', 'Drive', 0, 0, 0, 90, 'k1to10', 0b001000),
  p('level', 'Level', 1, 1, 0, 100, 'k10', 0b001001),
  p('tone', 'Tone', 2, 2, 0, 90, 'k1to10', 0b001010),
];

export const PEDAL_TYPES: readonly EffectTypeDef[] = [
  { id: 0x00, name: 'COMP', params: [p('sens', 'Sens', 0, 0, 0, 90, 'k1to10', 0b001000), p('level', 'Level', 1, 1, 0, 100, 'k10', 0b001001), p('attack', 'Attack', 2, 2, 0, 90, 'k1to10', 0b001010)] },
  { id: 0x01, name: 'ACOUSTIC', params: [p('body', 'Body', 0, 0, 0, 90, 'k1to10', 0b001000), p('bass', 'Bass', 1, 1, 0, 100, 'k10', 0b001001), p('treble', 'Treble', 2, 2, 0, 100, 'k10', 0b001010)] },
  {
    id: 0x02,
    name: 'VOX WAH',
    params: [
      p('close', 'Close', 1, 1, 0, 90, 'k1to10'),
      p('open', 'Open', 2, 2, 0, 90, 'k1to10'),
      p('manual', 'Manual', 3, 3, 0, 90, 'k1to10', 0b001000),
      p('type', 'Type', 4, 4, 0, 1, 'enum', undefined, WAHTYPE),
      p('order', 'Order', 5, 5, 0, 1, 'enum', undefined, ORDER),
    ],
  },
  {
    id: 0x03,
    name: 'AUTO WAH',
    params: [
      p('sens', 'Sens', 0, 0, 0, 100, 'k10', 0b001000),
      p('polarity', 'Polarity', 1, 1, 0, 1, 'enum', undefined, UPDOWN),
      p('attack', 'Attack', 2, 2, 0, 90, 'k1to10', 0b001001),
      p('type', 'Type', 4, 4, 0, 1, 'enum', undefined, WAHTYPE),
      p('order', 'Order', 5, 5, 0, 1, 'enum', undefined, ORDER),
    ],
  },
  { id: 0x04, name: 'U-VIBE', params: [p('speed', 'Speed', 0, 0, 50, 100, 'speedHz', 0b001000), p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b001001), p('mix', 'Mix', 2, 2, 0, 100, 'k10')] },
  {
    id: 0x05,
    name: 'BLK/ORG PHASE',
    params: [
      p('speed', 'Speed', 0, 0, 0, 100, 'speedHz', 0b001000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b001001),
      p('resonance', 'Reso', 2, 2, 0, 100, 'k10', 0b001010),
      p('manual', 'Manual', 3, 3, 0, 90, 'k1to10', 0b001011),
      p('type', 'Type', 4, 4, 0, 2, 'enum', undefined, ['BLK', 'ORG1', 'ORG2']),
      p('order', 'Order', 5, 5, 0, 1, 'enum', undefined, ORDER),
    ],
  },
  { id: 0x06, name: 'OCTAVE', params: [p('direct', 'Direct', 0, 0, 0, 100, 'k10', 0b001000), p('oct1', '1 Oct', 1, 1, 0, 100, 'k10', 0b001001), p('oct2', '2 Oct', 2, 2, 0, 100, 'k10', 0b001010)] },
  {
    id: 0x07,
    name: 'RING MODULATOR',
    params: [
      p('direct', 'Direct', 0, 0, 0, 100, 'k10', 0b001000),
      p('effect', 'Effect', 1, 1, 0, 100, 'k10', 0b001001),
      p('filter', 'Filter', 2, 2, 0, 90, 'k1to10', 0b001010),
      p('manual', 'Manual', 3, 3, 0, 100, 'k10', 0b001011),
    ],
  },
  { id: 0x08, name: 'TREBLE BOOST', params: driveParams },
  { id: 0x09, name: 'TUBE OD', params: driveParams },
  { id: 0x0a, name: 'SUPER OD', params: driveParams },
  { id: 0x0b, name: 'BOUTIQUE', params: driveParams },
  { id: 0x0c, name: 'FAT DIST', params: driveParams },
  { id: 0x0d, name: 'ORANGE DIST', params: driveParams },
  { id: 0x0e, name: 'FUZZ', params: driveParams },
  { id: 0x0f, name: 'OCTAFUZZ', params: driveParams },
];

// ---------- TABLE 1-2 MODULATION ----------
export const MOD_TYPES: readonly EffectTypeDef[] = [
  {
    id: 0x00,
    name: 'CLASSIC CHORUS',
    params: [
      p('speed', 'Speed', 0, 0, 0, 100, 'speedHz', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('manual', 'Manual', 3, 3, 0, 90, 'k1to10', 0b010010),
      p('mode', 'Mode', 4, 4, 0, 2, 'int1'),
    ],
  },
  {
    id: 0x01,
    name: 'STEREO CHORUS',
    params: [
      p('speed', 'Speed', 0, 0, 0, 100, 'speedHz', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('manual', 'Manual', 3, 3, 0, 90, 'k1to10', 0b010010),
      p('mix', 'Mix', 5, 5, 0, 100, 'k10', 0b010011),
    ],
  },
  {
    id: 0x02,
    name: 'CLASSIC FLANGER',
    params: [
      p('speed', 'Speed', 0, 0, 0, 100, 'speedHz', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('resonance', 'Reso', 2, 2, 0, 100, 'k10', 0b010010),
      p('manual', 'Manual', 3, 3, 0, 90, 'k1to10', 0b010011),
      p('offset', 'Offset', 4, 4, 0, 100, 'k10'),
      p('mix', 'Mix', 5, 5, 0, 100, 'k10', 0b010100),
    ],
  },
  {
    id: 0x03,
    name: 'BI CHORUS',
    params: [
      p('speed1', 'Speed 1', 0, 0, 0, 100, 'speedHz', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('resonance', 'Reso', 2, 2, 0, 100, 'k10', 0b010010),
      p('speed2', 'Speed 2', 3, 3, 0, 100, 'speedHz', 0b010011),
      p('mode', 'Mode', 4, 4, 0, 3, 'enum', undefined, ['S', 'P1', 'P2', 'P3']),
      p('mix', 'Mix', 5, 5, 0, 100, 'k10', 0b010100),
    ],
  },
  {
    id: 0x04,
    name: 'DUO PHASE',
    params: [
      p('speed1', 'Speed 1', 0, 0, 0, 100, 'speedHz', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('resonance', 'Reso', 2, 2, 0, 100, 'k10', 0b010010),
      p('speed2', 'Speed 2', 3, 3, 0, 100, 'speedHz', 0b010011),
      p('mode', 'Mode', 4, 4, 0, 4, 'enum', undefined, ['S1', 'S2', 'P1', 'P2', 'P3']),
    ],
  },
  {
    id: 0x05,
    name: 'TEXTREM',
    params: [
      // The spec prints 001000 for this target, which is a PEDAL code. Confirmed on hardware: the pedal stores 010000 (0x10).
      p('speed', 'Speed', 0, 0, 50, 100, 'speedHz', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('spread', 'Spread', 4, 4, 0, 100, 'k10'),
    ],
  },
  {
    id: 0x06,
    name: 'ROTARY',
    params: [
      p('speed1', 'Speed 1', 0, 0, 45, 100, 'speedHz', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('speed2', 'Speed 2', 3, 3, 45, 100, 'speedHz', 0b010010),
      p('accel', 'Accel', 4, 4, 0, 90, 'k1to10', 0b010011),
    ],
  },
  {
    id: 0x07,
    name: 'PITCH SHIFTER',
    params: [
      p('pitch', 'Pitch', 0, 0, 0, 48, 'pitch', 0b010000),
      p('fine', 'Fine', 1, 1, 0, 100, 'fine', 0b010001),
      p('tracking', 'Tracking', 3, 3, 5, 75, 'ms2'),
      p('direct', 'Direct', 4, 4, 0, 100, 'k10', 0b010010),
      p('effect', 'Effect', 5, 5, 0, 100, 'k10', 0b010011),
    ],
  },
  {
    id: 0x08,
    name: 'MOD DELAY',
    params: [
      p('speed', 'Speed', 0, 0, 0, 100, 'speedHz', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('feedback', 'F.back', 2, 2, 0, 100, 'k10', 0b010010),
      p('time', 'Time', 3, 3, 0, 90, 'k1to10', 0b010011),
      p('mode', 'Mode', 4, 4, 0, 2, 'int1'),
      p('mix', 'Mix', 5, 5, 0, 100, 'k10', 0b010100),
    ],
  },
  {
    id: 0x09,
    name: 'FILTRON',
    params: [
      p('attack', 'Attack', 0, 0, 0, 90, 'k1to10', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      p('resonance', 'Reso', 2, 2, 0, 100, 'k10', 0b010010),
      p('manual', 'Manual', 3, 3, 0, 90, 'k1to10', 0b010011),
      p('polarity', 'Polarity', 4, 4, 0, 1, 'enum', undefined, UPDOWN),
      p('sens', 'Sens', 5, 5, 0, 100, 'k10', 0b010100),
    ],
  },
  {
    id: 0x0a,
    name: 'TALK MOD',
    params: [
      p('attack', 'Attack', 0, 0, 0, 90, 'k1to10', 0b010000),
      p('depth', 'Depth', 1, 1, 0, 100, 'k10', 0b010001),
      // The spec only says "A-E ~ O-U" for these 10 vowel pairs.
      p('type', 'Vowels', 2, 2, 0, 9, 'int1'),
      p('manual', 'Manual', 3, 3, 0, 90, 'k1to10', 0b010010),
      p('polarity', 'Polarity', 4, 4, 0, 1, 'enum', undefined, UPDOWN),
      p('sens', 'Sens', 5, 5, 0, 100, 'k10', 0b010011),
    ],
  },
];

// ---------- TABLE 1-3 DELAY ----------
// TIME is 2 bytes at offsets 0-1 (sub 00); later parameters' sub IDs are offset - 1.
const time = (min: number, max: number, exp?: number): ParamDef => ({ ...p('time', 'Time', 0, 0, min, max, 'ms', exp), wide: true });
const fb = (exp?: number) => p('feedback', 'F.back', 2, 1, 0, 100, 'k10', exp);
const dtone = (exp?: number) => p('tone', 'Tone', 3, 2, 0, 90, 'k1to10', exp);
const duck = (exp?: number) => p('ducking', 'Ducking', 4, 3, 0, 100, 'k10', exp);
const dmix = (exp?: number) => p('mix', 'Mix', 6, 5, 0, 100, 'k10', exp);
const stereoLike = [time(1, 4000), fb(0b011001), dtone(0b011010), duck(0b011011), dmix(0b011100)];

export const DELAY_TYPES: readonly EffectTypeDef[] = [
  { id: 0x00, name: 'ECHO PLUS', params: [time(26, 2000, 0b011001), fb(0b011010), dtone(0b011011), p('lodamp', 'Lo damp', 5, 4, 0, 100, 'k10', 0b011100), dmix(0b011101)] },
  { id: 0x01, name: 'MULTI HEAD', params: [time(1, 2000), fb(0b011001), dtone(0b011010), p('mode', 'Mode', 5, 4, 0, 4, 'int1'), dmix(0b011011)] },
  { id: 0x02, name: 'ANALOG DELAY', params: [time(1, 2000, 0b011001), fb(0b011010), dtone(0b011011), dmix(0b011100)] },
  { id: 0x03, name: 'MOD DELAY', params: [time(3, 2000, 0b011001), fb(0b011010), dtone(0b011011), p('speed', 'Speed', 5, 4, 0, 100, 'speedHz', 0b011100), dmix(0b011101)] },
  { id: 0x04, name: 'SWEEP DELAY', params: [time(26, 2000, 0b011001), fb(0b011010), dtone(0b011011), p('sens', 'Sens', 5, 4, 0, 100, 'k10', 0b011100), dmix(0b011101)] },
  { id: 0x05, name: 'STEREO DELAY', params: stereoLike },
  { id: 0x06, name: 'CROSS DELAY', params: stereoLike },
  { id: 0x07, name: '2TAP DELAY', params: stereoLike },
  { id: 0x08, name: 'RHYTHM DELAY', params: [time(1, 4000), fb(0b011001), dtone(0b011010), duck(0b011011), p('rhythm', 'Rhythm', 5, 4, 0, 10, 'int1'), dmix(0b011100)] },
  { id: 0x09, name: 'HOLD DELAY', params: [time(1, 8000), fb(0b011001), dtone(0b011010), dmix(0b011011)] },
  { id: 0x0a, name: 'REVERSE DELAY', params: [time(26, 4000), fb(0b011001), dtone(0b011010), dmix()] },
];

// ---------- TABLE 1-4 REVERB ----------
const reverbParams = [
  p('time', 'Time', 0, 0, 0, 90, 'k1to10', 0b100001),
  p('lodamp', 'Lo damp', 1, 1, 0, 100, 'k10', 0b100010),
  p('hidamp', 'Hi damp', 2, 2, 0, 100, 'k10', 0b100011),
  p('predelay', 'Pre dly', 3, 3, 0, 100, 'ms'),
  p('mix', 'Mix', 5, 5, 0, 100, 'k10', 0b100100),
];
export const REVERB_TYPES: readonly EffectTypeDef[] = [
  ...['SPRING 1', 'SPRING 2', 'PLATE 1', 'PLATE 2', 'CHAMBER 1', 'CHAMBER 2', 'ROOM 1', 'ROOM 2', 'HALL 1', 'HALL 2'].map((name, id) => ({ id, name, params: reverbParams })),
  {
    id: 0x0a,
    name: 'GATE',
    params: [
      p('time', 'Time', 0, 0, 1, 100, 'ms5'),
      p('lodamp', 'Lo damp', 1, 1, 0, 100, 'k10', 0b100001),
      p('hidamp', 'Hi damp', 2, 2, 0, 100, 'k10', 0b100010),
      p('predelay', 'Pre dly', 3, 3, 0, 100, 'ms'),
      p('shape', 'Shape', 4, 4, 0, 1, 'int1'),
      p('mix', 'Mix', 5, 5, 0, 100, 'k10'),
    ],
  },
];

export const EFFECT_SLOTS: Record<SlotKey, EffectSlotDef> = {
  pedal: { slot: 'pedal', label: 'Pedal', typeByte: 13, paramBase: 14, typeSub: 0x00, paramId: 0x04, expPrefix: 0b001, types: PEDAL_TYPES },
  mod: { slot: 'mod', label: 'Modulation', typeByte: 22, paramBase: 23, typeSub: 0x01, paramId: 0x05, expPrefix: 0b010, types: MOD_TYPES },
  delay: { slot: 'delay', label: 'Delay', typeByte: 31, paramBase: 32, typeSub: 0x02, paramId: 0x06, expPrefix: 0b011, types: DELAY_TYPES },
  reverb: { slot: 'reverb', label: 'Reverb', typeByte: 40, paramBase: 41, typeSub: 0x03, paramId: 0x07, expPrefix: 0b100, types: REVERB_TYPES },
};
export const SLOT_KEYS: readonly SlotKey[] = ['pedal', 'mod', 'delay', 'reverb'];

// ---------- TABLE 1-5 / 1-6 AMPS AND CABINETS ----------
export const AMP_TYPES = [
  'AC15', 'AC15TB', 'AC30', 'AC30TB', 'UK BLUES', 'UK 68P', "UK '80S", "UK '90S",
  'UK MODERN', 'RECTO', 'US HIGAIN', 'BOUTIQUE OD', 'BOUTIQUE CL', 'BLACK 2x12', 'TWEED 1x12', 'TWEED 4x10',
] as const;

/** What each model is commonly taken to stand for. Approximate; used to guide the AI. */
export const AMP_NOTES: Record<(typeof AMP_TYPES)[number], string> = {
  AC15: 'VOX AC15, chimey class-A clean to light breakup',
  AC15TB: 'VOX AC15 with Top Boost, brighter, more gain',
  AC30: 'VOX AC30 normal channel, warm class-A chime',
  AC30TB: 'VOX AC30 Top Boost, the classic British jangle and crunch',
  'UK BLUES': 'early Marshall JTM45 / Bluesbreaker style, warm blues crunch',
  'UK 68P': 'late-60s Marshall Plexi, classic rock crunch',
  "UK '80S": 'Marshall JCM800 style, 80s hard rock and metal',
  "UK '90S": 'Marshall JCM900 style, hotter modern rock',
  'UK MODERN': 'modern high-gain British amp',
  RECTO: 'Mesa/Boogie Dual Rectifier style, tight modern high gain',
  'US HIGAIN': 'American boutique high gain (Soldano style)',
  'BOUTIQUE OD': 'Dumble-style overdrive channel, smooth singing leads',
  'BOUTIQUE CL': 'Dumble-style clean channel, rich and full',
  'BLACK 2x12': 'Fender Twin Reverb style, sparkling blackface clean',
  'TWEED 1x12': 'Fender Tweed Deluxe style, gritty small-amp breakup',
  'TWEED 4x10': 'Fender Bassman style, fat tweed breakup',
};

export const CAB_TYPES = [
  'TWEED 1x8', 'TWEED 1x12', 'TWEED 4x10', 'BLACK 2x10', 'BLACK 2x12', 'VOX AC15',
  'VOX AC30', 'VOX AD412', 'UK H30 4x12', 'UK T75 4x12', 'US V30 4x12',
] as const;

export interface AmpParamDef {
  key: 'gain' | 'vrGain' | 'treble' | 'middle' | 'bass' | 'volume' | 'presence' | 'nrSens';
  label: string;
  /** Offset from the channel's amp-type byte + 1. */
  index: number;
  min: number;
  max: number;
  scale: ScaleId;
}
export const AMP_PARAMS: readonly AmpParamDef[] = [
  { key: 'gain', label: 'Gain', index: 0, min: 0, max: 100, scale: 'k10' },
  { key: 'vrGain', label: 'VR Gain', index: 1, min: 0, max: 100, scale: 'k10' },
  { key: 'treble', label: 'Treble', index: 2, min: 0, max: 100, scale: 'k10' },
  { key: 'middle', label: 'Middle', index: 3, min: 0, max: 100, scale: 'k10' },
  { key: 'bass', label: 'Bass', index: 4, min: 0, max: 100, scale: 'k10' },
  { key: 'volume', label: 'Volume', index: 5, min: 0, max: 100, scale: 'k10' },
  { key: 'presence', label: 'Presence', index: 6, min: 0, max: 100, scale: 'k10' },
  { key: 'nrSens', label: 'NR', index: 7, min: 0, max: 50, scale: 'nr' },
];

export interface ChannelDef {
  ch: 'A' | 'B';
  ampTypeByte: number; // 49 / 63
  firstParamByte: number; // 50 / 64
  cabByte: number; // 58 / 72
  ampTypeSub: number; // 03,04 / 03,06
  cabTypeSub: number; // 03,05 / 03,07
  paramId: number; // 08 / 0A
}
export const CHANNELS: Record<'A' | 'B', ChannelDef> = {
  A: { ch: 'A', ampTypeByte: 49, firstParamByte: 50, cabByte: 58, ampTypeSub: 0x04, cabTypeSub: 0x05, paramId: 0x08 },
  B: { ch: 'B', ampTypeByte: 63, firstParamByte: 64, cabByte: 72, ampTypeSub: 0x06, cabTypeSub: 0x07, paramId: 0x0a },
};

// ---------- EFFECT STATUS (bytes 10-12) ----------
export type StatusKey = 'pedal' | 'mod' | 'delay' | 'reverb' | 'ampA' | 'cabA' | 'ampB' | 'cabB' | 'insert' | 'channelB';
export const STATUS_BITS: Record<StatusKey, { byte: number; bit: number; sub: number; label: string }> = {
  pedal: { byte: 10, bit: 0, sub: 0x00, label: 'Pedal' },
  mod: { byte: 10, bit: 1, sub: 0x01, label: 'Modulation' },
  delay: { byte: 10, bit: 2, sub: 0x02, label: 'Delay' },
  reverb: { byte: 10, bit: 3, sub: 0x03, label: 'Reverb' },
  ampA: { byte: 10, bit: 4, sub: 0x04, label: 'Amp A' },
  cabA: { byte: 10, bit: 5, sub: 0x05, label: 'Cabinet A' },
  ampB: { byte: 10, bit: 6, sub: 0x06, label: 'Amp B' },
  cabB: { byte: 10, bit: 7, sub: 0x07, label: 'Cabinet B' },
  insert: { byte: 11, bit: 0, sub: 0x08, label: 'Insert' },
  channelB: { byte: 11, bit: 1, sub: 0x09, label: 'A/B channel' },
};
export const STATUS_PARAM_ID = 0x02;
export const TYPE_PARAM_ID = 0x03;

export const CHAIN_BYTE = 12;
/** PARA No. printed as "02,10"; read as hex like the rest of the table. Confirmed on hardware. */
export const CHAIN_SUB = 0x10;
/** Index = byte 12 value. Confirmed on hardware (pedal shows MD-DL-RV, MD-RV-DL, DL-MD-RV, DL-RV-MD, RV-MD-DL, RV-DL-MD). */
export const CHAIN_ORDERS = ['M-D-R', 'M-R-D', 'D-M-R', 'D-R-M', 'R-M-D', 'R-D-M'] as const;

// ---------- EXPRESSION + CONTROL PEDALS ----------
export interface ExpPedalDef {
  key: 'exp1' | 'exp2';
  label: string;
  targetByte: number;
  minByte: number; // 2 bytes
  maxByte: number; // 2 bytes
  paramId: number; // 0C / 0D, subs 00 target, 01 min, 02 max
}
export const EXP_PEDALS: Record<'exp1' | 'exp2', ExpPedalDef> = {
  exp1: { key: 'exp1', label: 'EXP 1', targetByte: 77, minByte: 78, maxByte: 80, paramId: 0x0c },
  exp2: { key: 'exp2', label: 'EXP 2', targetByte: 82, minByte: 83, maxByte: 85, paramId: 0x0d },
};

/** TABLE 1-7 fixed targets (the P/M/D/R codes come from the current effect types). */
export const EXP_FIXED_TARGETS: Record<number, { label: string; min: number; max: number }> = {
  0b000000: { label: 'OFF', min: 0, max: 0 },
  0b000001: { label: 'VOLUME', min: 0, max: 100 },
  0b011000: { label: 'D/INPUT', min: 0, max: 100 },
  0b100000: { label: 'R/INPUT', min: 0, max: 100 },
  0b101000: { label: 'A/GAIN A', min: 0, max: 100 },
  0b101001: { label: 'A/VRGN A', min: 0, max: 100 },
  0b110000: { label: 'A/GAIN B', min: 0, max: 100 },
  0b110001: { label: 'A/VRGN B', min: 0, max: 100 },
};

export const CTRL_TARGET_BYTE = 87;
export const CTRL_FACTOR_BYTE = 88;
export const CTRL_PARAM_ID = 0x0e;
/** TABLE 1-8 */
export const CTRL_TARGETS = [
  'INSERT On/Off', 'PEDAL On/Off', 'AMP On/Off', 'CABINET On/Off', 'MOD On/Off', 'DELAY On/Off',
  'REVERB On/Off', 'MOD TAP', 'DELAY TAP', 'FLANGER TRIG', 'ROTARY SPEED', 'HOLD DELAY',
] as const;
/** *3 */
export const CTRL_FACTORS = ['1/6', '1/4', '1/3', '1/2', '2/3', '3/4', '1', '4/3', '3/2', '2', '3', '4'] as const;

// ---------- TABLE 2 GLOBAL ----------
export const GLOBAL = {
  midiChannelByte: 0, // b0-3
  flagsByte: 1, // b0 PCHG out, b1 CCHG I/O, b2 SysEx out, b4 A/B hold, b5/b6 EXP init
  ccBytes: { exp1: 2, exp2: 3, ctrl: 4, pedal: 5, mod: 6, delay: 7, reverb: 8, insert: 9, abSelect: 10 },
  outputSelectByte: 15, // 0 = Amp, 1 = Line
} as const;

export function effectType(slot: SlotKey, typeId: number): EffectTypeDef | undefined {
  return EFFECT_SLOTS[slot].types.find((t) => t.id === typeId);
}

export function programLabel(program: number): string {
  const bank = Math.floor(program / 4) + 1;
  const num = (program % 4) + 1;
  return `${String(bank).padStart(2, '0')}-${num}`;
}
