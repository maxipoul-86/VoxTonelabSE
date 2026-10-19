import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findTone, normalize, parseTrack } from './match';
import type { ToneRecipe } from '../tonelab/recipe';

const library: ToneRecipe[] = JSON.parse(readFileSync('tones/all-tones.json', 'utf8')).recipes;
const TELE = 'tele';
const GODIN = 'godin-acousticaster';
const name = (r?: ToneRecipe) => r?.pedal.name;

describe('normalize', () => {
  it('ignores accents, punctuation, apostrophes and version notes', () => {
    expect(normalize('Éric Lapointe')).toBe('eric lapointe');
    expect(normalize('Oh, Pretty Woman')).toBe('oh pretty woman');
    expect(normalize('Lodi (2025 version)')).toBe('lodi');
    expect(normalize("Honey, I'm Home")).toBe(normalize('Honey Im Home'));
    expect(normalize("Rock 'n' Roll Is King")).toBe(normalize('Rock n Roll Is King'));
    expect(normalize('Brooks & Dunn')).toBe('brooks and dunn');
    expect(normalize('Wagon Wheel feat. Lady A')).toBe('wagon wheel');
  });
});

describe('parseTrack', () => {
  it('splits the Winamp title into artist and title', () => {
    expect(parseTrack({ title: 'Éric Lapointe - Terre promise' })).toMatchObject({ artist: 'Éric Lapointe', title: 'Terre promise', key: 'eric lapointe|terre promise' });
  });
  it('falls back to the file name, without the track number', () => {
    expect(parseTrack({ title: '', file: 'C:\\Gig\\03 - Alabama - Dixieland Delight.mp3' })).toMatchObject({ artist: 'Alabama', title: 'Dixieland Delight' });
    expect(parseTrack({ file: 'D:/tracks/Mercury Blues.flac' })).toMatchObject({ artist: undefined, title: 'Mercury Blues' });
  });
});

describe('findTone', () => {
  const track = (title: string) => parseTrack({ title });

  it("loads the song's first tone (the rhythm)", () => {
    expect(name(findTone(track('Blackberry Smoke - Pretty Little Lie'), library, TELE).recipe)).toBe('PLL RHY');
    expect(name(findTone(track('Shania Twain - Honey I’m Home'), library, TELE).recipe)).toBe('HONEY RF');
  });

  it('matches with a different artist spelling or no artist at all', () => {
    expect(name(findTone(track('ELO - Rock n Roll Is King'), library, TELE).recipe)).toBe('KING RY');
    expect(name(findTone(parseTrack({ file: 'Lodi.mp3' }), library, TELE).recipe)).toBe('LODI RY');
  });

  it('handles files tagged Title - Artist', () => {
    expect(name(findTone(track('Wagon Wheel - Darius Rucker'), library, TELE).recipe)).toBe('WAGON AC');
  });

  it('prefers your newest version of the first part', () => {
    const base = library.find((r) => r.pedal.name === 'PLL RHY')!;
    const mine = { ...base, id: 'mine', source: 'edited' as const, createdAt: '2026-10-19T10:00:00.000Z', pedal: { ...base.pedal, name: 'PLL MINE' } };
    const lead = library.find((r) => r.pedal.name === 'PLL LEAD')!;
    const leadEdit = { ...lead, id: 'lead-mine', source: 'edited' as const, createdAt: '2026-10-19T11:00:00.000Z' };
    expect(name(findTone(track('Blackberry Smoke - Pretty Little Lie'), [...library, mine, leadEdit], TELE).recipe)).toBe('PLL MINE');
  });

  it("uses the bank of the guitar being played", () => {
    expect(name(findTone(track('Alan Jackson - Mercury Blues'), library, GODIN).recipe)).toBe('MERC RYG');
    const m = findTone(track('Alabama - Dixieland Delight'), library, GODIN);
    expect(m.recipe).toBeUndefined();
    expect(name(m.otherGuitar)).toBe('DIXIE RY');
  });

  it('lets a manual link win', () => {
    const t = track('Some Band - Unknown Song');
    expect(findTone(t, library, TELE).recipe).toBeUndefined();
    const lead = library.find((r) => r.pedal.name === 'TOBY LD')!;
    expect(name(findTone(t, library, TELE, { [t.key]: lead.id }).recipe)).toBe('TOBY LD');
  });
});
