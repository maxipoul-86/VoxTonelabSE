// A tone recipe is what the tone engine returns and what the library stores.
// Pedal values are in display units (0.0-10.0, Hz, ms) so people and the AI can read them;
// applyRecipe() turns them into a 92-byte program, clamping anything out of range.

import { SCALES, clamp } from './scales';
import {
  AMP_PARAMS,
  AMP_TYPES,
  CAB_TYPES,
  CHAIN_ORDERS,
  EFFECT_SLOTS,
  EXP_FIXED_TARGETS,
  SLOT_KEYS,
  effectType,
  type SlotKey,
} from './spec';
import { blankProgram, getName, read, setName, write, type Channel } from './program';
import { FIRST_GUITAR_ID } from '../ai/guitar';

export type AmpName = (typeof AMP_TYPES)[number];
export type CabName = (typeof CAB_TYPES)[number];
export type ChainOrder = (typeof CHAIN_ORDERS)[number];

export interface ChannelSettings {
  amp: string;
  cabinet: string;
  gain: number;
  vrGain: number;
  treble: number;
  middle: number;
  bass: number;
  presence: number;
  volume: number;
  /** 0 = off, otherwise 0.2-10.0 */
  nr: number;
}

export interface EffectSettings {
  on: boolean;
  type?: string;
  /** Parameter key -> display value (see the spec tables). Enums take their label index. */
  params?: Record<string, number>;
}

export interface PedalSettings {
  name: string;
  chain?: string;
  activeChannel?: Channel;
  channelA: ChannelSettings;
  channelB?: ChannelSettings;
  pedal: EffectSettings;
  mod: EffectSettings;
  delay: EffectSettings;
  reverb: EffectSettings;
  /** Expression pedal 1 target label. Kept for reading programs; applyRecipe always uses EXP1_TARGET. */
  exp1?: string;
  /** Expression pedal 2 target label, e.g. "P/MANUAL". Left as is when absent. */
  exp2?: string;
}

/** EXP 1 is the volume pedal in every tone, so it never changes from song to song. */
export const EXP1_TARGET = 'VOLUME';

export type Selector = 'bridge' | 'both' | 'neck';
export type Coils = 'humbucker' | 'single';

/** Magnetic pickups with a selector and coil split. `kind` is absent on recipes saved before piezo guitars existed. */
export interface SplitSetup {
  kind?: 'split';
  selector: Selector;
  coils: Coils;
  volume: number;
  tone: number;
}

/** Piezo with volume and a 3-band EQ (5 = flat). */
export interface PiezoSetup {
  kind: 'piezo';
  volume: number;
  bass: number;
  mid: number;
  treble: number;
}

export type GuitarSetup = SplitSetup | PiezoSetup;

export const defaultSetup = (kind: 'split' | 'piezo'): GuitarSetup =>
  kind === 'piezo' ? { kind, volume: 10, bass: 5, mid: 5, treble: 5 } : { kind, selector: 'bridge', coils: 'humbucker', volume: 10, tone: 10 };

export interface ToneRecipe {
  id: string;
  createdAt: string;
  source: 'ai' | 'edited' | 'captured' | 'manual';
  /** For an edited recipe, the recipe it came from. */
  parentId?: string;
  request: { song?: string; artist?: string; part?: string; notes?: string };
  original?: { guitar?: string; amp?: string; effects?: string; tuning?: string; notes?: string };
  pedal: PedalSettings;
  guitar: GuitarSetup;
  /** The guitar this tone was made for; absent = the first guitar (FIRST_GUITAR_ID). */
  guitarId?: string;
  guitarName?: string;
  tips?: string;
  why?: string;
  confidence?: 'low' | 'medium' | 'high';
  warnings?: string[];
  sources?: { title: string; url: string }[];
  model?: string;
}

export const recipeGuitarId = (r: Pick<ToneRecipe, 'guitarId'>) => r.guitarId ?? FIRST_GUITAR_ID;

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
function findIndex(list: readonly string[], name: string | undefined): number {
  if (!name) return -1;
  const n = norm(name);
  return list.findIndex((x) => norm(x) === n);
}

