import { useEffect, useState } from 'react';
import { store, useStore } from './store';
import { webMidiSupported } from '../midi/connection';
import { downloadText } from '../store/storage';
import { fromHex, toHex } from '../tonelab/sysex';
import { pack7 } from '../tonelab/pack';
import { AMP_PARAMS, PROGRAM_COUNT, programLabel } from '../tonelab/spec';

export function MidiBench() {
  const ports = useStore((s) => s.ports);
  const conn = useStore((s) => s.conn);
  const log = useStore((s) => s.log);
  const global = useStore((s) => s.global);
  const program = useStore((s) => s.program);
  const settings = useStore((s) => s.settings);
  const [portId, setPortId] = useState('');
  const [raw, setRaw] = useState('');
  const [slot, setSlot] = useState(0);
  const connected = conn.status === 'connected';

  useEffect(() => {
    if (webMidiSupported()) void store.scanPorts();
  }, []);
  useEffect(() => {
    if (!portId && ports.length) {
      const last = ports.find((p) => p.name === settings.lastPortName);
      setPortId((last ?? ports[0]).id);
    }
  }, [ports, portId, settings.lastPortName]);

  const run = (fn: () => Promise<unknown>) => () => void fn().catch((e) => store.toast((e as Error).message, 'error'));

  return (
    <div className="page">
      <h1>MIDI</h1>
      <section className="card">
        <h2 className="section-title">CONNECTION</h2>
        {!webMidiSupported() && <p className="notice error">This browser has no Web MIDI. Use Chrome or Edge on the laptop, or Chrome on Android. The virtual pedal below still works.</p>}
        <div className="row-gap wrap">
          <label className="field grow">
            <span>MIDI port (your UM-ONE mk2 shows up here)</span>
            <select value={portId} onChange={(e) => setPortId(e.target.value)}>
              {!ports.length && <option value="">No MIDI ports found</option>}
              {ports.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>MIDI channel</span>
            <select value={settings.midiChannel} onChange={(e) => store.updateSettings({ midiChannel: Number(e.target.value) })}>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="button" onClick={() => void store.scanPorts()}>
            Rescan
          </button>
          <button className="btn primary" type="button" disabled={!portId} onClick={() => void store.connect(ports.find((p) => p.id === portId)!)}>
            Connect
          </button>
          <button className="btn" type="button" onClick={() => void store.connect('virtual')}>
            Use virtual pedal
          </button>
          {connected && (
            <button className="btn" type="button" onClick={() => store.disconnect()}>
              Disconnect
            </button>
          )}
        </div>
        <p className="small">
          <span className={`dot ${conn.status}`} /> {conn.status === 'connected' ? `Connected: ${conn.name}${conn.version ? ` (firmware ${conn.version})` : ''}` : conn.status}
          {conn.error && <span className="error-text"> — {conn.error}</span>}
        </p>
        {global && (
          <p className="small">
            Pedal globals: channel {global.midiChannel + 1} · Output {global.outputSelect} · SYEX OUT {global.sysexOut ? 'on' : 'off'} · CCHG I/O {global.controlChangeIO ? 'on' : 'off'} · PCHG OUT {global.programChangeOut ? 'on' : 'off'}
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">TESTS</h2>
        <div className="row-gap wrap">
          <button className="btn" type="button" disabled={!connected} onClick={run(() => store.client!.inquire())}>
            Device inquiry
          </button>
          <button className="btn" type="button" disabled={!connected} onClick={run(() => store.client!.requestMode())}>
            Mode request
          </button>
          <button className="btn" type="button" disabled={!connected} onClick={run(() => store.readEditBuffer())}>
            Read edit buffer
          </button>
          <button
            className="btn"
            type="button"
            disabled={!connected}
            onClick={run(async () => {
              const before = Uint8Array.from(program);
              await store.client!.sendProgram(before);
              const after = await store.client!.requestCurrentProgram();
              const same = after.every((b, i) => b === before[i]);
              store.toast(same ? 'Round trip OK: the pedal returned exactly what was sent.' : `Round trip differs at bytes ${diffBytes(before, after).join(', ')}`, same ? 'ok' : 'error');
            })}
          >
            Round-trip test
          </button>
          <button className="btn" type="button" disabled={!connected} onClick={run(async () => store.set({ global: await store.client!.requestGlobal() }))}>
            Read globals
          </button>
          <button className="btn" type="button" disabled={!connected} onClick={() => void store.backupAll(downloadText)}>
            Full backup
          </button>
        </div>
        <div className="row-gap wrap">
          <label className="field">
            <span>Select program</span>
            <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
              {Array.from({ length: PROGRAM_COUNT }, (_, i) => (
                <option key={i} value={i}>
                  {programLabel(i)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            type="button"
            disabled={!connected}
            onClick={run(async () => {
              store.client!.selectProgram(slot);
              store.set({ slot });
              await new Promise((r) => setTimeout(r, 150));
              await store.readEditBuffer();
            })}
          >
            Send program change
          </button>
        </div>
        <details>
          <summary>Current program bytes (92, decimal offsets) and packed SysEx (106)</summary>
          <pre className="hex">{hexRows(program)}</pre>
          <pre className="hex">{hexRows(pack7(program))}</pre>
        </details>
        <form
          className="row-gap wrap"
          onSubmit={(e) => {
            e.preventDefault();
            const bytes = fromHex(raw);
            if (bytes.length && store.client) store.client.sendRaw(bytes);
          }}
        >
          <label className="field grow">
            <span>Send raw hex (for experiments)</span>
            <input className="mono" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="F0 42 30 6D 08 12 F7" />
          </label>
          <button className="btn" type="submit" disabled={!connected}>
            Send
          </button>
        </form>
      </section>

      {conn.virtual && store.virtual && (
        <section className="card">
          <h2 className="section-title">VIRTUAL PEDAL</h2>
          <p className="small dim">Simulates someone using the hardware, to test the live mirror on the pedal screen.</p>
          <div className="row-gap wrap">
            <button
              className="btn"
              type="button"
              onClick={() => {
                const p = AMP_PARAMS[Math.floor(Math.random() * 7)];
                store.virtual!.turn({ kind: 'ampParam', ch: 'A', key: p.key }, Math.floor(Math.random() * 100));
              }}
            >
              Turn a random amp knob
            </button>
            <button className="btn" type="button" onClick={() => store.virtual!.turn({ kind: 'status', key: 'delay' }, store.virtual!.current[10] & 4 ? 0 : 1)}>
              Stomp the delay switch
            </button>
            <button className="btn" type="button" onClick={() => store.virtual!.footSelect(Math.floor(Math.random() * PROGRAM_COUNT))}>
              Select a program with the foot
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="row-between">
          <h2 className="section-title">LOG</h2>
          <button className="btn small" type="button" onClick={() => downloadText('tonelab-midi-log.txt', log.map((l) => `${new Date(l.at).toISOString()} ${l.dir.toUpperCase()} ${l.summary}\n  ${l.hex}`).join('\n'), 'text/plain')}>
            Save log
          </button>
        </div>
        <ol className="log" aria-live="polite">
          {log
            .slice()
            .reverse()
            .map((l, i) => (
              <li key={`${l.at}-${i}`} className={l.dir}>
                <span className="dir">{l.dir === 'out' ? '→' : '←'}</span>
                <span>{l.summary}</span>
                {l.length > LOG_PREVIEW ? (
                  <details>
                    <summary>
                      <code>
                        {l.hex.split(' ', LOG_PREVIEW).join(' ')} … ({l.length} bytes, click to show all)
                      </code>
                    </summary>
                    <code>{l.hex}</code>
                  </details>
                ) : (
                  <code>{l.hex}</code>
                )}
              </li>
            ))}
        </ol>
      </section>
    </div>
  );
}

/** Log lines longer than this many bytes start collapsed. */
const LOG_PREVIEW = 48;

/** 16 bytes per row, each row prefixed with its decimal offset. */
function hexRows(bytes: Uint8Array): string {
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) rows.push(`${String(i).padStart(3, ' ')}: ${toHex(bytes.subarray(i, i + 16))}`);
  return rows.join('\n');
}

function diffBytes(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out.slice(0, 20);
}
