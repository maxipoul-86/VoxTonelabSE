// A Tonelab SE program is kept as its raw 92 bytes, so reserved bytes survive untouched.
// "Controls" address one value inside it: read it, write it, and map it to and from the
// PARAMETER CHANGE (func 41) id/sub pair used for live edits.

import { clamp } from './scales';
import {
  AMP_PARAMS,
  AMP_TYPES,
  CAB_TYPES,
  CHAIN_BYTE,
  CHAIN_ORDERS,
  CHAIN_SUB,
  CHANNELS,
  CTRL_FACTOR_BYTE,
  CTRL_FACTORS,
  CTRL_PARAM_ID,
  CTRL_TARGET_BYTE,
  CTRL_TARGETS,
  EFFECT_SLOTS,
  EXP_PEDALS,
  PROGRAM_SIZE,
  SLOT_KEYS,
  STATUS_BITS,
  STATUS_PARAM_ID,
  TWO_BYTE_ORDER,
  TYPE_PARAM_ID,
  effectType,
  type AmpParamDef,
  type ParamDef,
  type SlotKey,
  type StatusKey,
} from './spec';

export type Channel = 'A' | 'B';
export type ExpKey = 'exp1' | 'exp2';

export type ControlRef =
  | { kind: 'nameChar'; index: number }
  | { kind: 'status'; key: StatusKey }
  | { kind: 'chain' }
  | { kind: 'effectType'; slot: SlotKey }
  | { kind: 'effectParam'; slot: SlotKey; key: string }
  | { kind: 'ampType'; ch: Channel }
  | { kind: 'cabType'; ch: Channel }
  | { kind: 'ampParam'; ch: Channel; key: AmpParamDef['key'] }
  | { kind: 'expTarget'; pedal: ExpKey }
  | { kind: 'expMin'; pedal: ExpKey }
  | { kind: 'expMax'; pedal: ExpKey }
  | { kind: 'ctrlTarget' }
  | { kind: 'ctrlFactor' };

export interface Address {
  id: number;
  sub: number;
}

// ----- low-level byte access -----

function readWide(bytes: Uint8Array, at: number): number {
  return TWO_BYTE_ORDER === 'msb-first' ? (bytes[at] << 8) | bytes[at + 1] : bytes[at] | (bytes[at + 1] << 8);
}
function writeWide(bytes: Uint8Array, at: number, value: number) {
  const hi = (value >> 8) & 0xff;
  const lo = value & 0xff;
  if (TWO_BYTE_ORDER === 'msb-first') {
    bytes[at] = hi;
    bytes[at + 1] = lo;
  } else {
    bytes[at] = lo;
    bytes[at + 1] = hi;
  }
}

export function effectParamDef(bytes: Uint8Array, slot: SlotKey, key: string): ParamDef | undefined {
  return effectType(slot, bytes[EFFECT_SLOTS[slot].typeByte])?.params.find((p) => p.key === key);
}

export function ampParamDef(key: AmpParamDef['key']): AmpParamDef {
  const def = AMP_PARAMS.find((p) => p.key === key);
  if (!def) throw new Error(`unknown amp parameter ${key}`);
  return def;
}

/** Valid raw range for a control, given the program's current effect types. */
export function rangeOf(bytes: Uint8Array, ref: ControlRef): { min: number; max: number } {
  switch (ref.kind) {
    case 'nameChar':
      return { min: 0x20, max: 0x5f };
    case 'status':
      return { min: 0, max: 1 };
    case 'chain':
      return { min: 0, max: CHAIN_ORDERS.length - 1 };
    case 'effectType':
      return { min: 0, max: EFFECT_SLOTS[ref.slot].types.length - 1 };
    case 'effectParam': {
      const def = effectParamDef(bytes, ref.slot, ref.key);
      if (!def) throw new Error(`${ref.slot} type has no parameter ${ref.key}`);
      return { min: def.min, max: def.max };
    }
    case 'ampType':
      return { min: 0, max: AMP_TYPES.length - 1 };
    case 'cabType':
      return { min: 0, max: CAB_TYPES.length - 1 };
    case 'ampParam': {
      const def = ampParamDef(ref.key);
      return { min: def.min, max: def.max };
    }
    case 'expTarget':
      return { min: 0, max: 0b111111 };
    case 'expMin':
    case 'expMax':
      return { min: 0, max: 0x3fff };
    case 'ctrlTarget':
      return { min: 0, max: CTRL_TARGETS.length - 1 };
    case 'ctrlFactor':
      return { min: 0, max: CTRL_FACTORS.length - 1 };
  }
}

