import { useState } from 'react';
import { store, useStore } from './store';
import { DEFAULT_MODELS, type ProviderId } from '../ai/providers';
import { activeGuitar, blankGuitar, type GuitarKind, type GuitarProfile, type PiezoGuitar, type SplitGuitar } from '../ai/guitar';
import { newId } from '../tonelab/recipe';
import { WebSearchSelect } from './WebSearchSelect';

export function Settings() {
  const s = useStore((x) => x.settings);
  const ai = s.ai;
  const setAi = (patch: Partial<typeof ai>) => store.updateSettings({ ai: { ...ai, ...patch } });
  const [editId, setEditId] = useState(s.activeGuitarId);
  const [newKind, setNewKind] = useState<GuitarKind>('split');
  const guitar = s.guitars.find((g) => g.id === editId) ?? activeGuitar(s);
  // Patch fields of the guitar being edited; the cast keeps the union happy, the form only shows fields of its kind.
  const setGuitar = (patch: Partial<SplitGuitar> | Partial<PiezoGuitar>) =>
    store.updateSettings({ guitars: s.guitars.map((g) => (g.id === guitar.id ? ({ ...g, ...patch } as GuitarProfile) : g)) });
  const addGuitar = () => {
    const g = blankGuitar(newKind, newId());
    store.updateSettings({ guitars: [...s.guitars, g] });
    setEditId(g.id);
  };
  const removeGuitar = () => {
    if (s.guitars.length < 2 || !confirm(`Remove ${guitar.name}? Its tones stay in the Library under All.`)) return;
    const guitars = s.guitars.filter((g) => g.id !== guitar.id);
    store.updateSettings({ guitars, activeGuitarId: s.activeGuitarId === guitar.id ? guitars[0].id : s.activeGuitarId });
    setEditId(guitars[0].id);
  };

  return (
    <div className="page narrow">
      <h1>Settings</h1>
      <section className="card form-grid">
        <h2 className="section-title wide">AI</h2>
        <label className="field">
          <span>Provider</span>
          <select
            value={ai.provider}
            onChange={(e) => {
              const provider = e.target.value as ProviderId;
              setAi({ provider, ...DEFAULT_MODELS[provider] });
            }}
          >
            <option value="anthropic">Anthropic (Claude API)</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </label>
        <label className="field">
          <span>API key</span>
          <input type="password" value={ai.apiKey} onChange={(e) => setAi({ apiKey: e.target.value.trim() })} autoComplete="off" placeholder={ai.provider === 'anthropic' ? 'sk-ant-…' : 'sk-or-…'} />
        </label>
        <label className="field">
          <span>Model for new tones</span>
          <input value={ai.model} onChange={(e) => setAi({ model: e.target.value.trim() })} />
        </label>
        <label className="field">
          <span>Model for small adjustments</span>
          <input value={ai.fastModel} onChange={(e) => setAi({ fastModel: e.target.value.trim() })} />
        </label>
        <label className="field wide">
          <span>Web search for new tones</span>
          <WebSearchSelect value={ai.webSearch} onChange={(webSearch) => setAi({ webSearch })} provider={ai.provider} />
        </label>
        <p className="small dim wide">The key is stored only in this browser on this device and sent only to the provider you pick.</p>
      </section>

      <section className="card form-grid">
        <h2 className="section-title wide">GUITARS</h2>
        <label className="field">
          <span>Edit</span>
          <select value={guitar.id} onChange={(e) => setEditId(e.target.value)}>
            {s.guitars.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="radio" name="playing" checked={guitar.id === s.activeGuitarId} onChange={() => store.setActiveGuitar(guitar.id)} />
          <span>Playing now</span>
        </label>
        <label className="field wide">
          <span>Name</span>
          <input value={guitar.name} onChange={(e) => setGuitar({ name: e.target.value })} />
        </label>
        {guitar.kind === 'split' ? (
          <>
            <label className="field">
              <span>Bridge pickup</span>
              <input value={guitar.bridgePickup} onChange={(e) => setGuitar({ bridgePickup: e.target.value })} />
            </label>
            <label className="field">
              <span>Neck pickup</span>
              <input value={guitar.neckPickup} onChange={(e) => setGuitar({ neckPickup: e.target.value })} />
            </label>
            <label className="field wide">
              <span>Coil split</span>
              <input value={guitar.coilSplit} onChange={(e) => setGuitar({ coilSplit: e.target.value })} />
            </label>
          </>
        ) : (
          <>
            <label className="field wide">
              <span>Pickup</span>
              <input value={guitar.pickup} onChange={(e) => setGuitar({ pickup: e.target.value })} />
            </label>
            <label className="field wide">
              <span>Controls</span>
              <input value={guitar.controls} onChange={(e) => setGuitar({ controls: e.target.value })} />
            </label>
          </>
        )}
        <label className="field wide">
          <span>Other notes for the AI</span>
          <input value={guitar.notes} onChange={(e) => setGuitar({ notes: e.target.value })} placeholder="e.g. 10-46 strings, standard tuning" />
        </label>
        <div className="wide row-gap wrap">
          <label className="field">
            <span>Add a guitar with</span>
            <select value={newKind} onChange={(e) => setNewKind(e.target.value as GuitarKind)}>
              <option value="split">Magnetic pickups, selector and coil split</option>
              <option value="piezo">Piezo with volume and 3-band EQ</option>
            </select>
          </label>
          <button className="btn" type="button" onClick={addGuitar}>
            Add guitar
          </button>
          <button className="btn danger" type="button" disabled={s.guitars.length < 2} onClick={removeGuitar}>
            Remove {guitar.name}
          </button>
        </div>
        <p className="small dim wide">Tones remember the guitar they were made for. The Library keeps a bank of tones per guitar.</p>
      </section>

      <section className="card form-grid">
        <h2 className="section-title wide">RIG</h2>
        <label className="field">
          <span>Pedal output</span>
          <select value={s.rig.output} onChange={(e) => store.updateSettings({ rig: { ...s.rig, output: e.target.value as 'Line' | 'Amp' } })}>
            <option value="Line">Line (mixer / PA)</option>
            <option value="Amp">Amp (guitar amp)</option>
          </select>
        </label>
        <label className="field wide">
          <span>Description</span>
          <input value={s.rig.description} onChange={(e) => store.updateSettings({ rig: { ...s.rig, description: e.target.value } })} />
        </label>
      </section>
    </div>
  );
}
