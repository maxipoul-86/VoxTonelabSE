// A software Tonelab SE that speaks the same SysEx protocol as the pedal.
// It lets the whole app (bench, on-screen pedal, tone loading) run without hardware.
// It follows the spec; real-pedal quirks found during hardware testing should be mirrored here.

import type { MidiConnection } from './connection';
import * as sx from '../tonelab/sysex';
import { pack7 } from '../tonelab/pack';
import { GLOBAL_SIZE, PROGRAM_COUNT, PROGRAM_SIZE, GLOBAL } from '../tonelab/spec';
import { blankProgram, controlFromAddress, setName, write, type ControlRef, addressOf, read } from '../tonelab/program';

export class VirtualTonelab implements MidiConnection {
  readonly id = 'virtual-tonelab';
  readonly name = 'Virtual Tonelab SE (no hardware)';
  readonly virtual = true;

  programs: Uint8Array[];
  current: Uint8Array;
  global: Uint8Array;
  mode: sx.Mode = 'program';
  program = 0;
  /** Simulated reply delay in ms. */
  latency = 15;

  private listeners = new Set<(bytes: Uint8Array) => void>();

  constructor(channel = 0) {
    this.programs = Array.from({ length: PROGRAM_COUNT }, (_, i) => setName(blankProgram(), `USER ${String(i + 1).padStart(2, '0')}`));
    this.current = Uint8Array.from(this.programs[0]);
    this.global = new Uint8Array(GLOBAL_SIZE);
    this.global[GLOBAL.midiChannelByte] = channel & 0x0f;
    this.global[GLOBAL.flagsByte] = 0b0000_0111; // PCHG out, CCHG I/O, SysEx out
    this.global[GLOBAL.outputSelectByte] = 1; // Line
  }

  get channel() {
    return this.global[GLOBAL.midiChannelByte] & 0x0f;
  }

  onMessage(listener: (bytes: Uint8Array) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.listeners.clear();
  }

  private emit(bytes: Uint8Array) {
    setTimeout(() => {
      for (const l of this.listeners) l(bytes);
    }, this.latency);
  }

  private reply(func: number, ...body: number[]) {
    this.emit(Uint8Array.from([0xf0, 0x42, 0x30 | this.channel, 0x6d, 0x08, func, ...body, 0xf7]));
  }

  send(bytes: Uint8Array) {
    // Universal device inquiry
    if (bytes[0] === 0xf0 && bytes[1] === 0x7e && bytes[3] === 0x06 && bytes[4] === 0x01) {
      if (bytes[2] === 0x7f || bytes[2] === this.channel) {
        this.emit(Uint8Array.from([0xf0, 0x7e, this.channel, 0x06, 0x02, 0x42, 0x6d, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0xf7]));
      }
      return;
    }
    // Program change
    if ((bytes[0] & 0xf0) === 0xc0 && (bytes[0] & 0x0f) === this.channel && this.mode === 'program') {
      this.selectProgram(bytes[1]);
      return;
    }
    if (!sx.isTonelabSysex(bytes) || (bytes[2] & 0x0f) !== this.channel) return;
    const m = sx.parse(bytes);
    switch (m.kind) {
      case 'currentProgram':
        if (m.data.length !== PROGRAM_SIZE) return this.reply(sx.FUNC.DATA_LOAD_ERROR);
        this.current = Uint8Array.from(m.data);
        return this.reply(sx.FUNC.DATA_LOAD_COMPLETED);
      case 'program':
        if (m.all || m.data.length !== PROGRAM_SIZE || m.program >= PROGRAM_COUNT) return this.reply(sx.FUNC.DATA_LOAD_ERROR);
        this.programs[m.program] = Uint8Array.from(m.data);
        return this.reply(sx.FUNC.DATA_LOAD_COMPLETED);
      case 'global':
        if (m.data.length !== GLOBAL_SIZE) return this.reply(sx.FUNC.DATA_LOAD_ERROR);
        this.global = Uint8Array.from(m.data);
        return this.reply(sx.FUNC.DATA_LOAD_COMPLETED);
      case 'allData':
        if (m.data.length !== PROGRAM_SIZE * 97 + GLOBAL_SIZE) return this.reply(sx.FUNC.DATA_LOAD_ERROR);
        this.programs = this.programs.map((_, i) => m.data.slice(i * PROGRAM_SIZE, (i + 1) * PROGRAM_SIZE));
        this.global = m.data.slice(PROGRAM_SIZE * 97);
        return this.reply(sx.FUNC.DATA_LOAD_COMPLETED);
      case 'parameterChange': {
        const ref = controlFromAddress(this.current, m.id, m.sub);
        if (!ref) return this.reply(sx.FUNC.DATA_LOAD_ERROR);
        this.current = write(this.current, ref, m.value);
        return this.reply(sx.FUNC.DATA_LOAD_COMPLETED);
      }
      case 'modeChange':
        if (m.option !== 0b10) this.mode = m.mode;
        if (m.option !== 0b01) this.selectProgram(m.program);
        return this.reply(sx.FUNC.DATA_LOAD_COMPLETED);
      case 'request':
        return this.handleRequest(m.func, m.body);
      default:
        return this.reply(sx.FUNC.DATA_FORMAT_ERROR);
    }
  }

