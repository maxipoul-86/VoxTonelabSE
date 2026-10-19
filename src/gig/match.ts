// Track from Winamp -> tone in the Library. Pure functions so they can be tested without a browser.

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

/** Winamp's playlist title is "Artist - Title" by default; without tags it is the file name. */
export function parseTrack(input: { title?: string; file?: string }): Track {
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
  // Some files are tagged "Title - Artist".
  return hits.length || !track.artist ? hits : byTitle(track.artist, track.title);
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

export interface ToneMatch {
  recipe?: ToneRecipe;
  /** No tone for this guitar, but one exists for another guitar. */
  otherGuitar?: ToneRecipe;
}

export function findTone(track: Track, library: ToneRecipe[], guitarId: string, links: Record<string, string> = {}): ToneMatch {
  const linked = links[track.key] ? library.find((r) => r.id === links[track.key]) : undefined;
  if (linked) return { recipe: linked };
  const recipe = firstTone(candidates(track, library.filter((r) => recipeGuitarId(r) === guitarId)));
  if (recipe) return { recipe };
  return { otherGuitar: firstTone(candidates(track, library.filter((r) => recipeGuitarId(r) !== guitarId))) };
}