export function read(bytes: Uint8Array, ref: ControlRef): number {
  switch (ref.kind) {
    case 'nameChar':
      return bytes[ref.index];
    case 'status': {
      const s = STATUS_BITS[ref.key];
      return (bytes[s.byte] >> s.bit) & 1;
    }
    case 'chain':
      return bytes[CHAIN_BYTE];
    case 'effectType':
      return bytes[EFFECT_SLOTS[ref.slot].typeByte];
    case 'effectParam': {
      const def = effectParamDef(bytes, ref.slot, ref.key);
      if (!def) throw new Error(`${ref.slot} type has no parameter ${ref.key}`);
      const at = EFFECT_SLOTS[ref.slot].paramBase + def.offset;
      return def.wide ? readWide(bytes, at) : bytes[at];
    }
    case 'ampType':
      return bytes[CHANNELS[ref.ch].ampTypeByte];
    case 'cabType':
      return bytes[CHANNELS[ref.ch].cabByte];
    case 'ampParam':
      return bytes[CHANNELS[ref.ch].firstParamByte + ampParamDef(ref.key).index];
    case 'expTarget':
      return bytes[EXP_PEDALS[ref.pedal].targetByte] & 0x3f;
    case 'expMin':
      return readWide(bytes, EXP_PEDALS[ref.pedal].minByte);
    case 'expMax':
      return readWide(bytes, EXP_PEDALS[ref.pedal].maxByte);
    case 'ctrlTarget':
      return bytes[CTRL_TARGET_BYTE] & 0x3f;
    case 'ctrlFactor':
      return bytes[CTRL_FACTOR_BYTE];
  }
}

/** Returns a new program with the control set (clamped to its valid range). */
export function write(bytes: Uint8Array, ref: ControlRef, raw: number): Uint8Array {
  const out = Uint8Array.from(bytes);
  const { min, max } = rangeOf(bytes, ref);
  const v = clamp(Math.round(raw), min, max);
  switch (ref.kind) {
    case 'nameChar':
      out[ref.index] = v;
      break;
    case 'status': {
      const s = STATUS_BITS[ref.key];
      out[s.byte] = v ? out[s.byte] | (1 << s.bit) : out[s.byte] & ~(1 << s.bit);
      break;
    }
    case 'chain':
      out[CHAIN_BYTE] = v;
      break;
    case 'effectType': {
      const slot = EFFECT_SLOTS[ref.slot];
      out[slot.typeByte] = v;
      // Pull the shared parameter block into the new type's ranges.
      for (const def of effectType(ref.slot, v)?.params ?? []) {
        const at = slot.paramBase + def.offset;
        const cur = def.wide ? readWide(out, at) : out[at];
        const fixed = clamp(cur, def.min, def.max);
        if (def.wide) writeWide(out, at, fixed);
        else out[at] = fixed;
      }
      break;
    }
    case 'effectParam': {
      const def = effectParamDef(bytes, ref.slot, ref.key)!;
      const at = EFFECT_SLOTS[ref.slot].paramBase + def.offset;
      if (def.wide) writeWide(out, at, v);
      else out[at] = v;
      break;
    }
    case 'ampType':
      out[CHANNELS[ref.ch].ampTypeByte] = v;
      break;
    case 'cabType':
      out[CHANNELS[ref.ch].cabByte] = v;
      break;
    case 'ampParam':
      out[CHANNELS[ref.ch].firstParamByte + ampParamDef(ref.key).index] = v;
      break;
    case 'expTarget': {
      const at = EXP_PEDALS[ref.pedal].targetByte;
      out[at] = (out[at] & 0xc0) | v;
      break;
    }
    case 'expMin':
      writeWide(out, EXP_PEDALS[ref.pedal].minByte, v);
      break;
    case 'expMax':
      writeWide(out, EXP_PEDALS[ref.pedal].maxByte, v);
      break;
    case 'ctrlTarget':
      out[CTRL_TARGET_BYTE] = (out[CTRL_TARGET_BYTE] & 0xc0) | v;
      break;
    case 'ctrlFactor':
      out[CTRL_FACTOR_BYTE] = v;
      break;
  }
  return out;
}

/** PARAMETER CHANGE id/sub for a control (TABLE 1 "PARA No."). */
export function addressOf(bytes: Uint8Array, ref: ControlRef): Address {
  switch (ref.kind) {
    case 'nameChar':
      return { id: 0x00, sub: ref.index };
    case 'status':
      return { id: STATUS_PARAM_ID, sub: STATUS_BITS[ref.key].sub };
    case 'chain':
      return { id: STATUS_PARAM_ID, sub: CHAIN_SUB };
    case 'effectType':
      return { id: TYPE_PARAM_ID, sub: EFFECT_SLOTS[ref.slot].typeSub };
    case 'effectParam': {
      const def = effectParamDef(bytes, ref.slot, ref.key);
      if (!def) throw new Error(`${ref.slot} type has no parameter ${ref.key}`);
      return { id: EFFECT_SLOTS[ref.slot].paramId, sub: def.sub };
    }
    case 'ampType':
      return { id: TYPE_PARAM_ID, sub: CHANNELS[ref.ch].ampTypeSub };
    case 'cabType':
      return { id: TYPE_PARAM_ID, sub: CHANNELS[ref.ch].cabTypeSub };
    case 'ampParam':
      return { id: CHANNELS[ref.ch].paramId, sub: ampParamDef(ref.key).index };
    case 'expTarget':
      return { id: EXP_PEDALS[ref.pedal].paramId, sub: 0 };
    case 'expMin':
      return { id: EXP_PEDALS[ref.pedal].paramId, sub: 1 };
    case 'expMax':
      return { id: EXP_PEDALS[ref.pedal].paramId, sub: 2 };
    case 'ctrlTarget':
      return { id: CTRL_PARAM_ID, sub: 0 };
    case 'ctrlFactor':
      return { id: CTRL_PARAM_ID, sub: 1 };
  }
}