const CHANNEL_KEYS: { key: keyof ChannelSettings; amp: (typeof AMP_PARAMS)[number]['key'] }[] = [
  { key: 'gain', amp: 'gain' },
  { key: 'vrGain', amp: 'vrGain' },
  { key: 'treble', amp: 'treble' },
  { key: 'middle', amp: 'middle' },
  { key: 'bass', amp: 'bass' },
  { key: 'presence', amp: 'presence' },
  { key: 'volume', amp: 'volume' },
  { key: 'nr', amp: 'nrSens' },
];

export interface ApplyResult {
  bytes: Uint8Array;
  warnings: string[];
}

/** Recipe pedal settings -> program bytes, starting from `base` so unspecified bytes are kept. */
export function applyRecipe(pedal: PedalSettings, base: Uint8Array = blankProgram()): ApplyResult {
  const warnings: string[] = [];
  let b = setName(base, pedal.name || 'AI TONE');

  if (pedal.chain) {
    const i = findIndex(CHAIN_ORDERS, pedal.chain);
    if (i >= 0) b = write(b, { kind: 'chain' }, i);
    else warnings.push(`Unknown chain order "${pedal.chain}", kept ${CHAIN_ORDERS[read(b, { kind: 'chain' })]}.`);
  }

  const channels: [Channel, ChannelSettings | undefined][] = [
    ['A', pedal.channelA],
    ['B', pedal.channelB ?? pedal.channelA],
  ];
  for (const [ch, s] of channels) {
    if (!s) continue;
    const amp = findIndex(AMP_TYPES, s.amp);
    if (amp >= 0) b = write(b, { kind: 'ampType', ch }, amp);
    else warnings.push(`Channel ${ch}: unknown amp "${s.amp}", kept ${AMP_TYPES[read(b, { kind: 'ampType', ch })]}.`);
    const cab = findIndex(CAB_TYPES, s.cabinet);
    if (cab >= 0) b = write(b, { kind: 'cabType', ch }, cab);
    else warnings.push(`Channel ${ch}: unknown cabinet "${s.cabinet}", kept ${CAB_TYPES[read(b, { kind: 'cabType', ch })]}.`);
    b = write(b, { kind: 'status', key: ch === 'A' ? 'ampA' : 'ampB' }, 1);
    b = write(b, { kind: 'status', key: ch === 'A' ? 'cabA' : 'cabB' }, 1); // Line out to a PA: cabinet always on
    for (const { key, amp: ampKey } of CHANNEL_KEYS) {
      const value = s[key];
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      const def = AMP_PARAMS.find((p) => p.key === ampKey)!;
      const raw = SCALES[def.scale].toRaw(value);
      if (raw < def.min || raw > def.max) warnings.push(`Channel ${ch} ${def.label} ${value} is out of range, clamped.`);
      b = write(b, { kind: 'ampParam', ch, key: ampKey }, clamp(raw, def.min, def.max));
    }
  }
  b = write(b, { kind: 'status', key: 'channelB' }, pedal.activeChannel === 'B' ? 1 : 0);

  for (const slot of SLOT_KEYS) {
    const fx = pedal[slot];
    if (!fx) continue;
    b = write(b, { kind: 'status', key: slot }, fx.on ? 1 : 0);
    if (fx.type) {
      const t = findIndex(EFFECT_SLOTS[slot].types.map((x) => x.name), fx.type);
      if (t >= 0) b = write(b, { kind: 'effectType', slot }, t);
      else warnings.push(`${EFFECT_SLOTS[slot].label}: unknown type "${fx.type}", kept the current one.`);
    }
    const typeDef = effectType(slot, read(b, { kind: 'effectType', slot }))!;
    for (const [key, value] of Object.entries(fx.params ?? {})) {
      const def = typeDef.params.find((p) => p.key === key);
      if (!def) {
        warnings.push(`${typeDef.name}: no parameter "${key}", ignored.`);
        continue;
      }
      if (typeof value !== 'number' || Number.isNaN(value)) continue;
      const raw = SCALES[def.scale].toRaw(value);
      if (raw < def.min || raw > def.max) warnings.push(`${typeDef.name} ${def.label} ${value} is out of range, clamped.`);
      b = write(b, { kind: 'effectParam', slot, key }, clamp(raw, def.min, def.max));
    }
  }

  // EXP 1 is always the volume pedal, whatever the recipe says; EXP 2 follows the tone.
  const expLabels = { exp1: EXP1_TARGET, exp2: pedal.exp2 };
  for (const pedalKey of ['exp1', 'exp2'] as const) {
    const label = expLabels[pedalKey];
    if (!label) continue;
    const code = expTargetCode(b, label);
    if (code === undefined) {
      warnings.push(`${pedalKey.toUpperCase()}: unknown target "${label}", kept the current one.`);
      continue;
    }
    b = write(b, { kind: 'expTarget', pedal: pedalKey }, code);
    const range = expTargetRange(b, code);
    b = write(b, { kind: 'expMin', pedal: pedalKey }, range.min);
    b = write(b, { kind: 'expMax', pedal: pedalKey }, range.max);
  }

  return { bytes: b, warnings };
}

