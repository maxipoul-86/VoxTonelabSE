// The tone engine: request -> (optional research) -> model -> validated ToneRecipe.

import { applyRecipe, newId, type ChannelSettings, type EffectSettings, type GuitarSetup, type PedalSettings, type ToneRecipe } from '../tonelab/recipe';
import { sanitizeName } from '../tonelab/program';
import { SLOT_KEYS } from '../tonelab/spec';
import type { GuitarProfile, RigProfile } from './guitar';
import { RESEARCH_PROMPT, refinePrompt, systemPrompt, userPrompt, type LearnedEdit, type ToneRequest } from './prompt';
import { AiError, callResearch, callTone, type AiSettings } from './providers';
import { toneSchema } from './schema';

export interface EngineContext {
  ai: AiSettings;
  guitar: GuitarProfile;
  rig: RigProfile;
  learned?: LearnedEdit[];
  onStatus?: (text: string) => void;
}

export interface EngineResult {
  recipe: ToneRecipe;
  /** Problems found while turning the answer into a program (values clamped, unknown names). */
  fixes: string[];
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
}

export async function generateTone(req: ToneRequest, ctx: EngineContext, opts: { webSearch?: boolean } = {}): Promise<EngineResult> {
  if (!req.song && !req.artist) throw new AiError('Enter a song or an artist.');
  let research: string | undefined;
  let sources: { title: string; url: string }[] = [];
  if (opts.webSearch ?? ctx.ai.webSearch) {
    ctx.onStatus?.('Searching the web for the original rig…');
    const r = await callResearch(ctx.ai, RESEARCH_PROMPT(req));
    research = r.text;
    sources = r.sources;
  }
  ctx.onStatus?.('Designing the tone…');
  const res = await callTone(ctx.ai, ctx.ai.model, systemPrompt(ctx.guitar, ctx.rig), userPrompt(req, research, ctx.learned), toneSchema(ctx.guitar.kind));
  const recipe = toRecipe(res.input, { request: req, source: 'ai', model: res.model, sources, guitar: ctx.guitar });
  const fixes = applyRecipe(recipe.pedal).warnings;
  return { recipe, fixes, usage: res.usage };
}

/** Small follow-up edit ("brighter", "less gain") with the fast model. */
export async function refineTone(current: ToneRecipe, instruction: string, ctx: EngineContext): Promise<EngineResult> {
  ctx.onStatus?.('Adjusting…');
  const res = await callTone(ctx.ai, ctx.ai.fastModel, systemPrompt(ctx.guitar, ctx.rig), refinePrompt(current, instruction), toneSchema(ctx.guitar.kind));
  const recipe = toRecipe(res.input, {
    request: { ...current.request, notes: [current.request.notes, instruction].filter(Boolean).join(' · ') },
    source: 'ai',
    model: res.model,
    sources: current.sources ?? [],
    parentId: current.id,
    guitar: ctx.guitar,
  });
  return { recipe, fixes: applyRecipe(recipe.pedal).warnings, usage: res.usage };
}

// ----- coercion of model output into a well-formed recipe -----

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function channel(v: any, fallback?: ChannelSettings): ChannelSettings {
  const f = fallback;
  return {
    amp: str(v?.amp) ?? f?.amp ?? 'AC30TB',
    cabinet: str(v?.cabinet) ?? f?.cabinet ?? 'VOX AC30',
    gain: num(v?.gain, f?.gain ?? 5),
    vrGain: num(v?.vrGain, f?.vrGain ?? 5),
    treble: num(v?.treble, f?.treble ?? 5),
    middle: num(v?.middle, f?.middle ?? 5),
    bass: num(v?.bass, f?.bass ?? 5),
    presence: num(v?.presence, f?.presence ?? 5),
    volume: num(v?.volume, f?.volume ?? 6),
    nr: num(v?.nr, f?.nr ?? 2),
  };
}

function effect(v: any): EffectSettings {
  const params: Record<string, number> = {};
  if (v?.params && typeof v.params === 'object') for (const [k, x] of Object.entries(v.params)) if (Number.isFinite(Number(x))) params[k] = Number(x);
  return { on: v?.on === true || v?.on === 'true', type: str(v?.type), params };
}

const knob = (v: unknown, fallback: number) => Math.min(10, Math.max(0, num(v, fallback)));