  private handleRequest(func: number, body: Uint8Array) {
    switch (func) {
      case sx.FUNC.MODE_REQUEST:
        return this.reply(sx.FUNC.MODE_DATA, this.mode === 'fx' ? 0x40 : 0x00, this.program);
      case sx.FUNC.CURRENT_PROGRAM_DUMP_REQUEST:
        return this.reply(sx.FUNC.CURRENT_PROGRAM_DUMP, ...pack7(this.current));
      case sx.FUNC.PROGRAM_DUMP_REQUEST: {
        const p = body[1];
        if (!(body[0] & 0x20) || p >= PROGRAM_COUNT) return this.reply(sx.FUNC.DATA_LOAD_ERROR);
        return this.reply(sx.FUNC.PROGRAM_DUMP, 0x20, p, ...pack7(this.programs[p]));
      }
      case sx.FUNC.GLOBAL_DUMP_REQUEST:
        return this.reply(sx.FUNC.GLOBAL_DUMP, ...pack7(this.global));
      case sx.FUNC.ALL_DUMP_REQUEST: {
        const all = new Uint8Array(PROGRAM_SIZE * 97 + GLOBAL_SIZE);
        this.programs.forEach((p, i) => all.set(p, i * PROGRAM_SIZE));
        all.set(this.global, PROGRAM_SIZE * 97);
        return this.reply(sx.FUNC.ALL_DUMP, ...pack7(all));
      }
      case sx.FUNC.PROGRAM_WRITE_REQUEST: {
        const p = body[1];
        if (p >= PROGRAM_COUNT) return this.reply(sx.FUNC.WRITE_ERROR, 0, p);
        this.programs[p] = Uint8Array.from(this.current);
        return this.reply(sx.FUNC.WRITE_COMPLETED, 0, p);
      }
      default:
        return this.reply(sx.FUNC.DATA_FORMAT_ERROR);
    }
  }

  private selectProgram(p: number) {
    if (p >= PROGRAM_COUNT) return;
    this.program = p;
    this.current = Uint8Array.from(this.programs[p]);
  }

  // ----- simulate someone using the pedal (for testing the live mirror) -----

  /** As if a knob or switch on the pedal was moved: changes the value and sends func 41 (SYEX OUT on). */
  turn(ref: ControlRef, raw: number) {
    this.current = write(this.current, ref, raw);
    const a = addressOf(this.current, ref);
    this.reply(sx.FUNC.PARAMETER_CHANGE, a.id, a.sub, (read(this.current, ref) >> 7) & 0x7f, read(this.current, ref) & 0x7f);
  }

  /** As if a program was selected with the footswitches: sends func 4E. */
  footSelect(p: number) {
    this.selectProgram(p);
    this.reply(sx.FUNC.MODE_CHANGE, this.mode === 'fx' ? 0x40 : 0x00, p);
  }
}
