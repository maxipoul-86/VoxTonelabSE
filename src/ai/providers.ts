// Provider adapters. Both return the parsed submit_tone input plus usage info.
// Anthropic: called directly from the browser (personal use; the key stays in this device's storage).
// OpenRouter: OpenAI-compatible chat completions with function calling.

import { OFF_TOPIC, TONE_SCHEMA, TOOL_DESCRIPTION, TOOL_NAME, type ToneSchema } from './schema';

export type ProviderId = 'anthropic' | 'openrouter';

/** off = never search; auto = the model searches when it is unsure of the original rig; always = search every time. */
export type WebSearchMode = 'off' | 'auto' | 'always';

export interface AiSettings {
  provider: ProviderId;
  apiKey: string;
  /** Model for new tones. */
  model: string;
  /** Cheaper model for small follow-up edits. */
  fastModel: string;
  /** Web search for the original rig (costs extra when it runs). OpenRouter has no "auto": it searches only on "always". */
  webSearch: WebSearchMode;
}

export const DEFAULT_MODELS: Record<ProviderId, { model: string; fastModel: string }> = {
  anthropic: { model: 'claude-opus-5-5', fastModel: 'claude-haiku-5-5' },
  // OpenRouter ids follow "vendor/model"; check openrouter.ai/models for the exact current names.
  openrouter: { model: 'anthropic/claude-opus-5.5', fastModel: 'anthropic/claude-haiku-5.5' },
};

/** Options for one tone call. */
export interface ToneOptions {
  /** Thinking depth; left to the model's default when unset. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Give the model the web search tool in the same call (Anthropic only). */
  webSearch?: boolean;
}

export interface CallResult {
  input: unknown;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
  sources: { title: string; url: string }[];
  text?: string;
}

export class AiError extends Error {}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Models that take the newer web search tool (better result filtering); older ones get the basic one. */
const NEW_SEARCH_MODELS = /^claude-(opus-(5|4-[678])|sonnet-(5|4-6)|fable-5)/;
const webSearchTool = (model: string) => ({ type: NEW_SEARCH_MODELS.test(model) ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: 3 });
/** A long search can pause the turn; it is continued this many times at most. */
const MAX_CONTINUES = 3;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    throw new AiError(`Could not reach the AI service (${(e as Error).message}). Check the internet connection.`);
  }
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const msg = json?.error?.message ?? text.slice(0, 300);
    if (res.status === 401) throw new AiError('The API key was rejected. Check it in Settings.');
    throw new AiError(`AI request failed (${res.status}): ${msg}`);
  }
  return json;
}

function anthropicHeaders(key: string) {
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    // Required for calls straight from a browser page.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** The model answered in text: either the off-topic marker, or a tone written as JSON. */
function inputFromText(text: string): unknown {
  if (text.includes(OFF_TOPIC)) throw new AiError('This assistant only makes guitar tones for the Tonelab. Enter a song, an artist or a sound.');
  return jsonFromText(text);
}

/** Tries to read JSON when a model answered in text instead of calling the tool. */
function jsonFromText(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try {
    return JSON.parse(m[0]);
  } catch {
    return undefined;
  }
}

// ---------------- Anthropic ----------------

/** Pages the model read or cited, from web search result blocks and text citations. */
function searchSources(blocks: any[]): { title: string; url: string }[] {
  const sources = new Map<string, string>();
  for (const b of blocks) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.set(r.url, r.title ?? r.url);
    if (b.type === 'text') for (const c of b.citations ?? []) if (c.url) sources.set(c.url, c.title ?? c.url);
  }
  return [...sources].map(([url, title]) => ({ url, title })).slice(0, 8);
}

