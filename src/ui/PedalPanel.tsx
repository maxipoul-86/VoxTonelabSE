import { useState } from 'react';
import { Knob } from './Knob';
import { store, useStore } from './store';
import { GigStrip } from './Gig';
import { FineTune } from './FineTune';
import { Modal } from './Modal';
import { SCALES } from '../tonelab/scales';
import { getName, rangeOf, read, sanitizeName, type Channel, type ControlRef } from '../tonelab/program';
import { expTargetRange, expTargets, type SplitSetup } from '../tonelab/recipe';
import {
  AMP_NOTES,
  AMP_PARAMS,
  AMP_TYPES,
  CAB_TYPES,
  CHAIN_ORDERS,
  CTRL_FACTORS,
  CTRL_TARGETS,
  EFFECT_SLOTS,
  SLOT_KEYS,
  effectType,
  programLabel,
  type ParamDef,
  type SlotKey,
} from '../tonelab/spec';
import { DEFAULT_GUITAR, activeGuitar, type SplitGuitar } from '../ai/guitar';
import { GuitarMismatch, GuitarSwitch, recipeGuitar } from './GuitarSwitch';

function useKnob(ref: ControlRef, scale: keyof typeof SCALES, options?: readonly string[]) {
  const program = useStore((s) => s.program);
  const baseline = useStore((s) => s.baseline);
  const { min, max } = rangeOf(program, ref);
  const value = read(program, ref);
  const sc = SCALES[scale];
  const base = baseline ? safeRead(baseline, ref) : undefined;
  return {
    value,
    min,
    max,
    format: (raw: number) => sc.format(raw, options),
    parse: (t: string) => (t.trim() === '' || Number.isNaN(Number(t)) ? undefined : sc.toRaw(Number(t))),
    recipeText: base !== undefined && base !== value ? sc.format(base, options) : undefined,
    onChange: (raw: number, final: boolean) => store.setControl(ref, raw, { final }),
  };
}

function safeRead(bytes: Uint8Array, ref: ControlRef): number | undefined {
  try {
    return read(bytes, ref);
  } catch {
    return undefined;
  }
}

function KnobFor({ cref, label, scale, size, active, options }: { cref: ControlRef; label: string; scale: keyof typeof SCALES; size?: 'lg' | 'sm'; active?: boolean; options?: readonly string[] }) {
  const k = useKnob(cref, scale, options);
  return <Knob label={label} size={size} active={active} {...k} />;
}

