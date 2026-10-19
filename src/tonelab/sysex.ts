// SysEx message builders and parser for the Tonelab SE (VOX ToneLabSE MIDI Implementation v1.0).
// Header: F0 42 3n 6D 08 <func> ... F7  (n = MIDI channel 0-15)

import { pack7, unpack7 } from './pack';
import { GLOBAL_SIZE, PROGRAM_SIZE } from './spec';

export const KORG_ID = 0x42;
export const VOX_DIGITAL_ID = 0x6d;
export const TONELAB_SE_ID = 0x08;

export const FUNC = {
  MODE_REQUEST: 0x12,
  CURRENT_PROGRAM_DUMP_REQUEST: 0x10,
  PROGRAM_DUMP_REQUEST: 0x1c,
  GLOBAL_DUMP_REQUEST: 0x0e,
  ALL_DUMP_REQUEST: 0x0f,
  PROGRAM_WRITE_REQUEST: 0x11,
  CURRENT_PROGRAM_DUMP: 0x40,
  PROGRAM_DUMP: 0x4c,
  GLOBAL_DUMP: 0x51,
  ALL_DUMP: 0x50,
  MODE_CHANGE: 0x4e,
  PARAMETER_CHANGE: 0x41,
  MODE_DATA: 0x42,
  DATA_FORMAT_ERROR: 0x26,
  DATA_LOAD_COMPLETED: 0x23,
  DATA_LOAD_ERROR: 0x24,
  WRITE_COMPLETED: 0x21,
  WRITE_ERROR: 0x22,
} as const;

export type Mode = 'program' | 'fx'; // Program Select Mode / Fx On-Off Mode (NOTE 6)

const header = (ch: number) => [0xf0, KORG_ID, 0x30 | (ch & 0x0f), VOX_DIGITAL_ID, TONELAB_SE_ID];
const msg = (ch: number, ...body: number[]) => Uint8Array.from([...header(ch), ...body, 0xf7]);

const assert7 = (n: number, what: string) => {
  if (!Number.isInteger(n) || n < 0 || n > 0x7f) throw new RangeError(`${what} must be 0-127, got ${n}`);
};

// ----- builders -----

/** Universal Device Inquiry. Channel 0x7F = any. */
export const deviceInquiry = (ch = 0x7f) => Uint8Array.from([0xf0, 0x7e, ch, 0x06, 0x01, 0xf7]);
export const modeRequest = (ch: number) => msg(ch, FUNC.MODE_REQUEST);
export const currentProgramDumpRequest = (ch: number) => msg(ch, FUNC.CURRENT_PROGRAM_DUMP_REQUEST);
export const globalDumpRequest = (ch: number) => msg(ch, FUNC.GLOBAL_DUMP_REQUEST);
export const allDataDumpRequest = (ch: number) => msg(ch, FUNC.ALL_DUMP_REQUEST);

/** NOTE 7: kind byte 00k0 0000, k = 1 for one program. */
export function programDumpRequest(ch: number, program: number) {
  assert7(program, 'program');
  return msg(ch, FUNC.PROGRAM_DUMP_REQUEST, 0x20, program);
}

/** Stores the edit buffer into a program slot. Only send after the user confirms. */
export function programWriteRequest(ch: number, program: number) {
  assert7(program, 'program');
  return msg(ch, FUNC.PROGRAM_WRITE_REQUEST, 0x00, program);
}

/** Loads a 92-byte program into the edit buffer (current buffer). */
export function currentProgramDump(ch: number, program: Uint8Array) {
  if (program.length !== PROGRAM_SIZE) throw new RangeError(`program must be ${PROGRAM_SIZE} bytes`);
  return msg(ch, FUNC.CURRENT_PROGRAM_DUMP, ...pack7(program));
}

/** Writes one program straight to internal memory (func 4C). Used only to restore backups. */
export function programDumpToMemory(ch: number, program: number, data: Uint8Array) {
  assert7(program, 'program');
  if (data.length !== PROGRAM_SIZE) throw new RangeError(`program must be ${PROGRAM_SIZE} bytes`);
  return msg(ch, FUNC.PROGRAM_DUMP, 0x20, program, ...pack7(data));
}

/** Value is up to 14 bits: MSB = bits 13-7, LSB = bits 6-0. */
export function parameterChange(ch: number, id: number, sub: number, value: number) {
  assert7(id, 'parameter id');
  assert7(sub, 'parameter sub id');
  if (!Number.isInteger(value) || value < 0 || value > 0x3fff) throw new RangeError(`value must be 0-16383, got ${value}`);
  return msg(ch, FUNC.PARAMETER_CHANGE, id, sub, (value >> 7) & 0x7f, value & 0x7f);
}

/** NOTE 6: 0moo 0000. oo = 00 mode + program, 01 mode only, 10 program only. */
export function modeChange(ch: number, opts: { mode?: Mode; program?: number }) {
  const m = opts.mode === 'fx' ? 1 : 0;
  let oo: number;
  if (opts.mode !== undefined && opts.program !== undefined) oo = 0b00;
  else if (opts.mode !== undefined) oo = 0b01;
  else if (opts.program !== undefined) oo = 0b10;
  else throw new Error('modeChange needs a mode or a program');
  const program = opts.program ?? 0;
  assert7(program, 'program');
  return msg(ch, FUNC.MODE_CHANGE, (m << 6) | (oo << 4), program);
}

