import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTone, toRecipe, diffRecipes, learnedEdits } from './engine';
import { systemPrompt, tonelabMenu } from './prompt';
import { DEFAULT_GUITAR, DEFAULT_RIG, GODIN_ACOUSTICASTER, activeGuitar } from './guitar';
import { TONE_SCHEMA, toneSchema } from './schema';
import { applyRecipe, recipeGuitarId } from '../tonelab/recipe';
import { parseSettings } from '../store/storage';

const sample = {
  original: { guitar: 'Gibson SG', amp: 'Marshall Super Lead', effects: 'none', tuning: 'standard' },
  pedal: {
    name: 'Back in black',
    chain: 'M-D-R',
    activeChannel: 'A',
    channelA: { amp: 'UK 68P', cabinet: 'UK T75 4x12', gain: 5.5, vrGain: 5, treble: 6, middle: 7, bass: 5, presence: 6, volume: 7, nr: 3 },
    channelB: { amp: 'UK 68P', cabinet: 'UK T75 4x12', gain: 7, vrGain: 6, treble: 6.5, middle: 7.5, bass: 5, presence: 6.5, volume: 8, nr: 3 },
    pedal: { on: false, type: 'TREBLE BOOST', params: { drive: 5, level: 6, tone: 5 } },
    mod: { on: false, type: 'CLASSIC CHORUS', params: {} },
    delay: { on: false, type: 'ANALOG DELAY', params: { time: 380 } },
    reverb: { on: true, type: 'ROOM 1', params: { time: 3, mix: 2 } },
    exp1: 'VOLUME',
    exp2: 'A/GAIN B',
  },
  guitar: { selector: 'bridge', coils: 'humbucker', volume: 10, tone: 8 },
  tips: 'A for rhythm, B for the solo.',
  why: 'Plexi crunch.',
  confidence: 'high',
  warnings: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('prompt and schema', () => {
  it('lists every effect type with real ranges', () => {
    const menu = tonelabMenu();
    expect(menu).toContain('TREBLE BOOST: drive 1-10');
    expect(menu).toContain('HOLD DELAY: time 1-8000 ms');
    expect(menu).toContain('U-VIBE: speed 1-10 Hz');
    expect(menu).toContain("UK 68P: late-60s Marshall Plexi");
  });
  it('includes the guitar and the rig', () => {
    const p = systemPrompt(DEFAULT_GUITAR, DEFAULT_RIG);
    expect(p).toContain('Pearly Gates');
    expect(p).toContain('tone knob');
    expect(p).toContain('Keep cabinet simulation on');
  });
  it('schema restricts amps to the 16 models', () => {
    expect(TONE_SCHEMA.properties.pedal.properties.channelA.properties.amp.enum).toHaveLength(16);
  });
});

describe('model output coercion', () => {
  it('turns a model answer into a program without fixes', () => {
    const r = toRecipe(sample, { request: { song: 'Back in Black', artist: 'AC/DC' }, source: 'ai', guitar: DEFAULT_GUITAR });
    expect(r.pedal.name).toBe('BACK IN');
    expect(applyRecipe(r.pedal).warnings).toEqual([]);
    expect(r.guitarId).toBe(DEFAULT_GUITAR.id);
  });
  it('survives missing pieces', () => {
    const r = toRecipe({ pedal: { channelA: { amp: 'RECTO' } } }, { request: { artist: 'Metallica' }, source: 'ai', guitar: DEFAULT_GUITAR });
    expect(r.pedal.channelB?.amp).toBe('RECTO');
    expect(r.guitar).toMatchObject({ kind: 'split', selector: 'bridge' });
    expect(r.pedal.reverb.on).toBe(false);
  });
  it('shapes the guitar section for a piezo guitar', () => {
    const r = toRecipe({ ...sample, guitar: { volume: 9, bass: 6, mid: 12, selector: 'neck' } }, { request: { song: 'X' }, source: 'ai', guitar: GODIN_ACOUSTICASTER });
    expect(r.guitar).toEqual({ kind: 'piezo', volume: 9, bass: 6, mid: 10, treble: 5 });
    expect(r.guitarId).toBe(GODIN_ACOUSTICASTER.id);
    expect(r.guitarName).toBe('Godin Acousticaster');
  });
});

describe('guitars', () => {
  it('migrates settings saved with a single guitar', () => {
    const s = parseSettings(JSON.stringify({ guitar: { name: 'My Tele', notes: '11s' }, midiChannel: 4 }));
    expect(s.guitars[0]).toMatchObject({ id: 'tele', kind: 'split', name: 'My Tele', notes: '11s', bridgePickup: DEFAULT_GUITAR.bridgePickup });
    expect(s.guitars.map((g) => g.id)).toEqual(['tele', GODIN_ACOUSTICASTER.id]);
    expect(s.activeGuitarId).toBe('tele');
    expect(s.midiChannel).toBe(4);
    expect('guitar' in s).toBe(false);
  });
  it('remembers the guitar and the Library view between sessions', () => {
    const s = parseSettings(JSON.stringify({ guitars: [DEFAULT_GUITAR, GODIN_ACOUSTICASTER], activeGuitarId: GODIN_ACOUSTICASTER.id, libraryShowAll: true }));
    expect(activeGuitar(s).id).toBe(GODIN_ACOUSTICASTER.id);
    expect(s.libraryShowAll).toBe(true);
  });
  it('keeps saved guitars and falls back when the active one is gone', () => {
    const s = parseSettings(JSON.stringify({ guitars: [GODIN_ACOUSTICASTER], activeGuitarId: 'deleted' }));
    expect(s.guitars).toHaveLength(1);
    expect(activeGuitar(s).id).toBe(GODIN_ACOUSTICASTER.id);
  });
  it('treats recipes without a guitar as made for the first guitar', () => {
    expect(recipeGuitarId({})).toBe('tele');
    expect(recipeGuitarId({ guitarId: GODIN_ACOUSTICASTER.id })).toBe(GODIN_ACOUSTICASTER.id);
  });
  it('asks a piezo guitar for its EQ, not a selector', () => {
    const g = toneSchema('piezo').properties.guitar;
    expect(Object.keys(g.properties)).toEqual(['volume', 'bass', 'mid', 'treble']);
    expect(Object.keys(toneSchema('split').properties.guitar.properties)).toContain('selector');
  });
  it('describes the piezo guitar in the prompt', () => {
    const p = systemPrompt(GODIN_ACOUSTICASTER, DEFAULT_RIG);
    expect(p).toContain('Godin Acousticaster');
    expect(p).toContain('Compensate for the piezo');
    expect(p).toContain('volume 10, bass 5, mid 5, treble 5');
    expect(p).not.toContain('3-way selector');
  });
  it('gives the tested starting ranges for every guitar', () => {
    for (const g of [DEFAULT_GUITAR, GODIN_ACOUSTICASTER]) expect(systemPrompt(g, DEFAULT_RIG)).toContain('STARTING RANGES');
  });
});

describe('settings upgrade', () => {
  it('turns the old on/off web search into "auto" and moves the old default model to Opus', () => {
    const s = parseSettings(JSON.stringify({ ai: { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5', fastModel: 'claude-haiku-5-5', webSearch: false } }));
    expect(s.ai).toEqual({ provider: 'anthropic', apiKey: 'k', model: 'claude-opus-5-5', fastModel: 'claude-haiku-5-5', webSearch: 'auto' });
  });
  it('keeps a model the player chose', () => {
    const s = parseSettings(JSON.stringify({ ai: { provider: 'anthropic', apiKey: 'k', model: 'claude-fable-5-1', fastModel: 'x', webSearch: true } }));
    expect(s.ai.model).toBe('claude-fable-5-1');
    const t = parseSettings(JSON.stringify({ ai: { provider: 'anthropic', apiKey: 'k', model: 'claude-sonnet-5-5', fastModel: 'x', webSearch: 'off' } }));
    expect(t.ai).toMatchObject({ model: 'claude-sonnet-5-5', webSearch: 'off' });
  });
});

describe('generateTone with a mocked Anthropic API', () => {
  it('sends a cached system prompt and parses the tool call', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(body.tools[0].name).toBe('submit_tone');
      expect((init.headers as Record<string, string>)['anthropic-dangerous-direct-browser-access']).toBe('true');
      return new Response(JSON.stringify({ model: body.model, content: [{ type: 'tool_use', name: 'submit_tone', input: sample }], usage: { input_tokens: 100, output_tokens: 50 } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await generateTone(
      { song: 'Back in Black', artist: 'AC/DC', part: 'rhythm + solo' },
      { ai: { provider: 'anthropic', apiKey: 'test', model: 'claude-sonnet-5-5', fastModel: 'claude-haiku-5-5', webSearch: 'off' }, guitar: DEFAULT_GUITAR, rig: DEFAULT_RIG },
    );
    expect(res.recipe.pedal.channelA.amp).toBe('UK 68P');
    expect(res.fixes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses an OpenRouter function call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ model: 'x', choices: [{ message: { tool_calls: [{ function: { name: 'submit_tone', arguments: JSON.stringify(sample) } }] } }] }))),
    );
    const res = await generateTone(
      { artist: 'AC/DC' },
      { ai: { provider: 'openrouter', apiKey: 'k', model: 'anthropic/claude-sonnet-5.5', fastModel: 'x', webSearch: 'off' }, guitar: DEFAULT_GUITAR, rig: DEFAULT_RIG },
    );
    expect(res.recipe.guitar).toMatchObject({ tone: 8 });
  });

  it('sends the piezo schema when the Godin is plugged in', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body.tools[0].input_schema.properties.guitar.properties)).toEqual(['volume', 'bass', 'mid', 'treble']);
      expect(body.system[0].text).toContain('Compensate for the piezo');
      const input = { ...sample, guitar: { volume: 10, bass: 6, mid: 6, treble: 4 } };
      return new Response(JSON.stringify({ model: body.model, content: [{ type: 'tool_use', name: 'submit_tone', input }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await generateTone(
      { song: 'Wagon Wheel' },
      { ai: { provider: 'anthropic', apiKey: 'test', model: 'claude-sonnet-5-5', fastModel: 'claude-haiku-5-5', webSearch: 'off' }, guitar: GODIN_ACOUSTICASTER, rig: DEFAULT_RIG },
    );
    expect(res.recipe.guitar).toEqual({ kind: 'piezo', volume: 10, bass: 6, mid: 6, treble: 4 });
    expect(res.recipe.guitarId).toBe(GODIN_ACOUSTICASTER.id);
  });

  it('searches inside the tone call on "auto" and continues a paused turn', async () => {
    const bodies: any[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (bodies.length === 1) {
        const search = { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://example.com/rig', title: 'Rig rundown' }] };
        return new Response(JSON.stringify({ model: body.model, stop_reason: 'pause_turn', content: [search], usage: { input_tokens: 100, output_tokens: 10 } }));
      }
      return new Response(JSON.stringify({ model: body.model, stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_tone', input: sample }], usage: { input_tokens: 200, output_tokens: 50 } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await generateTone(
      { song: 'La Gaspésie', artist: 'Irvin Blais' },
      { ai: { provider: 'anthropic', apiKey: 'test', model: 'claude-opus-5-5', fastModel: 'claude-haiku-5-5', webSearch: 'auto' }, guitar: DEFAULT_GUITAR, rig: DEFAULT_RIG },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[0].tools.map((t: any) => t.type ?? t.name)).toEqual(['submit_tone', 'web_search_20260209']);
    expect(bodies[0].output_config).toEqual({ effort: 'high' });
    expect(bodies[0].max_tokens).toBe(16000);
    expect(bodies[0].messages[0].content).toContain('Use it only when you are not sure');
    expect(bodies[1].messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(res.recipe.sources).toEqual([{ url: 'https://example.com/rig', title: 'Rig rundown' }]);
    expect(res.usage).toMatchObject({ inputTokens: 300, outputTokens: 60 });
  });

  it('says so when the request is not about a guitar sound', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ model: 'x', stop_reason: 'end_turn', content: [{ type: 'text', text: 'OFF_TOPIC' }] }))));
    await expect(
      generateTone({ song: 'Write my homework' }, { ai: { provider: 'anthropic', apiKey: 'test', model: 'claude-opus-5-5', fastModel: 'x', webSearch: 'auto' }, guitar: DEFAULT_GUITAR, rig: DEFAULT_RIG }),
    ).rejects.toThrow('only makes guitar tones');
  });

  it('sends no search tool when search is off', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.tools).toHaveLength(1);
      expect(body.messages[0].content).not.toContain('WEB SEARCH');
      return new Response(JSON.stringify({ model: body.model, content: [{ type: 'tool_use', name: 'submit_tone', input: sample }] }));
    });
    vi.stubGlobal('fetch', fetchMock);
    await generateTone({ song: 'Back in Black' }, { ai: { provider: 'anthropic', apiKey: 'test', model: 'claude-opus-5-5', fastModel: 'x', webSearch: 'off' }, guitar: DEFAULT_GUITAR, rig: DEFAULT_RIG });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('learning from edits', () => {
  it('lists what the player changed', () => {
    const ai = toRecipe(sample, { request: { song: 'X' }, source: 'ai', guitar: DEFAULT_GUITAR });
    const edited = { ...ai, id: 'e', source: 'edited' as const, parentId: ai.id, createdAt: new Date().toISOString(), pedal: { ...ai.pedal, channelA: { ...ai.pedal.channelA, gain: 4.5, middle: 8 } } };
    expect(diffRecipes(ai.pedal, edited.pedal)).toEqual(['A gain 5.5 → 4.5', 'A middle 7 → 8']);
    expect(learnedEdits([ai, edited])[0].changes).toHaveLength(2);
  });
});