function ParamControl({ slot, def, active }: { slot: SlotKey; def: ParamDef; active: boolean }) {
  const ref: ControlRef = { kind: 'effectParam', slot, key: def.key };
  const program = useStore((s) => s.program);
  if (def.scale === 'enum' || (def.scale === 'int1' && def.max - def.min <= 10)) {
    const value = read(program, ref);
    const opts = Array.from({ length: def.max - def.min + 1 }, (_, i) => def.min + i);
    return (
      <label className="param-select">
        <span>{def.label}</span>
        <select value={value} onChange={(e) => store.setControl(ref, Number(e.target.value), { final: true })}>
          {opts.map((o) => (
            <option key={o} value={o}>
              {SCALES[def.scale].format(o, def.options)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return <KnobFor cref={ref} label={def.label} scale={def.scale} size="sm" active={active} />;
}

function Led({ on, color }: { on: boolean; color?: string }) {
  return <span className={`led ${on ? 'on' : ''}`} style={on && color ? { background: color, boxShadow: `0 0 8px ${color}` } : undefined} aria-hidden="true" />;
}

function Toggle({ refKey, label }: { refKey: ControlRef; label: string }) {
  const on = useStore((s) => read(s.program, refKey)) === 1;
  return (
    <button type="button" className="chip-toggle" aria-pressed={on} onClick={() => store.setControl(refKey, on ? 0 : 1, { final: true })}>
      <Led on={on} />
      {label} {on ? 'on' : 'off'}
    </button>
  );
}

function EffectCard({ slot }: { slot: SlotKey }) {
  const program = useStore((s) => s.program);
  const def = EFFECT_SLOTS[slot];
  const on = read(program, { kind: 'status', key: slot }) === 1;
  const type = effectType(slot, read(program, { kind: 'effectType', slot }));
  return (
    <section className="card fx-card" aria-label={`${def.label} effect`}>
      <div className="card-head">
        <h3 className="section-title">{def.label.toUpperCase()}</h3>
        <button type="button" className="pill" aria-pressed={on} onClick={() => store.setControl({ kind: 'status', key: slot }, on ? 0 : 1, { final: true })}>
          <Led on={on} />
          {on ? 'On' : 'Off'}
        </button>
      </div>
      <select
        className="picker"
        aria-label={`${def.label} type`}
        value={type?.id ?? 0}
        onChange={(e) => store.setControl({ kind: 'effectType', slot }, Number(e.target.value), { final: true })}
      >
        {def.types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <div className="fx-knobs">
        {type?.params.map((p) => (
          <ParamControl key={`${type.id}-${p.key}`} slot={slot} def={p} active={on} />
        ))}
      </div>
    </section>
  );
}

function AmpSection() {
  const program = useStore((s) => s.program);
  const activeB = read(program, { kind: 'status', key: 'channelB' }) === 1;
  const [view, setView] = useState<Channel>(activeB ? 'B' : 'A');
  const ch = view;
  const ampIdx = read(program, { kind: 'ampType', ch });
  return (
    <section className="card amp" aria-label="Amp">
      <div className="amp-head">
        <h3 className="section-title">AMP</h3>
        <div className="segmented" role="group" aria-label="Channel shown">
          {(['A', 'B'] as const).map((c) => (
            <button key={c} type="button" aria-pressed={view === c} onClick={() => setView(c)}>
              Ch {c}
              {(c === 'B') === activeB && <span className="active-dot" title="Active on the pedal" />}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn small"
          title="Swap channel A and B: amp, cabinet, knobs. The sound playing stays the same."
          onClick={() => {
            void store.swapChannels();
            setView(view === 'A' ? 'B' : 'A');
          }}
        >
          Swap A ⇄ B
        </button>
        <label className="picker-label">
          <span>Amp</span>
          <select className="picker" value={ampIdx} onChange={(e) => store.setControl({ kind: 'ampType', ch }, Number(e.target.value), { final: true })}>
            {AMP_TYPES.map((a, i) => (
              <option key={a} value={i}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="picker-label">
          <span>Cab</span>
          <select className="picker" value={read(program, { kind: 'cabType', ch })} onChange={(e) => store.setControl({ kind: 'cabType', ch }, Number(e.target.value), { final: true })}>
            {CAB_TYPES.map((c, i) => (
              <option key={c} value={i}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="amp-toggles">
          <Toggle refKey={{ kind: 'status', key: ch === 'A' ? 'ampA' : 'ampB' }} label="Amp" />
          <Toggle refKey={{ kind: 'status', key: ch === 'A' ? 'cabA' : 'cabB' }} label="Cab" />
        </div>
      </div>
      <p className="amp-note">{AMP_NOTES[AMP_TYPES[ampIdx]]}</p>
      <div className="amp-knobs">
        {AMP_PARAMS.map((p) => (
          <KnobFor key={`${ch}-${p.key}`} cref={{ kind: 'ampParam', ch, key: p.key }} label={p.label} scale={p.scale} />
        ))}
      </div>
      <div className="chain-row">
        <span className="dim">CHAIN</span>
        <span>
          Pedal → Amp {ch} → Cab {ch} →{' '}
        </span>
        <select
          className="picker small"
          aria-label="Effect order after the amp"
          value={read(program, { kind: 'chain' })}
          onChange={(e) => store.setControl({ kind: 'chain' }, Number(e.target.value), { final: true })}
        >
          {CHAIN_ORDERS.map((c, i) => (
            <option key={c} value={i}>
              {c.replace(/M/g, 'Mod').replace(/D/g, 'Delay').replace(/R/g, 'Reverb').replace(/-/g, ' → ')}
            </option>
          ))}
        </select>
        <span className="legend">
          <span className="legend-ring" /> Changed from recipe
        </span>
      </div>
    </section>
  );
}

function GuitarCard() {
  const recipe = useStore((s) => s.recipe);
  const settings = useStore((s) => s.settings);
  const playing = activeGuitar(settings);
  // The knob settings belong to the guitar the tone was made for, which may not be the one plugged in.
  const made = recipe ? (recipeGuitar(recipe, settings.guitars) ?? playing) : playing;
  const g = recipe?.guitar;
  return (
    <aside className="card guitar" aria-label="Guitar setup">
      <h3 className="section-title">GUITAR SETUP</h3>
      <GuitarSwitch label="Playing" />
      {recipe && g ? (
        <>
          <GuitarMismatch recipe={recipe} />
          {g.kind === 'piezo' ? (
            <div className="mono">
              <span className="dim small">Volume </span>
              {g.volume} <span className="dim small"> Bass </span>
              {g.bass} <span className="dim small"> Mid </span>
              {g.mid} <span className="dim small"> Treble </span>
              {g.treble}
            </div>
          ) : (
            <SplitControls setup={g} guitar={made.kind === 'split' ? made : DEFAULT_GUITAR} />
          )}
          {recipe.tips && <Tips key={recipe.id} text={recipe.tips} />}
        </>
      ) : (
        <>
          {settings.guitars.length < 2 && <div className="guitar-name">{playing.name}</div>}
          <p className="dim">Load a tone from Find or Library to see how to set the guitar's controls.</p>
        </>
      )}
    </aside>
  );
}

/** Compact so the card stays about as tall as the amp section: the selector side by side, knobs on one line. */
function SplitControls({ setup, guitar }: { setup: SplitSetup; guitar: SplitGuitar }) {
  const pickup = (s: string) => s.split('(')[0].trim();
  const pickupName = { bridge: pickup(guitar.bridgePickup), both: 'both pickups', neck: pickup(guitar.neckPickup) }[setup.selector];
  return (
    <>
      <ul className="selector" aria-label="Pickup selector">
        {(['bridge', 'both', 'neck'] as const).map((p) => (
          <li key={p} className={setup.selector === p ? 'current' : ''}>
            <span>
              <Led on={setup.selector === p} /> {guitar.selector[p]}
            </span>
            <span className="dim small">{p}</span>
          </li>
        ))}
      </ul>
      <div className="dim small pickup-name">{pickupName}</div>
      <div className="guitar-knobs">
        <span>
          <span className="dim small">Tone knob </span>
          <strong>{setup.coils === 'humbucker' ? 'pushed · humbucker' : 'pulled · single coil'}</strong>
        </span>
        <span className="mono">
          <span className="dim small">Vol </span>
          {setup.volume} <span className="dim small"> Tone </span>
          {setup.tone}
        </span>
      </div>
    </>
  );
}

function FootBar() {
  const program = useStore((s) => s.program);
  const targets = expTargets(program);
  const activeB = read(program, { kind: 'status', key: 'channelB' }) === 1;
  const setExp = (pedal: 'exp1' | 'exp2', code: number) => {
    const r = expTargetRange(program, code);
    store.setControl({ kind: 'expTarget', pedal }, code, { final: true });
    store.setControl({ kind: 'expMin', pedal }, r.min, { final: true });
    store.setControl({ kind: 'expMax', pedal }, r.max, { final: true });
  };
  return (
    <section className="card footbar" aria-label="Footswitches and pedals">
      <div className="foot-switches">
        {([...SLOT_KEYS, 'insert'] as const).map((k) => {
          const on = read(program, { kind: 'status', key: k }) === 1;
          return (
            <button key={k} type="button" className="foot" aria-pressed={on} onClick={() => store.setControl({ kind: 'status', key: k }, on ? 0 : 1, { final: true })}>
              <Led on={on} />
              {k === 'mod' ? 'MOD' : k.toUpperCase()}
            </button>
          );
        })}
        <button type="button" className="foot" aria-pressed={activeB} onClick={() => store.setControl({ kind: 'status', key: 'channelB' }, activeB ? 0 : 1, { final: true })}>
          <Led on color={activeB ? 'var(--changed)' : undefined} />
          CH {activeB ? 'B' : 'A'}
        </button>
      </div>
      <div className="assign">
        {(['exp1', 'exp2'] as const).map((p) => (
          <label key={p}>
            <span className="dim">{p === 'exp1' ? 'EXP 1' : 'EXP 2'}</span>
            <select
              className="picker small"
              value={read(program, { kind: 'expTarget', pedal: p })}
              onChange={(e) => setExp(p, Number(e.target.value))}
              disabled={p === 'exp1'}
              title={p === 'exp1' ? 'EXP 1 is always the volume pedal' : undefined}
            >
              {targets.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          <span className="dim">CTRL</span>
          <select className="picker small" value={read(program, { kind: 'ctrlTarget' })} onChange={(e) => store.setControl({ kind: 'ctrlTarget' }, Number(e.target.value), { final: true })}>
            {CTRL_TARGETS.map((t, i) => (
              <option key={t} value={i}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="dim">TAP ×</span>
          <select className="picker small" value={read(program, { kind: 'ctrlFactor' })} onChange={(e) => store.setControl({ kind: 'ctrlFactor' }, Number(e.target.value), { final: true })}>
            {CTRL_FACTORS.map((t, i) => (
              <option key={t} value={i}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function PanelHeader() {
  const program = useStore((s) => s.program);
  const recipe = useStore((s) => s.recipe);
  const baseline = useStore((s) => s.baseline);
  const conn = useStore((s) => s.conn);
  const last = useStore((s) => s.lastFromPedal);
  const slot = useStore((s) => s.slot);
  const [tuning, setTuning] = useState(false);
  const [name, setNameText] = useState<string | null>(null);
  const changes = baseline ? Array.from(program).filter((b, i) => b !== baseline[i]).length : 0;
  const commitName = () => {
    if (name === null) return;
    const clean = sanitizeName(name);
    for (let i = 0; i < 8; i++) store.setControl({ kind: 'nameChar', index: i }, clean.charCodeAt(i), { final: true });
    setNameText(null);
  };
  const title = recipe ? [recipe.request.song, recipe.request.artist].filter(Boolean).join(' — ') : 'No tone loaded';
  return (
    <header className="panel-head">
      <div className="title-block">
        <input
          className="lcd"
          aria-label="Program name"
          maxLength={8}
          value={name ?? getName(program)}
          onChange={(e) => setNameText(e.target.value.toUpperCase())}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div>
          <div className="title">{title}</div>
          <div className="dim small">
            {[recipe?.request.part, conn.status === 'connected' ? (slot !== undefined ? `Edit buffer of ${programLabel(slot)}, not stored` : 'Edit buffer, not stored') : 'Offline copy', baseline ? (changes ? 'changed from recipe' : 'matches recipe') : undefined]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>
      <div className="conn">
        <div>
          <span className={`dot ${conn.status}`} /> {conn.status === 'connected' ? `${conn.name}${conn.virtual ? '' : ' · in sync'}` : conn.status === 'connecting' ? 'Connecting…' : 'Not connected'}
        </div>
        {last && <div className="mono small dim">Last from pedal: {last}</div>}
      </div>
      <div className="actions">
        <button type="button" className="btn" disabled={!recipe} onClick={() => store.backToRecipe()}>
          Back to recipe
        </button>
        <button type="button" className="btn" onClick={() => setTuning(true)}>
          Fine tune…
        </button>
        <button type="button" className="btn primary" onClick={() => void store.saveMyVersion()}>
          Save my version
        </button>
      </div>
      {tuning && (
        <Modal label="Fine tune" onClose={() => setTuning(false)}>
          <FineTune onClose={() => setTuning(false)} />
        </Modal>
      )}
    </header>
  );
}

/** The tone's tips, cut to 3 lines so a long text doesn't push the effects off the screen. */
function Tips({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <div className="tip">
      <p className={long && !open ? 'tip-text clamped' : 'tip-text'}>{text}</p>
      {long && (
        <button type="button" className="link-btn" onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'More'}
        </button>
      )}
    </div>
  );
}

export function PedalPanel() {
  return (
    <div className="pedal">
      <PanelHeader />
      <GigStrip />
      <div className="row-amp">
        <AmpSection />
        <GuitarCard />
      </div>
      <div className="fx-grid">
        {SLOT_KEYS.map((s) => (
          <EffectCard key={s} slot={s} />
        ))}
      </div>
      <FootBar />
    </div>
  );
}
