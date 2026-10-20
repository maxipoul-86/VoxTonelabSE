// JSON schema for the tone engine's answer (the submit_tone tool input).
// Amp, cabinet and effect types are enums so the model can only pick what the Tonelab SE has.

import { AMP_TYPES, CAB_TYPES, CHAIN_ORDERS, EFFECT_SLOTS, SLOT_KEYS } from '../tonelab/spec';
import type { GuitarKind } from './guitar';

const knob = { type: 'number', minimum: 0, maximum: 10 } as const;

const channel = {
  type: 'object',
  properties: {
    amp: { type: 'string', enum: [...AMP_TYPES] },
    cabinet: { type: 'string', enum: [...CAB_TYPES] },
    gain: knob,
    vrGain: { ...knob, description: 'Valve Reactor gain' },
    treble: knob,
    middle: knob,
    bass: knob,
    presence: knob,
    volume: { ...knob, description: 'Channel volume; balance A and B so switching does not jump in level' },
    nr: { ...knob, description: 'Noise reduction sensitivity, 0 = off' },
  },
  required: ['amp', 'cabinet', 'gain', 'vrGain', 'treble', 'middle', 'bass', 'presence', 'volume', 'nr'],
  additionalProperties: false,
};

const effect = (slot: (typeof SLOT_KEYS)[number]) => ({
  type: 'object',
  properties: {
    on: { type: 'boolean' },
    type: { type: 'string', enum: EFFECT_SLOTS[slot].types.map((t) => t.name) },
    params: {
      type: 'object',
      description: 'Parameter key -> value in display units, keys and ranges exactly as listed for the chosen type',
      additionalProperties: { type: 'number' },
    },
  },
  required: ['on', 'type', 'params'],
  additionalProperties: false,
});

const splitGuitar = {
  type: 'object',
  properties: {
    selector: { type: 'string', enum: ['bridge', 'both', 'neck'] },
    coils: { type: 'string', enum: ['humbucker', 'single'] },
    volume: knob,
    tone: knob,
  },
  required: ['selector', 'coils', 'volume', 'tone'],
  additionalProperties: false,
} as const;

const piezoGuitar = {
  type: 'object',
  description: "Settings for the guitar's onboard preamp; EQ 5 = flat",
  properties: {
    volume: knob,
    bass: knob,
    mid: knob,
    treble: knob,
  },
  required: ['volume', 'bass', 'mid', 'treble'],
  additionalProperties: false,
} as const;

/** The tool schema; the guitar section follows the player's guitar controls. */
export const toneSchema = <K extends GuitarKind>(kind: K) => ({
  type: 'object',
  properties: {
    original: {
      type: 'object',
      description: 'The original recorded sound, as far as known',
      properties: {
        guitar: { type: 'string' },
        amp: { type: 'string' },
        effects: { type: 'string' },
        tuning: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['guitar', 'amp', 'effects', 'tuning'],
      additionalProperties: false,
    },
    pedal: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Program name, max 8 characters, upper case A-Z 0-9 space' },
        chain: { type: 'string', enum: [...CHAIN_ORDERS], description: 'Order of modulation (M), delay (D), reverb (R)' },
        activeChannel: { type: 'string', enum: ['A', 'B'] },
        channelA: channel,
        channelB: channel,
        pedal: effect('pedal'),
        mod: effect('mod'),
        delay: effect('delay'),
        reverb: effect('reverb'),
        exp2: { type: 'string', description: 'Expression pedal 2 target label, e.g. P/MANUAL for a wah, A/GAIN B, or OFF. Pedal 1 is always the volume pedal.' },
      },
      required: ['name', 'chain', 'activeChannel', 'channelA', 'channelB', 'pedal', 'mod', 'delay', 'reverb', 'exp2'],
      additionalProperties: false,
    },
    guitar: (kind === 'piezo' ? piezoGuitar : splitGuitar) as K extends 'piezo' ? typeof piezoGuitar : typeof splitGuitar,
    tips: { type: 'string', description: 'Short playing tips, e.g. which channel for which part' },
    why: { type: 'string', description: 'Why these settings match the original, in 2-4 sentences' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Things the pedal cannot reproduce, e.g. alternate tuning' },
  },
  required: ['original', 'pedal', 'guitar', 'tips', 'why', 'confidence', 'warnings'],
  additionalProperties: false,
}) as const;

export const TONE_SCHEMA = toneSchema('split');
export type ToneSchema = ReturnType<typeof toneSchema>;

export const TOOL_NAME = 'submit_tone';
export const TOOL_DESCRIPTION = 'Submit the Tonelab SE program and guitar setup for the requested sound.';