async function anthropicTone(s: AiSettings, model: string, system: string, user: string, schema: ToneSchema, opts: ToneOptions): Promise<CallResult> {
  const headers = anthropicHeaders(s.apiKey);
  const tools: unknown[] = [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: schema }];
  if (opts.webSearch) tools.push(webSearchTool(model));
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: user }];
  const blocks: any[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let json: any;
  // A search-heavy turn can stop with pause_turn; sending the partial answer back continues it.
  for (let i = 0; ; i++) {
    json = await post(ANTHROPIC_URL, headers, {
      model,
      max_tokens: 16000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools,
      // Forced tool choice is rejected by current models; "auto" + the instruction in the prompt.
      tool_choice: { type: 'auto' },
      ...(opts.effort && { output_config: { effort: opts.effort } }),
      messages,
    });
    blocks.push(...(json.content ?? []));
    usage.inputTokens += json.usage?.input_tokens ?? 0;
    usage.outputTokens += json.usage?.output_tokens ?? 0;
    usage.cacheReadTokens += json.usage?.cache_read_input_tokens ?? 0;
    if (json.stop_reason !== 'pause_turn' || i >= MAX_CONTINUES) break;
    messages.push({ role: 'assistant', content: json.content });
  }
  if (json.stop_reason === 'refusal') throw new AiError('The model declined this request. Try wording it differently.');
  if (json.stop_reason === 'max_tokens') throw new AiError('The answer was cut off before the tone was complete. Try again.');
  const call = blocks.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const input = call?.input ?? inputFromText(text);
  if (!input) throw new AiError('The model did not return a tone. Try again.');
  return { input, model: json.model ?? model, usage, sources: searchSources(blocks) };
}

// ---------------- OpenRouter ----------------

function openrouterHeaders(key: string) {
  return {
    Authorization: `Bearer ${key}`,
    'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'http://localhost',
    'X-Title': 'Tonelab SE Tone Assistant',
  };
}

async function openrouterTone(s: AiSettings, model: string, system: string, user: string, schema: ToneSchema): Promise<CallResult> {
  const json = await post(OPENROUTER_URL, openrouterHeaders(s.apiKey), {
    model,
    max_tokens: 16000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    tools: [{ type: 'function', function: { name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: schema } }],
    tool_choice: 'auto',
  });
  const msg = json.choices?.[0]?.message ?? {};
  const call = (msg.tool_calls ?? []).find((c: any) => c.function?.name === TOOL_NAME);
  let input: unknown;
  if (call) {
    try {
      input = JSON.parse(call.function.arguments);
    } catch {
      throw new AiError('The model returned a malformed tone. Try again.');
    }
  } else {
    input = inputFromText(typeof msg.content === 'string' ? msg.content : '');
  }
  if (!input) throw new AiError('The model did not return a tone. Try another model or try again.');
  return { input, model: json.model ?? model, usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens }, sources: [] };
}

async function openrouterResearch(s: AiSettings, prompt: string): Promise<{ text: string; sources: { title: string; url: string }[] }> {
  const json = await post(OPENROUTER_URL, openrouterHeaders(s.apiKey), {
    model: s.model,
    max_tokens: 2048,
    plugins: [{ id: 'web', max_results: 5 }],
    messages: [{ role: 'user', content: prompt }],
  });
  const msg = json.choices?.[0]?.message ?? {};
  const sources = (msg.annotations ?? [])
    .filter((a: any) => a.type === 'url_citation')
    .map((a: any) => ({ url: a.url_citation?.url, title: a.url_citation?.title ?? a.url_citation?.url }))
    .filter((x: any) => x.url);
  return { text: typeof msg.content === 'string' ? msg.content : '', sources };
}

// ---------------- dispatch ----------------

export function callTone(s: AiSettings, model: string, system: string, user: string, schema: ToneSchema = TONE_SCHEMA, opts: ToneOptions = {}): Promise<CallResult> {
  if (!s.apiKey) throw new AiError('Add an API key in Settings first.');
  return s.provider === 'anthropic' ? anthropicTone(s, model, system, user, schema, opts) : openrouterTone(s, model, system, user, schema);
}

/** Separate research call, for OpenRouter only: Anthropic searches inside the tone call. */
export function callResearch(s: AiSettings, prompt: string) {
  if (!s.apiKey) throw new AiError('Add an API key in Settings first.');
  return openrouterResearch(s, prompt);
}