// ----- parser -----

export type TonelabMessage =
  | { kind: 'deviceInquiryReply'; channel: number; family: number; member: number; version: string }
  | { kind: 'currentProgram'; channel: number; data: Uint8Array }
  | { kind: 'program'; channel: number; program: number; all: boolean; data: Uint8Array }
  | { kind: 'global'; channel: number; data: Uint8Array }
  | { kind: 'allData'; channel: number; data: Uint8Array }
  | { kind: 'parameterChange'; channel: number; id: number; sub: number; value: number }
  | { kind: 'modeChange'; channel: number; mode: Mode; option: number; program: number }
  | { kind: 'modeData'; channel: number; mode: Mode; program: number }
  | { kind: 'ack'; channel: number }
  | { kind: 'nak'; channel: number }
  | { kind: 'formatError'; channel: number }
  | { kind: 'writeCompleted'; channel: number; program: number }
  | { kind: 'writeError'; channel: number; program: number }
  | { kind: 'request'; channel: number; func: number; body: Uint8Array }
  | { kind: 'other'; bytes: Uint8Array };

export function isTonelabSysex(bytes: ArrayLike<number>): boolean {
  return (
    bytes.length >= 7 &&
    bytes[0] === 0xf0 &&
    bytes[1] === KORG_ID &&
    (bytes[2] & 0xf0) === 0x30 &&
    bytes[3] === VOX_DIGITAL_ID &&
    bytes[4] === TONELAB_SE_ID &&
    bytes[bytes.length - 1] === 0xf7
  );
}

export function parse(input: ArrayLike<number>): TonelabMessage {
  const bytes = Uint8Array.from(input as ArrayLike<number>);
  // Device inquiry reply: F0 7E 0n 06 02 42 6D 00 08 00 minL minH majL majH F7
  if (bytes[0] === 0xf0 && bytes[1] === 0x7e && bytes[3] === 0x06 && bytes[4] === 0x02 && bytes.length >= 15) {
    return {
      kind: 'deviceInquiryReply',
      channel: bytes[2] & 0x0f,
      family: bytes[6] | (bytes[7] << 7),
      member: bytes[8] | (bytes[9] << 7),
      version: `${bytes[12] | (bytes[13] << 7)}.${String(bytes[10] | (bytes[11] << 7)).padStart(2, '0')}`,
    };
  }
  if (!isTonelabSysex(bytes)) return { kind: 'other', bytes };
  const channel = bytes[2] & 0x0f;
  const func = bytes[5];
  const body = bytes.subarray(6, bytes.length - 1);
  switch (func) {
    case FUNC.CURRENT_PROGRAM_DUMP:
      return { kind: 'currentProgram', channel, data: unpack7(body) };
    case FUNC.PROGRAM_DUMP:
      return { kind: 'program', channel, all: (body[0] & 0x20) === 0, program: body[1], data: unpack7(body.subarray(2)) };
    case FUNC.GLOBAL_DUMP:
      return { kind: 'global', channel, data: unpack7(body) };
    case FUNC.ALL_DUMP:
      return { kind: 'allData', channel, data: unpack7(body) };
    case FUNC.PARAMETER_CHANGE:
      return { kind: 'parameterChange', channel, id: body[0], sub: body[1], value: (body[2] << 7) | body[3] };
    case FUNC.MODE_CHANGE:
      return { kind: 'modeChange', channel, mode: body[0] & 0x40 ? 'fx' : 'program', option: (body[0] >> 4) & 0x03, program: body[1] };
    case FUNC.MODE_DATA:
      return { kind: 'modeData', channel, mode: body[0] & 0x40 ? 'fx' : 'program', program: body[1] };
    case FUNC.DATA_LOAD_COMPLETED:
      return { kind: 'ack', channel };
    case FUNC.DATA_LOAD_ERROR:
      return { kind: 'nak', channel };
    case FUNC.DATA_FORMAT_ERROR:
      return { kind: 'formatError', channel };
    case FUNC.WRITE_COMPLETED:
      return { kind: 'writeCompleted', channel, program: body[1] };
    case FUNC.WRITE_ERROR:
      return { kind: 'writeError', channel, program: body[1] };
    default:
      return { kind: 'request', channel, func, body: Uint8Array.from(body) };
  }
}

export const isToneLabSE = (m: TonelabMessage) => m.kind === 'deviceInquiryReply' && m.family === VOX_DIGITAL_ID && m.member === TONELAB_SE_ID;

export const EXPECTED_SIZES = { program: PROGRAM_SIZE, global: GLOBAL_SIZE };

export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes as ArrayLike<number>, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function fromHex(text: string): Uint8Array {
  const clean = text.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, ' ').trim();
  if (!clean) return new Uint8Array();
  return Uint8Array.from(clean.split(/\s+/).map((h) => parseInt(h, 16)));
}
