// Prompt text for the tone engine. The system prompt is large and stable (the Tonelab menu,
// the guitar, the rig), so it is sent as a cacheable block.

import { SCALES } from '../tonelab/scales';
import { AMP_NOTES, AMP_TYPES, CAB_TYPES, CHAIN_ORDERS, EFFECT_SLOTS, SLOT_KEYS, type ParamDef } from '../tonelab/spec';
import type { ToneRecipe } from '../tonelab/recipe';
import type { GuitarProfile, RigProfile } from './guitar';
import { TOOL_NAME } from './schema';

function range(def: ParamDef): string {
  if (def.options) return def.options.map((o, i) => `${i}=${o}`).join(', ');
  const s = SCALES[def.scale];
  const lo = s.toDisplay(def.min);
  const hi = s.toDisplay(def.max);
  const unit = s.unit ? ` ${s.unit}` : '';
  return `${lo}-${hi}${unit}`;
}

export function tonelabMenu(): string {
  const lines: string[] = [];
  lines.push('AMPS (16; each program has channel A and channel B, each with its own amp, cabinet and knobs):');
  for (const a of AMP_TYPES) lines.push(`- ${a}: ${AMP_NOTES[a]}`);
  lines.push('', `CABINETS: ${CAB_TYPES.join(', ')}`);
  lines.push('Amp knobs (gain, vrGain = Valve Reactor gain, treble, middle, bass, presence, volume): 0.0-10.0. nr = noise reduction 0 (off) or 0.2-10.0.');
  lines.push('', `CHAIN (order of modulation M, delay D, reverb R after the amp): ${CHAIN_ORDERS.join(', ')}`);
  for (const slot of SLOT_KEYS) {
    const s = EFFECT_SLOTS[slot];
    lines.push('', `${s.label.toUpperCase()} EFFECTS (slot "${slot}"), parameter keys and ranges:`);
    for (const t of s.types) lines.push(`- ${t.name}: ${t.params.map((p) => `${p.key} ${range(p)}`).join('; ')}`);
  }
  lines.push('', 'Enum parameters take the number shown (e.g. order 0=PRE, 1=POST). Use the parameter keys exactly as written.');
  lines.push('EXPRESSION PEDAL TARGETS: OFF, VOLUME, A/GAIN A, A/GAIN B, A/VRGN A, A/VRGN B, D/INPUT, R/INPUT, or "<P|M|D|R>/<PARAM LABEL>" for a parameter of the chosen effect (e.g. P/MANUAL for VOX WAH, M/SPEED).');
  return lines.join('\n');
}

function guitarLines(guitar: GuitarProfile): string {
  const lines =
    guitar.kind === 'piezo'
      ? [guitar.name, `Pickup: ${guitar.pickup}`, `Controls: ${guitar.controls}`]
      : [
          guitar.name,
          `Bridge: ${guitar.bridgePickup}`,
          `Neck: ${guitar.neckPickup}`,
          `3-way selector: ${guitar.selector.bridge} = bridge, ${guitar.selector.both} = both, ${guitar.selector.neck} = neck`,
          guitar.coilSplit,
        ];
  if (guitar.notes) lines.push(`Notes: ${guitar.notes}`);
  return lines.map((l) => `- ${l}\n`).join('');
}

function pickupRule(guitar: GuitarProfile): string {
  return guitar.kind === 'piezo'
    ? 'Compensate for the piezo. It has no magnetic pickups: it is bright and percussive with less output and sustain, and high gain turns harsh and fizzy. Keep gain moderate, lower treble and presence about 1-2 points, add a little middle, raise channel volume, and consider COMP for sustain. Use the guitar\'s own EQ (bass, mid, treble; 5 = flat) to warm it up, usually treble below 5. When the original sound depends on magnetic-pickup character (heavy distortion, feedback, pickup switching), say so in warnings.'
    : 'Compensate for pickups. Humbuckers are hotter than single coils: if the original used single coils, either set coils "single" (tone knob pulled) or keep humbuckers and lower gain about 1-2 points. When you choose "single", raise gain or channel volume a little to make up for the lower output.';
}

