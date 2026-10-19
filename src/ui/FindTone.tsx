import { useState } from 'react';
import { store, useStore } from './store';
import { generateTone, refineTone, type EngineResult } from '../ai/engine';
import { library } from '../store/storage';
import type { ToneRecipe } from '../tonelab/recipe';
import { RecipeSummary } from './RecipeSummary';
import { GuitarSwitch } from './GuitarSwitch';
import { activeGuitar } from '../ai/guitar';

export function FindTone({ onLoaded }: { onLoaded: () => void }) {
  const settings = useStore((s) => s.settings);
  const [prefill] = useState(() => store.takeFindPrefill());
  const [song, setSong] = useState(prefill?.song ?? '');
  const [artist, setArtist] = useState(prefill?.artist ?? '');
  const [part, setPart] = useState('');
  const [notes, setNotes] = useState('');
  const [webSearch, setWebSearch] = useState(settings.ai.webSearch);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [saved, setSaved] = useState<ToneRecipe | null>(null);
  const [refineText, setRefineText] = useState('');

  const guitar = activeGuitar(settings);
  const ctx = () => ({ ai: settings.ai, guitar, rig: settings.rig, learned: store.learned(), onStatus: setBusy });

  async function find(force = false) {
    setError(null);
    setResult(null);
    setSaved(null);
    if (!force) {
      const hit = await library.find(song, artist, part, guitar.id).catch(() => undefined);
      if (hit) {
        setSaved(hit);
        return;
      }
    }
    setBusy('Starting…');
    try {
      const r = await generateTone({ song: song.trim() || undefined, artist: artist.trim() || undefined, part: part.trim() || undefined, notes: notes.trim() || undefined }, ctx(), { webSearch });
      setResult(r);
      await store.saveRecipe(r.recipe);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function refine() {
    if (!result || !refineText.trim()) return;
    setError(null);
    try {
      const r = await refineTone(result.recipe, refineText.trim(), ctx());
      setResult(r);
      setRefineText('');
      await store.saveRecipe(r.recipe);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const load = async (r: ToneRecipe) => {
    await store.loadRecipe(r);
    onLoaded();
  };

  return (
    <div className="page narrow">
      <h1>Find a tone</h1>
      {!settings.ai.apiKey && <p className="notice">Add an API key in Settings to generate tones. Saved tones in the Library work without one.</p>}
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <label className="field">
          <span>Song</span>
          <input value={song} onChange={(e) => setSong(e.target.value)} placeholder="e.g. Back in Black" autoComplete="off" />
        </label>
        <label className="field">
          <span>Artist or band</span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="e.g. AC/DC" autoComplete="off" />
        </label>
        <label className="field">
          <span>Part (optional)</span>
          <input value={part} onChange={(e) => setPart(e.target.value)} placeholder="rhythm, solo, clean intro…" autoComplete="off" />
        </label>
        <label className="field wide">
          <span>Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. live version, a bit less gain" autoComplete="off" />
        </label>
        <label className="check wide">
          <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
          <span>Search the web for the original rig (for less-known songs, about 5¢ extra)</span>
        </label>
        <div className="wide row-gap wrap">
          <GuitarSwitch label="For" />
          <button className="btn primary" type="submit" disabled={!!busy || (!song.trim() && !artist.trim())}>
            {busy ?? 'Find the tone'}
          </button>
        </div>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <div className="card">
          <p>
            <strong>Already in your library.</strong> Load it, or ask for a new take.
          </p>
          <RecipeSummary recipe={saved} />
          <div className="row-gap">
            <button className="btn primary" type="button" onClick={() => void load(saved)}>
              Load to pedal
            </button>
            <button className="btn" type="button" onClick={() => void find(true)}>
              New take
            </button>
          </div>
        </div>
      )}
      {result && (
        <div className="card">
          <RecipeSummary recipe={result.recipe} fixes={result.fixes} />
          <div className="row-gap">
            <button className="btn primary" type="button" onClick={() => void load(result.recipe)}>
              Load to pedal
            </button>
          </div>
          <form
            className="refine"
            onSubmit={(e) => {
              e.preventDefault();
              void refine();
            }}
          >
            <label className="field grow">
              <span>Adjust it</span>
              <input value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder="brighter · less gain · make B a lead tone" />
            </label>
            <button className="btn" type="submit" disabled={!!busy || !refineText.trim()}>
              Adjust
            </button>
          </form>
          {result.usage && (
            <p className="dim small">
              {result.recipe.model} · {result.usage.inputTokens ?? '?'} in / {result.usage.outputTokens ?? '?'} out tokens
              {result.usage.cacheReadTokens ? ` · ${result.usage.cacheReadTokens} cached` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
