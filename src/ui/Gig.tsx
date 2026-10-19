import { store, useStore } from './store';
import { GuitarSwitch, recipeGuitarName } from './GuitarSwitch';
import { activeGuitar } from '../ai/guitar';
import { recipeGuitarId } from '../tonelab/recipe';

const BRIDGE_TEXT = {
  off: 'Off',
  connecting: 'Connecting…',
  live: 'Bridge: instant',
  polling: 'Bridge: polling (up to 0.7 s)',
  unreachable: 'Bridge not running',
} as const;

export function Gig({ onFind }: { onFind: () => void }) {
  const gig = useStore((s) => s.gig);
  const settings = useStore((s) => s.settings);
  const items = useStore((s) => s.library);
  const conn = useStore((s) => s.conn);
  const following = !!settings.gigFollow;
  const guitar = activeGuitar(settings);
  const np = gig.nowPlaying;
  const tone = items.find((r) => r.id === gig.toneId);
  const other = items.find((r) => r.id === gig.otherGuitarToneId);
  const bank = items.filter((r) => recipeGuitarId(r) === guitar.id).sort((a, b) => (a.request.song ?? '').localeCompare(b.request.song ?? ''));
  const linked = gig.track ? settings.trackLinks?.[gig.track.key] : undefined;
  const bridgeOk = gig.bridge === 'live' || gig.bridge === 'polling';
  const winampText = !bridgeOk ? '—' : np?.winamp !== 'running' ? 'Winamp not running' : `Winamp: ${np.state}`;

  return (
    <div className="page narrow gig">
      <div className="row-between wrap">
        <h1>Gig</h1>
        <label className="check gig-follow">
          <input type="checkbox" checked={following} onChange={(e) => (e.target.checked ? store.startFollowing() : store.stopFollowing())} />
          <span>Follow Winamp</span>
        </label>
      </div>

      <div className="gig-status" aria-live="polite">
        <span>
          <span className={`dot ${bridgeOk ? 'connected' : gig.bridge === 'connecting' ? 'connecting' : 'error'}`} /> {BRIDGE_TEXT[gig.bridge]}
        </span>
        <span>
          <span className={`dot ${bridgeOk && np?.winamp === 'running' ? 'connected' : 'error'}`} /> {winampText}
        </span>
        <span>
          <span className={`dot ${conn.status}`} /> {conn.status === 'connected' ? `Pedal: ${conn.name}` : 'Pedal not connected'}
        </span>
        {gig.lastSwitchMs !== undefined && <span className="dim">Switched in {(gig.lastSwitchMs / 1000).toFixed(2)} s</span>}
      </div>

      {following && gig.bridge === 'unreachable' && (
        <div className="notice">
          <strong>The Winamp bridge isn't running.</strong> On this laptop, double-click <code>tools/Winamp bridge.cmd</code> in the app's folder and keep its window open, then start Winamp. The app connects by itself.
        </div>
      )}
      {!following && <p className="dim">Turn on Follow Winamp to load each song's tone as its track starts. Tones load into the pedal's edit buffer only; nothing is stored.</p>}

      {following && (
        <section className="card gig-now">
          <div className="dim small">Now playing</div>
          <div className="gig-track">{gig.track ? [gig.track.artist, gig.track.title].filter(Boolean).join(' – ') : np?.state === 'playing' ? '…' : 'Nothing playing'}</div>
          {gig.track && (
            <>
              {tone ? (
                <div className="gig-tone">
                  <span className="lcd">{tone.pedal.name}</span>
                  <span className="dim">{tone.request.part}</span>
                </div>
              ) : (
                <div className="notice">
                  No tone for “{[gig.track.artist, gig.track.title].filter(Boolean).join(' - ')}” on the {guitar.name}. The pedal keeps its current sound.
                  {other && <> There is one for the {recipeGuitarName(other, settings.guitars)} ({other.pedal.name}).</>}
                  <div className="row-gap" style={{ marginTop: 8 }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        store.prefillFind({ song: gig.track!.title, artist: gig.track!.artist });
                        onFind();
                      }}
                    >
                      Find a tone for it
                    </button>
                  </div>
                </div>
              )}
              <div className="row-gap wrap">
                <label className="field grow">
                  <span>Tone for this track</span>
                  <select value={linked ?? ''} onChange={(e) => store.linkTrack(gig.track!.key, e.target.value || null)}>
                    <option value="">Automatic (match by song name)</option>
                    {bank.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.pedal.name} · {[r.request.song, r.request.part].filter(Boolean).join(' · ')}
                      </option>
                    ))}
                  </select>
                </label>
                <GuitarSwitch label="Playing" />
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
