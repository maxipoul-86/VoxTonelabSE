// Prompt text for the tone engine. The system prompt is large and stable (the Tonelab menu,
// the guitar, the rig), so it is sent as a cacheable block.

import { SCALES } from '../tonelab/scales';
import { AMP_NOTES, AMP_TYPES, CAB_TYPES, CHAIN_ORDERS, EFFECT_SLOTS, SLOT_KEYS, type ParamDef } from '../tonelab/spec';
import type { ToneRecipe } from '../tonelab/recipe';
import type { GuitarProfile, RigProfile } from './guitar';
import { OFF_TOPIC, TOOL_NAME } from './schema';

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
    ? 'Compensate for the piezo. It has no magnetic pickups: it is bright and percussive with less output and sustain, and high gain turns harsh and fizzy. The player keeps the guitar\'s preamp flat (volume 10, bass 5, mid 5, treble 5) for every song, so always answer those values and do all the shaping on the Tonelab: about 1 point less gain than for humbuckers, treble and presence around 4.5, middle 7.5-8, channel volume around 8.5-9, and consider COMP for sustain. When the original sound depends on magnetic-pickup character (heavy distortion, feedback, pickup switching), say so in warnings.'
    : 'Compensate for pickups. Humbuckers are hotter than single coils: if the original used single coils, either set coils "single" (tone knob pulled) or keep humbuckers and lower gain about 1-2 points. When you choose "single", raise gain or channel volume a little to make up for the lower output. Guitar volume 10; tone 8 on the bridge, 7 on both or neck for clean parts, 9 for an extra-bright part.';
}

/** Ranges from tones the player tested on this rig; keeps levels consistent from song to song. */
const STARTING_RANGES = `STARTING RANGES THAT WORK ON THIS RIG (tested by the player; stay inside them unless the original clearly needs more, and say why)
- Gain: clean 2.5-4.5, crunch 5-6.5, lead or chorus B 6-7.5. vrGain about 5 clean, up to 7 with gain.
- Treble 6-7, presence about 6, bass 4.5-5, middle 5-6.5 on A and about 1 point more on B.
- Channel volume: clean channels 8.5-9, crunch 7.5-8. Lower volumes sound far too quiet next to the other songs.
- nr: 2 on clean channels, 2.4 with gain; it stops feedback building between notes.
- COMP: sens 3-3.5, level 5, attack 6. Higher sens with a loud clean channel feeds back.
- Effects stay subtle in a live mix: reverb mix 1.5-2.5; slapback delay 100-140 ms, feedback 1, mix 1.5-2.5; longer delays (350-400 ms) feedback 2-3, mix 2-2.5; chorus mix 3-5.`;

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
- Channel A is always the rhythm sound of the verse. Channel B is the lead sound when the song has a guitar solo or lead part (often a bit more gain, middle and volume); otherwise it is the chorus sound (usually a little bigger: more gain or volume). Keep A active, and say in tips what B is for.
- Balance channel volumes so switching A/B does not jump unless a lead boost is intended.
- Use effects only when the original has them; set "on": false for unused slots but still pick a sensible type.
- Delay time in ms; match the song tempo when you know it.
- Name: max 8 characters, upper case.
- Things the pedal cannot do (alternate tunings, octave/doubled studio parts, a specific pedal it lacks) go in warnings with a practical suggestion, e.g. "Tune down a half step".
- Confidence: high only for well-documented famous tones.
- Write the text for the player (original, tips, why, warnings) in French. Keep amp, cabinet and effect names, parameter keys and the program name exactly as listed. Keep control and effect words in English as on the pedal, the way Québec guitarists say them: gain, treble, middle, bass, presence, volume, reverb, delay, chorus, tremolo, compressor (e.g. "un peu moins de treble", "plus de reverb", "le delay").
- Only make guitar tones. If the request (song, artist, notes or adjustment) asks for anything other than a guitar sound, do not search and do not call any tool: answer exactly ${OFF_TOPIC}. A song without much guitar is still a tone request: make the closest guitar sound and say so in warnings.
- Otherwise answer ONLY by calling the ${TOOL_NAME} tool. No other text.

${STARTING_RANGES}

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

const SEARCH_TEXT = {
  off: '',
  auto: `WEB SEARCH: you have a web_search tool. Use it only when you are not sure how the original was recorded (a less-known song, a regional or French-language artist, a specific live version). Skip it for well-documented tones you know. Look for rig rundowns, interviews and gear articles, prefer what you find over memory when they conflict, then answer with ${TOOL_NAME}.`,
  always: `WEB SEARCH: before answering, use the web_search tool to find how this sound was made (rig rundowns, interviews, gear articles). Prefer what you find over memory when they conflict, then answer with ${TOOL_NAME}.`,
} as const;

export function userPrompt(req: ToneRequest, opts: { research?: string; search?: keyof typeof SEARCH_TEXT; learned?: LearnedEdit[] } = {}): string {
  const { research, search = 'off', learned = [] } = opts;
  const what = [req.song && `Song: ${req.song}`, req.artist && `Artist/band: ${req.artist}`, req.part && `Part: ${req.part}`, req.notes && `Notes from the player: ${req.notes}`]
    .filter(Boolean)
    .join('\n');
  const parts = [`Program the Tonelab SE for this sound.\n${what}`];
  if (SEARCH_TEXT[search]) parts.push(SEARCH_TEXT[search]);
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
