// Value scales from the VOX ToneLabSE MIDI Implementation v1.0 (2003-11-20).
// Every parameter is stored as a raw integer; a scale converts it to what the
// pedal's display shows (and back), so the UI and the AI work in display units.

export type ScaleId =
  | 'k10' // raw 0..100  -> 0.0..10.0
  | 'k1to10' // raw 0..90 -> 1.0..10.0
  | 'speedHz' // raw 0..100 -> 0.1..10 Hz, non-linear (*4 in the spec)
  | 'ms' // raw = milliseconds (delay time, pre-delay)
  | 'ms2' // raw 5..75 -> 10..150 ms (pitch shifter tracking)
  | 'ms5' // raw 1..100 -> 5..500 ms (gate reverb time)
  | 'pitch' // raw 0..48 -> -24..+24 semitones
  | 'fine' // raw 0..100 -> -50..+50 cents
  | 'nr' // raw 0 = OFF, 1..50 -> 0.2..10.0
  | 'int1' // raw n -> n + 1 (modes, rhythm patterns)
  | 'enum' // raw index into a list of labels
  | 'onoff';

export interface Scale {
  /** Raw integer -> display number. */
  toDisplay(raw: number): number;
  /** Display number -> nearest valid raw integer (not clamped to a parameter range). */
  toRaw(display: number): number;
  /** Display string, e.g. "6.0", "1.2 Hz", "380 ms". */
  format(raw: number, options?: readonly string[]): string;
  unit?: string;
}

const round = (n: number) => Math.round(n);
const fixed1 = (n: number) => n.toFixed(1);

/** The modulation speed table (*4). Index = raw value 0..100. */
export const SPEED_TABLE_HZ: readonly number[] = (() => {
  const t: number[] = [];
  for (let raw = 0; raw <= 100; raw++) {
    let hz: number;
    if (raw <= 9) hz = 0.1 + 0.005 * raw;
    else if (raw <= 24) hz = 0.15 + 0.01 * (raw - 10);
    else if (raw <= 39) hz = 0.3 + 0.02 * (raw - 25);
    else if (raw <= 49) hz = 0.6 + 0.04 * (raw - 40);
    else if (raw <= 59) hz = 1.0 + 0.05 * (raw - 50);
    else if (raw <= 74) hz = 1.5 + 0.1 * (raw - 60);
    else if (raw <= 89) hz = 3.0 + 0.2 * (raw - 75);
    else if (raw <= 99) hz = 6.0 + 0.4 * (raw - 90);
    else hz = 10.0;
    t.push(Math.round(hz * 1000) / 1000);
  }
  return t;
})();

function nearestSpeedRaw(hz: number): number {
  let best = 0;
  for (let i = 1; i < SPEED_TABLE_HZ.length; i++) {
    if (Math.abs(SPEED_TABLE_HZ[i] - hz) < Math.abs(SPEED_TABLE_HZ[best] - hz)) best = i;
  }
  return best;
}

function formatHz(hz: number): string {
  if (hz < 0.15) return `${hz.toFixed(3)} Hz`;
  if (hz < 1.5) return `${hz.toFixed(2)} Hz`;
  return `${hz.toFixed(1)} Hz`;
}

export const SCALES: Record<ScaleId, Scale> = {
  k10: { toDisplay: (r) => r / 10, toRaw: (d) => round(d * 10), format: (r) => fixed1(r / 10) },
  k1to10: { toDisplay: (r) => 1 + r / 10, toRaw: (d) => round((d - 1) * 10), format: (r) => fixed1(1 + r / 10) },
  speedHz: {
    toDisplay: (r) => SPEED_TABLE_HZ[Math.max(0, Math.min(100, r))],
    toRaw: (d) => nearestSpeedRaw(d),
    format: (r) => formatHz(SPEED_TABLE_HZ[Math.max(0, Math.min(100, r))]),
    unit: 'Hz',
  },
  ms: { toDisplay: (r) => r, toRaw: (d) => round(d), format: (r) => `${r} ms`, unit: 'ms' },
  ms2: { toDisplay: (r) => r * 2, toRaw: (d) => round(d / 2), format: (r) => `${r * 2} ms`, unit: 'ms' },
  ms5: { toDisplay: (r) => r * 5, toRaw: (d) => round(d / 5), format: (r) => `${r * 5} ms`, unit: 'ms' },
  pitch: {
    toDisplay: (r) => r - 24,
    toRaw: (d) => round(d) + 24,
    format: (r) => `${r - 24 > 0 ? '+' : ''}${r - 24} st`,
    unit: 'semitones',
  },
  fine: {
    toDisplay: (r) => r - 50,
    toRaw: (d) => round(d) + 50,
    format: (r) => `${r - 50 > 0 ? '+' : ''}${r - 50} ct`,
    unit: 'cents',
  },
  nr: {
    toDisplay: (r) => (r === 0 ? 0 : r * 0.2),
    toRaw: (d) => (d <= 0 ? 0 : Math.max(1, round(d / 0.2))),
    format: (r) => (r === 0 ? 'OFF' : fixed1(r * 0.2)),
  },
  int1: { toDisplay: (r) => r + 1, toRaw: (d) => round(d) - 1, format: (r) => String(r + 1) },
  enum: {
    toDisplay: (r) => r,
    toRaw: (d) => round(d),
    format: (r, options) => options?.[r] ?? String(r),
  },
  onoff: { toDisplay: (r) => r, toRaw: (d) => (d ? 1 : 0), format: (r) => (r ? 'On' : 'Off') },
};

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