/** Reverse of addressOf: which control did the pedal just report? */
export function controlFromAddress(bytes: Uint8Array, id: number, sub: number): ControlRef | undefined {
  if (id === 0x00 && sub < 8) return { kind: 'nameChar', index: sub };
  if (id === STATUS_PARAM_ID) {
    if (sub === CHAIN_SUB) return { kind: 'chain' };
    const key = (Object.keys(STATUS_BITS) as StatusKey[]).find((k) => STATUS_BITS[k].sub === sub);
    return key ? { kind: 'status', key } : undefined;
  }
  if (id === TYPE_PARAM_ID) {
    const slot = SLOT_KEYS.find((s) => EFFECT_SLOTS[s].typeSub === sub);
    if (slot) return { kind: 'effectType', slot };
    for (const ch of ['A', 'B'] as const) {
      if (CHANNELS[ch].ampTypeSub === sub) return { kind: 'ampType', ch };
      if (CHANNELS[ch].cabTypeSub === sub) return { kind: 'cabType', ch };
    }
    return undefined;
  }
  const slot = SLOT_KEYS.find((s) => EFFECT_SLOTS[s].paramId === id);
  if (slot) {
    const def = effectType(slot, bytes[EFFECT_SLOTS[slot].typeByte])?.params.find((p) => p.sub === sub);
    return def ? { kind: 'effectParam', slot, key: def.key } : undefined;
  }
  for (const ch of ['A', 'B'] as const) {
    if (CHANNELS[ch].paramId === id) {
      const def = AMP_PARAMS.find((p) => p.index === sub);
      return def ? { kind: 'ampParam', ch, key: def.key } : undefined;
    }
  }
  for (const pedal of ['exp1', 'exp2'] as const) {
    if (EXP_PEDALS[pedal].paramId === id) {
      return sub === 0 ? { kind: 'expTarget', pedal } : sub === 1 ? { kind: 'expMin', pedal } : sub === 2 ? { kind: 'expMax', pedal } : undefined;
    }
  }
  if (id === CTRL_PARAM_ID) return sub === 0 ? { kind: 'ctrlTarget' } : sub === 1 ? { kind: 'ctrlFactor' } : undefined;
  return undefined;
}

// ----- name -----

export function getName(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes.subarray(0, 8)).replace(/\s+$/, '');
}

/** Names are 8 characters from ASCII ' ' to '_' (so upper case only). */
export function sanitizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\x20-\x5F]/g, ' ')
    .slice(0, 8)
    .padEnd(8, ' ');
}

export function setName(bytes: Uint8Array, name: string): Uint8Array {
  const out = Uint8Array.from(bytes);
  const clean = sanitizeName(name);
  for (let i = 0; i < 8; i++) out[i] = clean.charCodeAt(i);
  return out;
}

// ----- a neutral starting program -----

export function blankProgram(): Uint8Array {
  let b: Uint8Array = new Uint8Array(PROGRAM_SIZE);
  b = setName(b, 'INIT');
  for (const key of ['ampA', 'cabA', 'ampB', 'cabB'] as const) b = write(b, { kind: 'status', key }, 1);
  for (const ch of ['A', 'B'] as const) {
    b = write(b, { kind: 'ampType', ch }, AMP_TYPES.indexOf('AC30TB'));
    b = write(b, { kind: 'cabType', ch }, CAB_TYPES.indexOf('VOX AC30'));
    for (const key of ['gain', 'vrGain', 'treble', 'middle', 'bass', 'presence'] as const) b = write(b, { kind: 'ampParam', ch, key }, 50);
    b = write(b, { kind: 'ampParam', ch, key: 'volume' }, 60);
    b = write(b, { kind: 'ampParam', ch, key: 'nrSens' }, 10);
  }
  for (const slot of SLOT_KEYS) {
    b = write(b, { kind: 'effectType', slot }, 0);
    for (const def of effectType(slot, 0)!.params) b = write(b, { kind: 'effectParam', slot, key: def.key }, Math.round((def.min + def.max) / 2));
  }
  b = write(b, { kind: 'effectParam', slot: 'delay', key: 'time' }, 400);
  b = write(b, { kind: 'expTarget', pedal: 'exp1' }, 0b000001); // volume pedal
  b = write(b, { kind: 'expMax', pedal: 'exp1' }, 100);
  return b;
}
