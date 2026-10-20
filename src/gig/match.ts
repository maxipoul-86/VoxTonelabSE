// Track from Winamp or Spotify -> tone in the Library. Pure functions so they can be tested without a browser.

import { recipeGuitarId, type ToneRecipe } from '../tonelab/recipe';

/** Lower case, no accents, no "(live)" / "[remaster]" / "feat. X", only letters, digits and single spaces. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s(feat\.?|ft\.?|featuring)\s.*$/, ' ')
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface Track {
  artist?: string;
  title: string;
  /** Normalized "artist|title", used for manual links. */
  key: string;
}

/** The song name without a version note after " - ", as Spotify writes "Back In Black - Remastered 2003". */
export function songTitle(title: string): string {
  return title.replace(/\s+-\s+.*$/, '').trim() || title;
}

/** Winamp's playlist title is "Artist - Title" by default; without tags it is the file name. Spotify gives the artist apart. */
export function parseTrack(input: { title?: string; artist?: string; file?: string }): Track {
  const givenArtist = input.artist?.trim();
  if (givenArtist && input.title?.trim()) {
    const title = input.title.trim();
    return { artist: givenArtist, title, key: `${normalize(givenArtist)}|${normalize(title)}` };
  }
  const fromFile = (input.file ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+\s*[-._)]\s*/, '');
  const source = input.title?.trim() || fromFile;
  const i = source.indexOf(' - ');
  const artist = i > 0 ? source.slice(0, i).trim() : undefined;
  const title = (i > 0 ? source.slice(i + 3) : source).trim();
  return { artist, title, key: `${normalize(artist ?? '')}|${normalize(title)}` };
}

const artistMatches = (r: ToneRecipe, artist: string) => {
  const a = normalize(r.request.artist ?? '');
  return !!a && (a === artist || a.includes(artist) || artist.includes(a));
};

function candidates(track: Track, list: ToneRecipe[]): ToneRecipe[] {
  const byTitle = (title: string, artist?: string) => {
    const t = normalize(title);
    if (!t) return [];
    const hits = list.filter((r) => normalize(r.request.song ?? '') === t);
    if (!artist) return hits;
    const withArtist = hits.filter((r) => artistMatches(r, normalize(artist)));
    // "ELO" vs "Electric Light Orchestra": a title match alone still counts.
    return withArtist.length ? withArtist : hits;
  };
  const hits = byTitle(track.title, track.artist);
  if (hits.length) return hits;
  // "Back In Black - Remastered 2003", or "Artist - Title - Live" from Winamp.
  const short = songTitle(track.title);
  const shortHits = short !== track.title ? byTitle(short, track.artist) : [];
  // Some files are tagged "Title - Artist".
  return shortHits.length || !track.artist ? shortHits : byTitle(track.artist, track.title);
}

/** The song's first tone: the part saved first (the rhythm), preferring the newest "your version" of it. */
export function firstTone(list: ToneRecipe[]): ToneRecipe | undefined {
  if (!list.length) return undefined;
  const oldest = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const part = normalize(oldest.request.part ?? '');
  const edited = list
    .filter((r) => r.source === 'edited' && normalize(r.request.part ?? '') === part)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return edited[0] ?? oldest;
}

/** How much of the tone's song title is in the track title (words of 3 letters or more), 0..1. */
function titleSimilarity(trackTitle: string, toneTitle: string): number {
  const words = (s: string) => new Set(normalize(songTitle(s)).split(' ').filter((w) => w.length > 2));
  const track = words(trackTitle);
  const tone = words(toneTitle);
  if (!track.size || !tone.size) return 0;
  return [...tone].filter((w) => track.has(w)).length / tone.size;
}

/** Tones to offer when a track has none: the same artist first, then similar titles. One per song, this guitar only. */
export function suggestTones(track: Track, library: ToneRecipe[], guitarId: string, max = 3): ToneRecipe[] {
  const artist = normalize(track.artist ?? '');
  const bySong = new Map<string, ToneRecipe[]>();
  for (const r of library.filter((r) => recipeGuitarId(r) === guitarId)) {
    const k = `${normalize(r.request.artist ?? '')}|${normalize(r.request.song ?? '')}`;
    bySong.set(k, [...(bySong.get(k) ?? []), r]);
  }
  return [...bySong.values()]
    .map((tones) => {
      const r = firstTone(tones)!;
      const score = (artist && artistMatches(r, artist) ? 1 : 0) + titleSimilarity(track.title, r.request.song ?? '');
      return { r, score };
    })
    .filter((s) => s.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.r);
}

export interface ToneMatch {
  recipe?: ToneRecipe;
  /** Set when the recipe was matched by song title only and the player hasn't approved it, e.g. "the tone is for ELO". */
  doubt?: string;
  /** No tone for this guitar, but one exists for another guitar. */
  otherGuitar?: ToneRecipe;
}

/** Why a title match may be the wrong song: undefined when the artist matches as well. */
function matchDoubt(track: Track, r: ToneRecipe): string | undefined {
  if (!track.artist) return 'the track has no artist name';
  // Files tagged "Title - Artist" have the artist where the title should be.
  if (artistMatches(r, normalize(track.artist)) || artistMatches(r, normalize(track.title))) return undefined;
  return r.request.artist ? `the tone is for ${r.request.artist}` : 'the tone has no artist name';
}

export function findTone(track: Track, library: ToneRecipe[], guitarId: string, links: Record<string, string> = {}): ToneMatch {
  const linked = links[track.key] ? library.find((r) => r.id === links[track.key]) : undefined;
  if (linked) return { recipe: linked };
  const recipe = firstTone(candidates(track, library.filter((r) => recipeGuitarId(r) === guitarId)));
  if (recipe) return { recipe, doubt: matchDoubt(track, recipe) };
  return { otherGuitar: firstTone(candidates(track, library.filter((r) => recipeGuitarId(r) !== guitarId))) };
}
