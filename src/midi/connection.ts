// A MIDI connection is one input + one output. It is either a real Web MIDI port pair
// (the USB-MIDI cable) or the in-app virtual Tonelab used for testing without hardware.

export interface MidiConnection {
  readonly id: string;
  readonly name: string;
  readonly virtual: boolean;
  send(bytes: Uint8Array): void;
  /** Returns an unsubscribe function. */
  onMessage(listener: (bytes: Uint8Array) => void): () => void;
  close(): void;
}

export interface PortPair {
  id: string;
  name: string;
  inputId: string;
  outputId: string;
}

export function webMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

let access: MIDIAccess | undefined;

/** Asks for MIDI access with SysEx (the browser shows a permission prompt the first time). */
export async function getMidiAccess(): Promise<MIDIAccess> {
  if (access) return access;
  if (!webMidiSupported()) throw new Error('This browser has no Web MIDI. Use Chrome or Edge (desktop or Android).');
  access = await navigator.requestMIDIAccess({ sysex: true });
  return access;
}

/** Pairs inputs and outputs that share a name (a USB-MIDI cable shows up as both). */
export function listPortPairs(a: MIDIAccess): PortPair[] {
  const outputs = Array.from(a.outputs.values());
  const pairs: PortPair[] = [];
  for (const input of a.inputs.values()) {
    const output = outputs.find((o) => o.name === input.name) ?? (outputs.length === 1 ? outputs[0] : undefined);
    if (output) pairs.push({ id: `${input.id}|${output.id}`, name: input.name ?? 'MIDI port', inputId: input.id, outputId: output.id });
  }
  return pairs;
}

export function openWebMidi(a: MIDIAccess, pair: PortPair): MidiConnection {
  const input = a.inputs.get(pair.inputId);
  const output = a.outputs.get(pair.outputId);
  if (!input || !output) throw new Error(`MIDI port "${pair.name}" is no longer available.`);
  const listeners = new Set<(bytes: Uint8Array) => void>();
  const handler = (e: MIDIMessageEvent) => {
    if (!e.data) return;
    const data = new Uint8Array(e.data);
    for (const l of listeners) l(data);
  };
  input.addEventListener('midimessage', handler as EventListener);
  return {
    id: pair.id,
    name: pair.name,
    virtual: false,
    send: (bytes) => output.send(bytes),
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      input.removeEventListener('midimessage', handler as EventListener);
      listeners.clear();
    },
  };
}