export function systemPrompt(guitar: GuitarProfile, rig: RigProfile): string {
  return `You are a guitar tone expert who programs a VOX Tonelab SE modelling pedal (2004) to recreate the guitar sound of a given song or artist.

Work in two steps:
1. ORIGINAL: recall how the sound was made: guitar and pickups, amp and how hard it was driven, effects, tuning, studio notes. Only state what you actually know; say "unknown" or "likely ..." otherwise. Never invent gear.
2. TRANSLATE to this player's rig with the closest Tonelab models and settings.

THE PLAYER'S GUITAR
${guitarLines(guitar)}
THE RIG
- ${rig.description}
- Output Select is ${rig.output}. ${rig.output === 'Line' ? 'Keep cabinet simulation on for both channels and set levels for a PA, not for a guitar amp speaker.' : 'The pedal feeds a guitar amp.'}

RULES
- ${pickupRule(guitar)}
- If the song has a rhythm and a lead sound, put rhythm on channel A and lead on channel B (often a bit more gain, middle and volume) and say so in tips. Otherwise make B a useful variation (e.g. a boosted lead) and keep A active.
- Balance channel volumes so switching A/B does not jump unless a lead boost is intended.
- Use effects only when the original has them; set "on": false for unused slots but still pick a sensible type.
- Delay time in ms; match the song tempo when you know it.
- Name: max 8 characters, upper case.
- Things the pedal cannot do (alternate tunings, octave/doubled studio parts, a specific pedal it lacks) go in warnings with a practical suggestion, e.g. "Tune down a half step".
- Confidence: high only for well-documented famous tones.
- Answer ONLY by calling the ${TOOL_NAME} tool. No other text.

TONELAB SE MENU
${tonelabMenu()}`;
}

export interface ToneRequest {
  song?: string;
  artist?: string;
  part?: string;
  notes?: string;
}

/** A short "what the player changed" summary from past edits, so habits carry over. */
export interface LearnedEdit {
  label: string;
  changes: string[];
}

export function userPrompt(req: ToneRequest, research?: string, learned: LearnedEdit[] = []): string {
  const what = [req.song && `Song: ${req.song}`, req.artist && `Artist/band: ${req.artist}`, req.part && `Part: ${req.part}`, req.notes && `Notes from the player: ${req.notes}`]
    .filter(Boolean)
    .join('\n');
  const parts = [`Program the Tonelab SE for this sound.\n${what}`];
  if (research) parts.push(`RESEARCH NOTES (from a web search; prefer these over memory when they conflict):\n${research}`);
  if (learned.length) {
    parts.push(
      `HOW THIS PLAYER ADJUSTED EARLIER SUGGESTIONS (apply the same tendencies when they fit):\n${learned
        .map((l) => `- ${l.label}: ${l.changes.join('; ')}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

export function refinePrompt(current: ToneRecipe, instruction: string): string {
  return `Here is the current Tonelab SE recipe for ${current.request.song ?? current.request.artist ?? 'this sound'} as JSON:
${JSON.stringify({ original: current.original, pedal: current.pedal, guitar: current.guitar }, null, 1)}

The player asks: "${instruction}"

Return the full updated recipe with the ${TOOL_NAME} tool. Change only what the request needs; keep everything else identical.`;
}

export const RESEARCH_PROMPT = (req: ToneRequest) =>
  `Find how the guitar sound was made for: ${[req.song, req.artist, req.part].filter(Boolean).join(' - ')}.
Search for rig rundowns, interviews and gear articles. Report in short bullet points: guitar and pickups, amp and settings, effects (with settings if known), tuning, studio details, tempo. Mark anything uncertain. Keep it under 200 words.`;
