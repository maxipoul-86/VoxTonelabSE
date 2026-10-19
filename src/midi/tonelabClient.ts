// High-level Tonelab SE client: request/response with timeouts, live events, traffic log.

import type { MidiConnection } from './connection';
import * as sx from '../tonelab/sysex';
import { PROGRAM_SIZE, GLOBAL_SIZE, GLOBAL } from '../tonelab/spec';
import { addressOf, type ControlRef } from '../tonelab/program';

export interface LogEntry {
  at: number;
  dir: 'in' | 'out';
  /** Every byte of the message. */
  hex: string;
  length: number;
  summary: string;
}

export interface GlobalSettings {
  midiChannel: number; // 0-15
  programChangeOut: boolean;
  controlChangeIO: boolean;
  sysexOut: boolean;
  outputSelect: 'Amp' | 'Line';
  raw: Uint8Array;
}

export interface BackupFile {
  kind: 'tonelab-se-backup';
  createdAt: string;
  channel: number;
  /** Hex of the full ALL DATA dump message (func 50). */
  sysexHex: string;
}

type Listener<T> = (value: T) => void;

export class TonelabClient {
  private unsubscribe: () => void;
  private waiters = new Set<{ match: (m: sx.TonelabMessage) => boolean; resolve: (m: sx.TonelabMessage) => void }>();
  private listeners = {
    parameterChange: new Set<Listener<{ id: number; sub: number; value: number }>>(),
    modeChange: new Set<Listener<{ mode: sx.Mode; program: number }>>(),
    currentProgram: new Set<Listener<Uint8Array>>(),
    log: new Set<Listener<LogEntry>>(),
  };
  readonly log: LogEntry[] = [];
  timeoutMs = 3000;

  constructor(
    readonly connection: MidiConnection,
    public channel = 0,
  ) {
    this.unsubscribe = connection.onMessage((bytes) => this.receive(bytes));
  }

  close() {
    this.unsubscribe();
    this.connection.close();
  }

  on<K extends keyof TonelabClient['listeners']>(event: K, listener: Parameters<TonelabClient['listeners'][K]['add']>[0]): () => void {
    const set = this.listeners[event] as Set<unknown>;
    set.add(listener);
    return () => set.delete(listener);
  }

  // ----- traffic -----

  sendRaw(bytes: Uint8Array) {
    this.record('out', bytes);
    this.connection.send(bytes);
  }

  private receive(bytes: Uint8Array) {
    this.record('in', bytes);
    const m = sx.parse(bytes);
    for (const w of this.waiters) {
      if (w.match(m)) {
        this.waiters.delete(w);
        w.resolve(m);
      }
    }
    if (m.kind === 'parameterChange') for (const l of this.listeners.parameterChange) l(m);
    if (m.kind === 'modeChange') for (const l of this.listeners.modeChange) l(m);
    if (m.kind === 'currentProgram') for (const l of this.listeners.currentProgram) l(m.data);
  }

  private record(dir: 'in' | 'out', bytes: Uint8Array) {
    const entry: LogEntry = { at: Date.now(), dir, hex: sx.toHex(bytes), length: bytes.length, summary: describe(bytes) };
    this.log.push(entry);
    if (this.log.length > 500) this.log.shift();
    for (const l of this.listeners.log) l(entry);
  }

