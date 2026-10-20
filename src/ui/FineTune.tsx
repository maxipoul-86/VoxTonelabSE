import { useState } from 'react';
import { store, useStore } from './store';
import { CloseButton } from './Modal';
import { MicButton } from './MicButton';
import type { EngineResult } from '../ai/engine';

/** Quick requests for the tablet; anything else can be typed or said, in French or English. */
const QUICK = ['Moins de gain', 'Plus de gain', 'Plus de treble', 'Moins de treble', 'Plus de bass', 'Moins de reverb', 'Plus de delay', 'B plus fort pour le solo'];

/** Ask the AI (fast model) to adjust the tone loaded on the pedal; each result is saved and loaded. */
export function FineTune({ onClose }: { onClose: () => void }) {
  const recipe = useStore((s) => s.recipe);
  const model = useStore((s) => s.settings.ai.fastModel);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<EngineResult | null>(null);

  async function adjust(instruction: string) {
    if (!instruction.trim() || busy) return;
    setError(null);
    setBusy('Adjusting…');
    try {
      setDone(await store.fineTune(instruction.trim(), setBusy));
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page narrow">
      <div className="row-between">
        <h1>Fine tune</h1>
        <CloseButton onClose={onClose} />
      </div>
      <p className="dim small">
        Adjusting {recipe ? `“${[recipe.request.song, recipe.request.artist].filter(Boolean).join(' — ') || recipe.pedal.name}”` : 'the sound on the pedal'} as it is now, your knob changes included, with {model}. Each result is saved to the Library and loaded into the pedal.
      </p>
      <form
        className="refine"
        onSubmit={(e) => {
          e.preventDefault();
          void adjust(text);
        }}
      >
        <label className="field grow">
          <span>What should change?</span>
          <div className="with-mic">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="plus de mordant sur B · less fizz · more slapback" autoComplete="off" autoFocus />
            {/* Spoken requests go straight to the AI: hands stay on the guitar. */}
            <MicButton
              onInterim={setText}
              onText={(t) => {
                setText(t);
                void adjust(t);
              }}
            />
          </div>
        </label>
        <button className="btn primary" type="submit" disabled={!!busy || !text.trim()}>
          {busy ?? 'Adjust'}
        </button>
      </form>
      <div className="row-gap wrap">
        {QUICK.map((q) => (
          <button key={q} className="btn small" type="button" disabled={!!busy} onClick={() => void adjust(q)}>
            {q}
          </button>
        ))}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {done && !busy && (
        <div className="card">
          <p>
            <strong>Loaded “{done.recipe.pedal.name}”.</strong> Play it, then adjust again or close.
          </p>
          {done.recipe.why && <p className="dim">{done.recipe.why}</p>}
          {!!done.fixes.length && <p className="dim small">Adjusted to fit the pedal: {done.fixes.join(' ')}</p>}
        </div>
      )}
    </div>
  );
}
