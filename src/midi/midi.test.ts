import { describe, expect, it } from 'vitest';
import { VirtualTonelab } from './virtualTonelab';
import { TonelabClient } from './tonelabClient';
import { applyRecipe } from '../tonelab/recipe';
import { getName, read } from '../tonelab/program';

function setup() {
  const pedal = new VirtualTonelab(0);
  pedal.latency = 0;
  const client = new TonelabClient(pedal);
  return { pedal, client };
}

describe('client against the virtual Tonelab', () => {
  it('finds the pedal', async () => {
    const { client } = setup();
    const reply = await client.inquire();
    expect(reply.member).toBe(8);
    expect(client.channel).toBe(0);
  });

  it('loads a program into the edit buffer and reads it back', async () => {
    const { client, pedal } = setup();
    const { bytes } = applyRecipe({
      name: 'TEST',
      channelA: { amp: 'AC30TB', cabinet: 'VOX AC30', gain: 4, vrGain: 5, treble: 6, middle: 5, bass: 5, presence: 5, volume: 6, nr: 1 },
      pedal: { on: false },
      mod: { on: false },
      delay: { on: false },
      reverb: { on: true, type: 'SPRING 1', params: { mix: 3 } },
    });
    await client.sendProgram(bytes);
    expect(Array.from(pedal.current)).toEqual(Array.from(bytes));
    expect(pedal.programs[0]).not.toEqual(bytes); // nothing stored
    const back = await client.requestCurrentProgram();
    expect(getName(back)).toBe('TEST');
  });

  it('stores only on an explicit write', async () => {
    const { client, pedal } = setup();
    const { bytes } = applyRecipe({
      name: 'STORED',
      channelA: { amp: 'RECTO', cabinet: 'US V30 4x12', gain: 8, vrGain: 7, treble: 6, middle: 4, bass: 6, presence: 6, volume: 6, nr: 4 },
      pedal: { on: false },
      mod: { on: false },
      delay: { on: false },
      reverb: { on: false },
    });
    await client.sendProgram(bytes);
    await client.writeProgram(10);
    expect(getName(pedal.programs[10])).toBe('STORED');
  });

  it('applies live parameter changes and mirrors pedal knob moves', async () => {
    const { client, pedal } = setup();
    client.setControl(pedal.current, { kind: 'ampParam', ch: 'A', key: 'treble' }, 68);
    await new Promise((r) => setTimeout(r, 5));
    expect(read(pedal.current, { kind: 'ampParam', ch: 'A', key: 'treble' })).toBe(68);

    const seen: { id: number; sub: number; value: number }[] = [];
    client.on('parameterChange', (m) => seen.push(m));
    pedal.turn({ kind: 'ampParam', ch: 'B', key: 'gain' }, 75);
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([{ kind: 'parameterChange', channel: 0, id: 0x0a, sub: 0x00, value: 75 }]);
  });

  it('reads the global settings', async () => {
    const { client } = setup();
    const g = await client.requestGlobal();
    expect(g.outputSelect).toBe('Line');
    expect(g.sysexOut).toBe(true);
  });

  it('takes and restores a full backup', async () => {
    const { client, pedal } = setup();
    const backup = await client.backupAll();
    expect(backup.sysexHex.split(' ')).toHaveLength(5 + 1 + 10218 + 1);
    const before = Uint8Array.from(pedal.programs[3]);
    pedal.programs[3] = new Uint8Array(92);
    await client.restoreAll(backup);
    expect(Array.from(pedal.programs[3])).toEqual(Array.from(before));
  });

  it('times out cleanly when nothing answers', async () => {
    const silent = { id: 'x', name: 'x', virtual: true, send() {}, onMessage: () => () => {}, close() {} };
    const client = new TonelabClient(silent);
    client.timeoutMs = 20;
    await expect(client.requestCurrentProgram()).rejects.toThrow(/No answer/);
  });
});