  private waitFor<T extends sx.TonelabMessage>(match: (m: sx.TonelabMessage) => m is T, what: string, timeoutMs = this.timeoutMs): Promise<T> {
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve: (m: sx.TonelabMessage) => (clearTimeout(timer), resolve(m as T)) };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`No answer from the pedal (${what}). Check both MIDI cables, the MIDI channel, and that the pedal is on.`));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  private async request<T extends sx.TonelabMessage>(bytes: Uint8Array, match: (m: sx.TonelabMessage) => m is T, what: string, timeoutMs?: number): Promise<T> {
    const p = this.waitFor(match, what, timeoutMs);
    this.sendRaw(bytes);
    return p;
  }

  private async expectAck(bytes: Uint8Array, what: string): Promise<void> {
    const m = await this.request(bytes, (x): x is sx.TonelabMessage => ['ack', 'nak', 'formatError'].includes(x.kind), what);
    if (m.kind === 'nak') throw new Error(`The pedal refused the data (${what}).`);
    if (m.kind === 'formatError') throw new Error(`The pedal reported a data format error (${what}).`);
  }

  // ----- operations -----

  /** Finds the pedal and its MIDI channel. */
  async inquire(timeoutMs = 1500) {
    const m = await this.request(sx.deviceInquiry(0x7f), (x): x is Extract<sx.TonelabMessage, { kind: 'deviceInquiryReply' }> => x.kind === 'deviceInquiryReply', 'device inquiry', timeoutMs);
    if (!sx.isToneLabSE(m)) throw new Error(`A device answered, but it is not a Tonelab SE (family ${m.family}, member ${m.member}).`);
    this.channel = m.channel;
    return m;
  }

  async requestMode() {
    return this.request(sx.modeRequest(this.channel), (x): x is Extract<sx.TonelabMessage, { kind: 'modeData' }> => x.kind === 'modeData', 'mode request');
  }

  /** Reads the edit buffer. */
  async requestCurrentProgram(): Promise<Uint8Array> {
    const m = await this.request(sx.currentProgramDumpRequest(this.channel), (x): x is Extract<sx.TonelabMessage, { kind: 'currentProgram' }> => x.kind === 'currentProgram', 'current program');
    if (m.data.length !== PROGRAM_SIZE) throw new Error(`Unexpected program size ${m.data.length} (expected ${PROGRAM_SIZE}).`);
    return m.data;
  }

  async requestProgram(program: number): Promise<Uint8Array> {
    const m = await this.request(sx.programDumpRequest(this.channel, program), (x): x is Extract<sx.TonelabMessage, { kind: 'program' }> => x.kind === 'program' && x.program === program, `program ${program}`);
    return m.data;
  }

  /** Loads a program into the edit buffer only. Nothing is stored until writeProgram(). */
  async sendProgram(data: Uint8Array) {
    await this.expectAck(sx.currentProgramDump(this.channel, data), 'load program');
  }

  /** Live edit of one control. Does not wait for the ACK, so knob drags stay smooth. */
  setControl(program: Uint8Array, ref: ControlRef, raw: number) {
    const a = addressOf(program, ref);
    this.sendRaw(sx.parameterChange(this.channel, a.id, a.sub, raw));
  }

  /** Stores the edit buffer into a slot (0-95). Only call after the user confirms. */
  async writeProgram(program: number) {
    const m = await this.request(sx.programWriteRequest(this.channel, program), (x): x is sx.TonelabMessage => x.kind === 'writeCompleted' || x.kind === 'writeError', 'write program');
    if (m.kind === 'writeError') throw new Error(`The pedal could not store program ${program}.`);
  }

  selectProgram(program: number) {
    this.sendRaw(Uint8Array.from([0xc0 | this.channel, program & 0x7f]));
  }

  async requestGlobal(): Promise<GlobalSettings> {
    const m = await this.request(sx.globalDumpRequest(this.channel), (x): x is Extract<sx.TonelabMessage, { kind: 'global' }> => x.kind === 'global', 'global settings');
    return decodeGlobal(m.data);
  }

  /** Full backup (all programs + global). Large: give it time. */
  async backupAll(): Promise<BackupFile> {
    let raw: Uint8Array | undefined;
    const off = this.connection.onMessage((b) => {
      if (sx.isTonelabSysex(b) && b[5] === sx.FUNC.ALL_DUMP) raw = b;
    });
    try {
      await this.request(sx.allDataDumpRequest(this.channel), (x): x is Extract<sx.TonelabMessage, { kind: 'allData' }> => x.kind === 'allData', 'full backup', 20000);
    } finally {
      off();
    }
    if (!raw) throw new Error('Backup data was not captured.');
    return { kind: 'tonelab-se-backup', createdAt: new Date().toISOString(), channel: this.channel, sysexHex: sx.toHex(raw) };
  }

  /** Sends a saved ALL DATA dump back. Overwrites every program on the pedal. */
  async restoreAll(backup: BackupFile) {
    const bytes = sx.fromHex(backup.sysexHex);
    bytes[2] = 0x30 | this.channel;
    const m = await this.request(bytes, (x): x is sx.TonelabMessage => ['ack', 'nak', 'formatError'].includes(x.kind), 'restore backup', 20000);
    if (m.kind !== 'ack') throw new Error('The pedal did not accept the backup.');
  }
}

export function decodeGlobal(data: Uint8Array): GlobalSettings {
  if (data.length < GLOBAL_SIZE) throw new Error('Global data too short');
  const f = data[GLOBAL.flagsByte];
  return {
    midiChannel: data[GLOBAL.midiChannelByte] & 0x0f,
    programChangeOut: !!(f & 1),
    controlChangeIO: !!(f & 2),
    sysexOut: !!(f & 4),
    outputSelect: data[GLOBAL.outputSelectByte] ? 'Line' : 'Amp',
    raw: data,
  };
}

/** One-line description of a MIDI message for the log. */
export function describe(bytes: Uint8Array): string {
  const status = bytes[0];
  if ((status & 0xf0) === 0xc0) return `Program change ${bytes[1]} (ch ${(status & 0x0f) + 1})`;
  if ((status & 0xf0) === 0xb0) return `Control change CC${bytes[1]} = ${bytes[2]} (ch ${(status & 0x0f) + 1})`;
  if (status !== 0xf0) return 'Other MIDI';
  if (bytes[1] === 0x7e && bytes[4] === 0x01) return 'Device inquiry';
  const m = sx.parse(bytes);
  switch (m.kind) {
    case 'deviceInquiryReply':
      return `Device reply: ${sx.isToneLabSE(m) ? 'Tonelab SE' : 'other device'} v${m.version}, ch ${m.channel + 1}`;
    case 'currentProgram':
      return `Current program dump (${m.data.length} bytes)`;
    case 'program':
      return `Program dump #${m.program}`;
    case 'global':
      return 'Global data dump';
    case 'allData':
      return `All data dump (${m.data.length} bytes)`;
    case 'parameterChange':
      return `Parameter change ${hex2(m.id)},${hex2(m.sub)} = ${m.value}`;
    case 'modeChange':
      return `Mode change: ${m.mode}, program ${m.program}`;
    case 'modeData':
      return `Mode: ${m.mode}, program ${m.program}`;
    case 'ack':
      return 'OK (data load completed)';
    case 'nak':
      return 'ERROR (data load error)';
    case 'formatError':
      return 'ERROR (data format)';
    case 'writeCompleted':
      return `Write completed to ${m.program}`;
    case 'writeError':
      return `Write error at ${m.program}`;
    case 'request':
      return `Request func ${hex2(m.func)}`;
    default:
      return 'Other SysEx';
  }
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