/** The model's guitar section, shaped for the controls of the guitar it was made for. */
function guitarSetup(g: any, kind: GuitarProfile['kind']): GuitarSetup {
  if (kind === 'piezo') return { kind, volume: knob(g.volume, 10), bass: knob(g.bass, 5), mid: knob(g.mid, 5), treble: knob(g.treble, 5) };
  return {
    kind,
    selector: ['bridge', 'both', 'neck'].includes(g.selector) ? g.selector : 'bridge',
    coils: g.coils === 'single' ? 'single' : 'humbucker',
    volume: knob(g.volume, 10),
    tone: knob(g.tone, 10),
  };
}

export function toRecipe(
  input: any,
  meta: { request: ToneRequest; source: ToneRecipe['source']; guitar: GuitarProfile; model?: string; sources?: { title: string; url: string }[]; parentId?: string },
): ToneRecipe {
  if (!input || typeof input !== 'object' || !input.pedal) throw new AiError('The model answer had no pedal settings. Try again.');
  const p = input.pedal;
  const channelA = channel(p.channelA);
  const pedal: PedalSettings = {
    name: sanitizeName(str(p.name) ?? meta.request.song ?? 'AI TONE').trim() || 'AI TONE',
    chain: str(p.chain),
    activeChannel: p.activeChannel === 'B' ? 'B' : 'A',
    channelA,
    channelB: channel(p.channelB, channelA),
    pedal: effect(p.pedal),
    mod: effect(p.mod),
    delay: effect(p.delay),
    reverb: effect(p.reverb),
    exp1: str(p.exp1),
    exp2: str(p.exp2),
  };
  for (const s of SLOT_KEYS) pedal[s] = pedal[s] ?? { on: false };
  const guitar = guitarSetup(input.guitar ?? {}, meta.guitar.kind);
  const o = input.original ?? {};
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    source: meta.source,
    parentId: meta.parentId,
    request: meta.request,
    original: { guitar: str(o.guitar), amp: str(o.amp), effects: str(o.effects), tuning: str(o.tuning), notes: str(o.notes) },
    pedal,
    guitar,
    guitarId: meta.guitar.id,
    guitarName: meta.guitar.name,
    tips: str(input.tips),
    why: str(input.why),
    confidence: ['low', 'medium', 'high'].includes(input.confidence) ? input.confidence : 'medium',
    warnings: Array.isArray(input.warnings) ? input.warnings.filter((w: unknown) => typeof w === 'string') : [],
    sources: meta.sources ?? [],
    model: meta.model,
  };
}

// ----- learning from "save my version" -----

/** Human-readable list of what changed between an AI recipe and the player's edited version. */
export function diffRecipes(before: PedalSettings, after: PedalSettings): string[] {
  const out: string[] = [];
  for (const ch of ['channelA', 'channelB'] as const) {
    const a = before[ch];
    const b = after[ch];
    if (!a || !b) continue;
    const label = ch === 'channelA' ? 'A' : 'B';
    if (a.amp !== b.amp) out.push(`${label} amp ${a.amp} → ${b.amp}`);
    if (a.cabinet !== b.cabinet) out.push(`${label} cab ${a.cabinet} → ${b.cabinet}`);
    for (const k of ['gain', 'vrGain', 'treble', 'middle', 'bass', 'presence', 'volume', 'nr'] as const) {
      if (Math.abs(a[k] - b[k]) >= 0.2) out.push(`${label} ${k} ${a[k]} → ${b[k]}`);
    }
  }
  for (const s of SLOT_KEYS) {
    const a = before[s];
    const b = after[s];
    if (a.on !== b.on) out.push(`${s} ${b.on ? 'turned on' : 'turned off'}`);
    if (b.on && a.type !== b.type) out.push(`${s} ${a.type} → ${b.type}`);
    if (b.on && a.type === b.type) {
      for (const [k, v] of Object.entries(b.params ?? {})) {
        const old = a.params?.[k];
        if (old !== undefined && Math.abs(old - v) >= 0.2) out.push(`${s} ${k} ${old} → ${v}`);
      }
    }
  }
  return out;
}

export function learnedEdits(library: ToneRecipe[], max = 6): LearnedEdit[] {
  const byId = new Map(library.map((r) => [r.id, r]));
  return library
    .filter((r) => r.source === 'edited' && r.parentId && byId.has(r.parentId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max)
    .map((r) => ({
      label: [r.request.song, r.request.artist, r.request.part].filter(Boolean).join(' / '),
      changes: diffRecipes(byId.get(r.parentId!)!.pedal, r.pedal),
    }))
    .filter((e) => e.changes.length > 0);
}
