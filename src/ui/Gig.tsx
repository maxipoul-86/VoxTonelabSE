import { useState } from 'react';
import { store, useStore } from './store';
import { GuitarSwitch, recipeGuitarName } from './GuitarSwitch';
import { CloseButton, Modal } from './Modal';
import { FindTone } from './FindTone';
import { activeGuitar } from '../ai/guitar';
import { recipeGuitarId } from '../tonelab/recipe';
import { songTitle, suggestTones } from '../gig/match';

const BRIDGE_TEXT = {
  off: 'Off',
  connecting: 'Connecting…',
  live: 'Bridge: instant',
  polling: 'Bridge: polling (up to 0.7 s)',
  unreachable: 'Bridge not running',
} as const;

/** One line for the Pedal screen while following the player: what's playing and which tone it got. Tap it for the Gig screen in a pop-up. */
export function GigStrip() {
  const [open, setOpen] = useState(false);
  const gig = useStore((s) => s.gig);
  const following = useStore((s) => !!s.settings.gigFollow);
  const items = useStore((s) => s.library);
  if (!following) return null;
  const np = gig.nowPlaying;
  const bridgeOk = gig.bridge === 'live' || gig.bridge === 'polling';
  const tone = items.find((r) => r.id === gig.toneId);
  const status = !bridgeOk ? BRIDGE_TEXT[gig.bridge] : !np?.running ? `${np?.player ?? 'Player'} not running` : `${np.player}: ${np.state}`;
  return (
    <>
      <button type="button" className="gig-strip" onClick={() => setOpen(true)} title="Show the Gig details">
        <span className={`dot ${bridgeOk && np?.running ? 'connected' : 'error'}`} />
        <span className="dim">{status}</span>
        {bridgeOk && gig.track && (
          <>
            <span className="gig-strip-track">{[gig.track.artist, gig.track.title].filter(Boolean).join(' – ')}</span>
            {tone ? <span className="lcd small">{tone.pedal.name}</span> : <span className="gig-strip-warn">no tone</span>}
            {tone && gig.toneDoubt && (
              <span className="gig-strip-warn" title={`Matched by song title only: ${gig.toneDoubt}`}>
                close match
              </span>
            )}
          </>
        )}
        {gig.lastSwitchMs !== undefined && <span className="dim">{(gig.lastSwitchMs / 1000).toFixed(2)} s</span>}
      </button>
      {open && (
        <Modal label="Gig" onClose={() => setOpen(false)}>
          <Gig onClose={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

/** The Winamp and Spotify bridges as a zip (loaded on demand, it carries the scripts). */
function DownloadBridge() {
  return (
    <button className="btn small" type="button" onClick={() => void import('../gig/bridgeDownload').then((m) => m.downloadBridge())}>
      Download the bridge (.zip)
    </button>
  );
}

/** The Gig screen; with onClose it is shown in a pop-up. */
export function Gig({ onClose }: { onClose?: () => void }) {
  const [finding, setFinding] = useState(false);
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
  const playerText = !bridgeOk || !np ? '—' : np.running ? `${np.player}: ${np.state}` : `${np.player} not running`;
  const suggestions = gig.track && !tone ? suggestTones(gig.track, items, guitar.id) : [];

  return (
    <div className="page narrow gig">
      <div className="row-between wrap">
        <h1>Gig</h1>
        <label className="check gig-follow">
          <input type="checkbox" checked={following} onChange={(e) => (e.target.checked ? store.startFollowing() : store.stopFollowing())} />
          <span>Follow Winamp or Spotify</span>
        </label>
        {onClose && <CloseButton onClose={onClose} />}
      </div>

      <div className="gig-status" aria-live="polite">
        <span>
          <span className={`dot ${bridgeOk ? 'connected' : gig.bridge === 'connecting' ? 'connecting' : 'error'}`} /> {BRIDGE_TEXT[gig.bridge]}
        </span>
        <span>
          <span className={`dot ${bridgeOk && np?.running ? 'connected' : 'error'}`} /> {playerText}
        </span>
        <span>
          <span className={`dot ${conn.status}`} /> {conn.status === 'connected' ? `Pedal: ${conn.name}` : 'Pedal not connected'}
        </span>
        {gig.lastSwitchMs !== undefined && <span className="dim">Switched in {(gig.lastSwitchMs / 1000).toFixed(2)} s</span>}
      </div>

      {following && gig.bridge === 'unreachable' && (
        <div className="notice">
          <strong>The player bridge isn't running.</strong> On this laptop, double-click <code>Spotify bridge.cmd</code> or <code>Winamp bridge.cmd</code> and keep its window open, then start the player. The app connects by itself.
          <div className="row-gap" style={{ marginTop: 8 }}>
            <DownloadBridge />
          </div>
        </div>
      )}
      {!following && <p className="dim">Turn on Follow Winamp or Spotify to load each song's tone as its track starts. Tones load into the pedal's edit buffer only; nothing is stored.</p>}

      {following && (
        <section className="card gig-now">
          <div className="dim small">Now playing</div>
          <div className="gig-track">{gig.track ? [gig.track.artist, gig.track.title].filter(Boolean).join(' – ') : np?.state === 'playing' ? '…' : 'Nothing playing'}</div>
          {gig.track && (
            <>
              {tone ? (
                <>
                  <div className="gig-tone">
                    <span className="lcd">{tone.pedal.name}</span>
                    <span className="dim">{tone.request.part}</span>
                  </div>
                  {gig.toneDoubt && (
                    <div className="notice">
                      <strong>Close match, not confirmed:</strong> found by song title only, and {gig.toneDoubt}. Check it's the right tone, then keep it or pick another below.
                      <div className="row-gap" style={{ marginTop: 8 }}>
                        <button className="btn" type="button" onClick={() => store.linkTrack(gig.track!.key, tone.id)}>
                          Keep it for this track
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="notice">
                  No tone for “{[gig.track.artist, gig.track.title].filter(Boolean).join(' - ')}” on the {guitar.name}. The pedal keeps its current sound.
                  {other && <> There is one for the {recipeGuitarName(other, settings.guitars)} ({other.pedal.name}).</>}
                  {!!suggestions.length && (
                    <div className="gig-suggest">
                      <span className="dim small">Closest in your library (tap to use it for this track):</span>
                      <div className="row-gap wrap">
                        {suggestions.map((r) => (
                          <button key={r.id} className="btn small" type="button" onClick={() => store.linkTrack(gig.track!.key, r.id)}>
                            <span className="lcd small">{r.pedal.name}</span> {[r.request.song, r.request.artist].filter(Boolean).join(' – ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="row-gap" style={{ marginTop: 8 }}>
                    <button className="btn" type="button" onClick={() => setFinding(true)}>
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
      {!(following && gig.bridge === 'unreachable') && (
        <p className="dim small row-gap wrap">
          <span>The bridge runs on the Windows laptop next to the player.</span>
          <DownloadBridge />
        </p>
      )}
      {finding && gig.track && (
        <Modal label="Find a tone" onClose={() => setFinding(false)}>
          <FindTone
            prefill={{ song: songTitle(gig.track.title), artist: gig.track.artist, trackKey: gig.track.key }}
            onLoaded={() => setFinding(false)}
            onClose={() => setFinding(false)}
          />
        </Modal>
      )}
    </div>
  );
}