/** Program bytes -> recipe pedal settings in display units (for "save my version"). */
export function readRecipe(bytes: Uint8Array): PedalSettings {
  const channel = (ch: Channel): ChannelSettings => {
    const s: Record<string, number | string> = {
      amp: AMP_TYPES[read(bytes, { kind: 'ampType', ch })] ?? 'AC30',
      cabinet: CAB_TYPES[read(bytes, { kind: 'cabType', ch })] ?? 'VOX AC30',
    };
    for (const { key, amp } of CHANNEL_KEYS) {
      const def = AMP_PARAMS.find((p) => p.key === amp)!;
      s[key] = round2(SCALES[def.scale].toDisplay(read(bytes, { kind: 'ampParam', ch, key: amp })));
    }
    return s as unknown as ChannelSettings;
  };
  const fx = (slot: SlotKey): EffectSettings => {
    const t = effectType(slot, read(bytes, { kind: 'effectType', slot }));
    const params: Record<string, number> = {};
    for (const def of t?.params ?? []) params[def.key] = round2(SCALES[def.scale].toDisplay(read(bytes, { kind: 'effectParam', slot, key: def.key })));
    return { on: read(bytes, { kind: 'status', key: slot }) === 1, type: t?.name, params };
  };
  return {
    name: getName(bytes),
    chain: CHAIN_ORDERS[read(bytes, { kind: 'chain' })],
    activeChannel: read(bytes, { kind: 'status', key: 'channelB' }) ? 'B' : 'A',
    channelA: channel('A'),
    channelB: channel('B'),
    pedal: fx('pedal'),
    mod: fx('mod'),
    delay: fx('delay'),
    reverb: fx('reverb'),
    exp1: expTargetLabel(bytes, read(bytes, { kind: 'expTarget', pedal: 'exp1' })),
    exp2: expTargetLabel(bytes, read(bytes, { kind: 'expTarget', pedal: 'exp2' })),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ----- expression pedal targets (TABLE 1-7) -----

/** All targets valid for the program's current effect types. */
export function expTargets(bytes: Uint8Array): { code: number; label: string }[] {
  const list: { code: number; label: string }[] = [];
  for (const [code, t] of Object.entries(EXP_FIXED_TARGETS)) list.push({ code: Number(code), label: t.label });
  const prefixLetter: Record<SlotKey, string> = { pedal: 'P', mod: 'M', delay: 'D', reverb: 'R' };
  for (const slot of SLOT_KEYS) {
    const t = effectType(slot, read(bytes, { kind: 'effectType', slot }));
    for (const def of t?.params ?? []) {
      if (def.exp !== undefined) list.push({ code: def.exp, label: `${prefixLetter[slot]}/${def.label.toUpperCase()}` });
    }
  }
  return list.sort((a, b) => a.code - b.code);
}

export function expTargetLabel(bytes: Uint8Array, code: number): string {
  return expTargets(bytes).find((t) => t.code === code)?.label ?? `#${code.toString(2).padStart(6, '0')}`;
}

export function expTargetCode(bytes: Uint8Array, label: string): number | undefined {
  const n = norm(label);
  return expTargets(bytes).find((t) => norm(t.label) === n)?.code;
}

export function expTargetRange(bytes: Uint8Array, code: number): { min: number; max: number } {
  const fixed = EXP_FIXED_TARGETS[code];
  if (fixed) return { min: fixed.min, max: fixed.max };
  for (const slot of SLOT_KEYS) {
    const t = effectType(slot, read(bytes, { kind: 'effectType', slot }));
    const def = t?.params.find((p) => p.exp === code);
    if (def) return { min: def.min, max: def.max };
  }
  return { min: 0, max: 100 };
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
