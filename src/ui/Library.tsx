import { useEffect, useRef, useState } from 'react';
import { store, useStore } from './store';
import { library, downloadText } from '../store/storage';
import { RecipeSummary } from './RecipeSummary';
import { recipeGuitarId, type ToneRecipe } from '../tonelab/recipe';
import { recipeGuitarName } from './GuitarSwitch';

export function Library({ onLoaded }: { onLoaded: () => void }) {
  const items = useStore((s) => s.library);
  const guitars = useStore((s) => s.settings.guitars);
  const activeId = useStore((s) => s.settings.activeGuitarId);
  const showAll = useStore((s) => s.settings.libraryShowAll ?? false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void store.refreshLibrary();
  }, []);

  // Each guitar has its own bank. Picking a guitar's tab makes it the guitar being played;
  // both that and the All view are saved in settings, so the Library reopens where you left it.
  const bank = showAll ? 'all' : activeId;
  const pickGuitar = (id: string) => store.updateSettings({ activeGuitarId: id, libraryShowAll: false });
  const bankGuitar = guitars.find((g) => g.id === bank);
  const n = q.trim().toLowerCase();
  const shown = items.filter(
    (r) =>
      (bank === 'all' || recipeGuitarId(r) === bank) &&
      (!n || [r.request.song, r.request.artist, r.request.part, r.pedal.name, recipeGuitarName(r, guitars)].some((x) => x?.toLowerCase().includes(n))),
  );

  const remove = async (r: ToneRecipe) => {
    if (!confirm(`Delete "${r.pedal.name}" from the library?`)) return;
    await library.remove(r.id);
    await store.refreshLibrary();
  };

  const removeAll = async () => {
    if (!confirm(`Delete all ${items.length} tones, for every guitar, from this browser? Export first if you want to keep a copy.`)) return;
    await library.clear();
    await store.refreshLibrary();
    store.toast('Library cleared', 'ok');
  };

  const addStarter = async () => {
    try {
      const count = await library.addStarterTones();
      await store.refreshLibrary();
      store.toast(`Added ${count} starter tones`, 'ok');
    } catch (err) {
      store.toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="page narrow">
      <h1>Library</h1>
      <div className="row-gap wrap">
        <label className="field grow">
          <span>Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="song, artist, name" />
        </label>
        <button className="btn" type="button" onClick={async () => downloadText('tonelab-library.json', await library.exportJson())}>
          Export
        </button>
        <button className="btn" type="button" onClick={() => file.current?.click()}>
          Import
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              const count = await library.importJson(await f.text());
              await store.refreshLibrary();
              store.toast(`Imported ${count} tones`, 'ok');
            } catch (err) {
              store.toast((err as Error).message, 'error');
            }
            e.target.value = '';
          }}
        />
        <button className="btn" type="button" onClick={() => void addStarter()}>
          Add starter tones
        </button>
        <button className="btn danger" type="button" disabled={!items.length} onClick={() => void removeAll()}>
          Delete all…
        </button>
      </div>
      {guitars.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Guitar">
          {guitars.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={bank === g.id} className={bank === g.id ? 'tab current' : 'tab'} onClick={() => pickGuitar(g.id)}>
              {g.name}
              {g.id === activeId && <span className="dim small"> · playing</span>}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={bank === 'all'} className={bank === 'all' ? 'tab current' : 'tab'} onClick={() => store.updateSettings({ libraryShowAll: true })}>
            All
          </button>
        </div>
      )}
      {!shown.length &&
        (bankGuitar && guitars.length > 1 && !n ? (
          <p className="dim">No tones for the {bankGuitar.name} yet. Find one with this guitar selected, or press "Save my version" on the pedal screen.</p>
        ) : (
          <p className="dim">No saved tones yet. Find one, or press "Save my version" on the pedal screen.</p>
        ))}
      <ul className="lib-list">
        {shown.map((r) => (
          <li key={r.id} className="card">
            <button type="button" className="lib-row" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="lcd small">{r.pedal.name}</span>
              <span className="grow">
                <strong>{[r.request.song, r.request.artist].filter(Boolean).join(' — ') || r.pedal.name}</strong>
                <span className="dim small">
                  {' '}
                  {[r.request.part, r.source === 'edited' ? 'your version' : r.source === 'ai' ? 'AI' : r.source, new Date(r.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}
                </span>
                {bank === 'all' && guitars.length > 1 && <span className="tag">{recipeGuitarName(r, guitars)}</span>}
              </span>
            </button>
            {open === r.id && (
              <>
                <RecipeSummary recipe={r} />
                <div className="row-gap">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={async () => {
                      await store.loadRecipe(r);
                      onLoaded();
                    }}
                  >
                    Load to pedal
                  </button>
                  <button className="btn danger" type="button" onClick={() => void remove(r)}>
                    Delete
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
