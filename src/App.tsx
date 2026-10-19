import { useEffect, useState } from 'react';
import { PedalPanel } from './ui/PedalPanel';
import { FindTone } from './ui/FindTone';
import { Library } from './ui/Library';
import { MidiBench } from './ui/MidiBench';
import { Settings } from './ui/Settings';
import { Gig } from './ui/Gig';
import { store, useStore } from './ui/store';

type Tab = 'pedal' | 'find' | 'library' | 'gig' | 'midi' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'pedal', label: 'Pedal' },
  { id: 'find', label: 'Find' },
  { id: 'library', label: 'Library' },
  { id: 'gig', label: 'Gig' },
  { id: 'midi', label: 'MIDI' },
  { id: 'settings', label: 'Settings' },
];

function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), toast.kind === 'error' ? 9000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} onClick={() => setVisible(false)}>
      {toast.text}
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || 'pedal');
  const conn = useStore((s) => s.conn);
  useEffect(() => {
    void store.refreshLibrary();
    // Following Winamp stays on between sessions, so a gig laptop is ready when the app opens.
    if (store.state.settings.gigFollow) store.startFollowing();
  }, []);
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  return (
    <div className="app">
      <nav className="tabs" aria-label="Sections">
        <span className="brand">Tonelab SE</span>
        {TABS.map((t) => (
          <button key={t.id} type="button" className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'midi' && <span className={`dot ${conn.status}`} aria-label={conn.status} />}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'pedal' && <PedalPanel />}
        {tab === 'find' && <FindTone onLoaded={() => setTab('pedal')} />}
        {tab === 'library' && <Library onLoaded={() => setTab('pedal')} />}
        {tab === 'gig' && <Gig onFind={() => setTab('find')} />}
        {tab === 'midi' && <MidiBench />}
        {tab === 'settings' && <Settings />}
      </main>
      <Toast />
    </div>
  );
}
