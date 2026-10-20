import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findTone, normalize, parseTrack, songTitle, suggestTones } from './match';
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
  it('takes the artist apart when the player gives it (Spotify)', () => {
    expect(parseTrack({ title: 'Back In Black - Remastered 2003', artist: 'AC/DC' })).toMatchObject({ artist: 'AC/DC', title: 'Back In Black - Remastered 2003' });
    expect(parseTrack({ title: 'Lodi', artist: '' })).toMatchObject({ artist: undefined, title: 'Lodi' });
  });
});

describe('songTitle', () => {
  it('drops the version note after " - "', () => {
    expect(songTitle('Pride and Joy - Remastered 1999')).toBe('Pride and Joy');
    expect(songTitle('Mercury Blues')).toBe('Mercury Blues');
  });
});

describe('findTone', () => {
  const track = (title: string) => parseTrack({ title });

  it("loads the song's tone", () => {
    expect(name(findTone(track('Blackberry Smoke - Pretty Little Lie'), library, TELE).recipe)).toBe('PLL');
    expect(name(findTone(track('Shania Twain - Honey I’m Home'), library, TELE).recipe)).toBe('HONEY');
  });

  it('matches with a different artist spelling or no artist at all', () => {
    expect(name(findTone(track('ELO - Rock n Roll Is King'), library, TELE).recipe)).toBe('KING');
    expect(name(findTone(parseTrack({ file: 'Lodi.mp3' }), library, TELE).recipe)).toBe('LODI');
  });

  it('matches Spotify titles with a version note', () => {
    expect(name(findTone(parseTrack({ title: 'Pride and Joy - Remastered 1999', artist: 'Stevie Ray Vaughan & Double Trouble' }), library, TELE).recipe)).toBe('PRIDE');
    expect(name(findTone(track('Blackberry Smoke - Pretty Little Lie - Live'), library, TELE).recipe)).toBe('PLL');
  });

  it('handles files tagged Title - Artist', () => {
    expect(name(findTone(track('Wagon Wheel - Darius Rucker'), library, TELE).recipe)).toBe('WAGON');
  });

  it('prefers your newest version of the first part, not a part added later', () => {
    const base = library.find((r) => r.pedal.name === 'PLL')!;
    const mine = { ...base, id: 'mine', source: 'edited' as const, createdAt: '2026-10-19T10:00:00.000Z', pedal: { ...base.pedal, name: 'PLL MINE' } };
    const lead = { ...base, id: 'lead', source: 'ai' as const, createdAt: '2026-10-19T09:00:00.000Z', request: { ...base.request, part: 'Solo' }, pedal: { ...base.pedal, name: 'PLL SOLO' } };
    const leadEdit = { ...lead, id: 'lead-mine', source: 'edited' as const, createdAt: '2026-10-19T11:00:00.000Z' };
    expect(name(findTone(track('Blackberry Smoke - Pretty Little Lie'), [...library, mine, leadEdit], TELE).recipe)).toBe('PLL MINE');
  });

  it("uses the bank of the guitar being played", () => {
    expect(name(findTone(track('Alan Jackson - Mercury Blues'), library, GODIN).recipe)).toBe('MERC G');
    const m = findTone(track('Alabama - Dixieland Delight'), library, GODIN);
    expect(m.recipe).toBeUndefined();
    expect(name(m.otherGuitar)).toBe('DIXIE');
  });

  it('suggests tones by the same artist, then similar titles', () => {
    expect(suggestTones(track('Toby Keith - Red Solo Cup'), library, TELE).map(name).sort()).toEqual(['NOW', 'TOBY']);
    expect(suggestTones(track('Creedence - Lodi Blues'), library, TELE).map(name)).toEqual(['LODI']);
    expect(suggestTones(track('Nobody - Nothing Alike'), library, TELE)).toEqual([]);
  });

  it('flags a match that is by title only, until it is linked', () => {
    expect(findTone(track('Blackberry Smoke - Pretty Little Lie'), library, TELE).doubt).toBeUndefined();
    expect(findTone(track('Wagon Wheel - Darius Rucker'), library, TELE).doubt).toBeUndefined();
    expect(findTone(parseTrack({ title: 'Pride and Joy - Remastered 1999', artist: 'Stevie Ray Vaughan & Double Trouble' }), library, TELE).doubt).toBeUndefined();
    expect(findTone(parseTrack({ file: 'Lodi.mp3' }), library, TELE).doubt).toBe('the track has no artist name');
    const cover = track('Some Cover Band - Mercury Blues');
    const m = findTone(cover, library, TELE);
    expect(m.doubt).toMatch(/^the tone is for /);
    expect(findTone(cover, library, TELE, { [cover.key]: m.recipe!.id }).doubt).toBeUndefined();
  });

  it('lets a manual link win', () => {
    const t = track('Some Band - Unknown Song');
    expect(findTone(t, library, TELE).recipe).toBeUndefined();
    const lead = library.find((r) => r.pedal.name === 'TOBY')!;
    expect(name(findTone(t, library, TELE, { [t.key]: lead.id }).recipe)).toBe('TOBY');
  });
});
