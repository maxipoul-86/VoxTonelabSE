import type { ProviderId, WebSearchMode } from '../ai/providers';

/** Never / only when needed / always. OpenRouter cannot decide per song, so "only when needed" means no search there. */
export function WebSearchSelect({ value, onChange, provider }: { value: WebSearchMode; onChange: (v: WebSearchMode) => void; provider: ProviderId }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as WebSearchMode)}>
      <option value="auto">{provider === 'openrouter' ? 'Only when needed (not on OpenRouter: no search)' : 'Only when needed'}</option>
      <option value="always">Always</option>
      <option value="off">Never</option>
    </select>
  );
}
