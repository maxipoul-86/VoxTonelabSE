// The player's guitars and rig, as the tone engine sees them. Editable in Settings.
// Each guitar has a kind that decides its controls: magnetic pickups with a selector and
// coil split, or a piezo with its own volume and 3-band EQ.

export type GuitarKind = 'split' | 'piezo';

interface GuitarBase {
  id: string;
  name: string;
  notes: string;
}

export interface SplitGuitar extends GuitarBase {
  kind: 'split';
  bridgePickup: string;
  neckPickup: string;
  /** Plain words for the 3-way selector positions. */
  selector: { bridge: string; both: string; neck: string };
  /** What switches humbucker <-> single coil, and what each position does. */
  coilSplit: string;
}

export interface PiezoGuitar extends GuitarBase {
  kind: 'piezo';
  pickup: string;
  /** The onboard controls, in plain words. */
  controls: string;
}

export type GuitarProfile = SplitGuitar | PiezoGuitar;

export interface RigProfile {
  /** Tonelab SE Output Select. */
  output: 'Line' | 'Amp';
  description: string;
}

/** Recipes saved before guitars had ids were all made for this one. */
export const FIRST_GUITAR_ID = 'tele';

export const DEFAULT_GUITAR: SplitGuitar = {
  id: FIRST_GUITAR_ID,
  kind: 'split',
  name: 'Fender Telecaster Custom FMT HH',
  bridgePickup: "Seymour Duncan Pearly Gates (humbucker), hot vintage PAF, mid-forward bite",
  neckPickup: "Seymour Duncan '59 (humbucker), vintage PAF, warm and clear",
  selector: { bridge: 'Up', both: 'Middle', neck: 'Down' },
  coilSplit: 'Push-pull on the tone knob splits both pickups: pushed = humbucker, pulled = single coil (less output, brighter).',
  notes: '',
};

export const GODIN_ACOUSTICASTER: PiezoGuitar = {
  id: 'godin-acousticaster',
  kind: 'piezo',
  name: 'Godin Acousticaster',
  pickup: 'Under-saddle piezo with an onboard preamp, no magnetic pickups. Bright and percussive, quacky with a fast attack, less output and sustain than humbuckers.',
  controls: 'Volume, bass, mid, treble on the preamp (5 = flat).',
  notes: '',
};

export const DEFAULT_GUITARS: readonly GuitarProfile[] = [DEFAULT_GUITAR, GODIN_ACOUSTICASTER];

export const DEFAULT_RIG: RigProfile = {
  output: 'Line',
  description: 'Tonelab SE Line out into a mixer and a separate PA. No guitar amp, so cabinet simulation must stay on.',
};

/** The guitar being played now; falls back to the first one. */
export function activeGuitar(s: { guitars: readonly GuitarProfile[]; activeGuitarId: string }): GuitarProfile {
  return s.guitars.find((g) => g.id === s.activeGuitarId) ?? s.guitars[0] ?? DEFAULT_GUITAR;
}

export function blankGuitar(kind: GuitarKind, id: string): GuitarProfile {
  return kind === 'piezo'
    ? { id, kind, name: 'New guitar', pickup: '', controls: 'Volume, bass, mid, treble (5 = flat).', notes: '' }
    : { id, kind, name: 'New guitar', bridgePickup: '', neckPickup: '', selector: { bridge: 'Up', both: 'Middle', neck: 'Down' }, coilSplit: '', notes: '' };
}

export const SELECTOR_TEXT = (g: SplitGuitar) => ({
  bridge: `${g.selector.bridge} · bridge`,
  both: `${g.selector.both} · both`,
  neck: `${g.selector.neck} · neck`,
});
