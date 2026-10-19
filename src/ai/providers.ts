// Provider adapters. Both return the parsed submit_tone input plus usage info.
// Anthropic: called directly from the browser (personal use; the key stays in this device's storage).
// OpenRouter: OpenAI-compatible chat completions with function calling.

import { TONE_SCHEMA, TOOL_DESCRIPTION, TOOL_NAME, type ToneSchema } from './schema';

export type ProviderId = 'anthropic' | 'openrouter';

export interface AiSettings {
  provider: ProviderId;
  apiKey: string;
  /** Model for new tones. */
  model: string;
  /** Cheaper model for small follow-up edits. */
  fastModel: string;
  /** Allow web search for songs the model may not know (costs extra). */
  webSearch: boolean;
}

export const DEFAULT_MODELS: Record<ProviderId, { model: string; fastModel: string }> = {
  anthropic: { model: 'claude-sonnet-5-5', fastModel: 'claude-haiku-5-5' },
  // OpenRouter ids follow "vendor/model"; check openrouter.ai/models for the exact current names.
  openrouter: { model: 'anthropic/claude-sonnet-5.5', fastModel: 'anthropic/claude-haiku-5.5' },
};

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
/** Basic web search tool version, supported on every Claude platform. */
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };

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

async function anthropicTone(s: AiSettings, model: string, system: string, user: string, schema: ToneSchema): Promise<CallResult> {
  const json = await post(ANTHROPIC_URL, anthropicHeaders(s.apiKey), {
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: schema }],
    // "auto" + the instruction in the prompt works whether or not the model thinks first.
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: user }],
  });
  const blocks: any[] = json.content ?? [];
  const call = blocks.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const input = call?.input ?? jsonFromText(text);
  if (!input) throw new AiError('The model did not return a tone. Try again.');
  return {
    input,
    model: json.model ?? model,
    usage: { inputTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens, cacheReadTokens: json.usage?.cache_read_input_tokens },
    sources: [],
  };
}

async function anthropicResearch(s: AiSettings, prompt: string): Promise<{ text: string; sources: { title: string; url: string }[] }> {
  const json = await post(ANTHROPIC_URL, anthropicHeaders(s.apiKey), {
    model: s.model,
    max_tokens: 2048,
    tools: [WEB_SEARCH_TOOL],
    messages: [{ role: 'user', content: prompt }],
  });
  const blocks: any[] = json.content ?? [];
  const sources = new Map<string, string>();
  for (const b of blocks) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.set(r.url, r.title ?? r.url);
    if (b.type === 'text') for (const c of b.citations ?? []) if (c.url) sources.set(c.url, c.title ?? c.url);
  }
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, sources: [...sources].map(([url, title]) => ({ url, title })).slice(0, 8) };
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
    max_tokens: 4096,
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
    input = jsonFromText(typeof msg.content === 'string' ? msg.content : '');
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

export function callTone(s: AiSettings, model: string, system: string, user: string, schema: ToneSchema = TONE_SCHEMA): Promise<CallResult> {
  if (!s.apiKey) throw new AiError('Add an API key in Settings first.');
  return s.provider === 'anthropic' ? anthropicTone(s, model, system, user, schema) : openrouterTone(s, model, system, user, schema);
}

export function callResearch(s: AiSettings, prompt: string) {
  if (!s.apiKey) throw new AiError('Add an API key in Settings first.');
  return s.provider === 'anthropic' ? anthropicResearch(s, prompt) : openrouterResearch(s, prompt);
}
