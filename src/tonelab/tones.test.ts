// The tones bundled in tones/: each one must load cleanly, and all-tones.json must match the files.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXP1_TARGET, applyRecipe, type ToneRecipe } from './recipe';

const files = readdirSync('tones')
  .filter((f) => f.endsWith('.json') && f !== 'all-tones.json')
  .sort();
const load = (f: string): ToneRecipe[] => JSON.parse(readFileSync(`tones/${f}`, 'utf8')).recipes;

describe('bundled tones', () => {
  it.each(files)('%s loads without adjustments, EXP 1 on volume, starting on channel A', (f) => {
    for (const r of load(f)) {
      expect(applyRecipe(r.pedal).warnings).toEqual([]);
      expect(r.pedal.exp1).toBe(EXP1_TARGET);
      expect(r.pedal.activeChannel).toBe('A');
      expect(r.pedal.name).toMatch(/^[A-Z0-9 '/&!-]{1,8}$/);
    }
  });

  it('have unique ids and program names', () => {
    const all = files.flatMap(load);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    expect(new Set(all.map((r) => `${r.guitarId ?? ''}|${r.pedal.name}`)).size).toBe(all.length);
  });

  it('all-tones.json is up to date (npm run tones)', () => {
    const bundled = JSON.parse(readFileSync('tones/all-tones.json', 'utf8')).recipes;
    expect(bundled).toEqual(files.flatMap(load));
  });
});
