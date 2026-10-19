// App state in one small store (no framework). Components subscribe with useStore().

import { useSyncExternalStore } from 'react';
import { getMidiAccess, listPortPairs, openWebMidi, type PortPair } from '../midi/connection';
import { TonelabClient, type GlobalSettings, type LogEntry } from '../midi/tonelabClient';
import { VirtualTonelab } from '../midi/virtualTonelab';
import { blankProgram, controlFromAddress, read, write, type ControlRef } from '../tonelab/program';
import { applyRecipe, defaultSetup, newId, readRecipe, recipeGuitarId, type ToneRecipe } from '../tonelab/recipe';
import { activeGuitar } from '../ai/guitar';
import { programLabel } from '../tonelab/spec';
import { backups, library, loadSettings, saveSettings, type AppSettings } from '../store/storage';
import { learnedEdits } from '../ai/engine';
import { findTone, parseTrack, type Track } from '../gig/match';
import { connectBridge, type BridgeHandle, type NowPlaying } from '../gig/bridge';

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface AppState {
  settings: AppSettings;
  ports: PortPair[];
  conn: { status: ConnStatus; name?: string; virtual?: boolean; version?: string; error?: string };
  /** Mirror of the pedal's edit buffer (or an offline working copy). */
  program: Uint8Array;
  /** Program as the loaded recipe defined it: knobs that differ are "changed from recipe". */
  baseline: Uint8Array | null;
  recipe: ToneRecipe | null;
  slot?: number;
  global?: GlobalSettings;
  lastFromPedal?: string;
  log: LogEntry[];
  library: ToneRecipe[];
  toast?: { text: string; kind: 'info' | 'error' | 'ok'; at: number };
  gig: GigState;
}

/** Following Winamp: bridge status, what's playing and which tone it got. */
export interface GigState {
  bridge: 'off' | 'connecting' | 'live' | 'polling' | 'unreachable';
  nowPlaying?: NowPlaying;
  track?: Track;
  toneId?: string;
  otherGuitarToneId?: string;
  /** Time from the bridge seeing the track change to the pedal's ACK. */
  lastSwitchMs?: number;
}

type Listener = () => void;

class Store {
  state: AppState = {
    settings: loadSettings(),
    ports: [],
    conn: { status: 'disconnected' },
    program: blankProgram(),
    baseline: null,
    recipe: null,
    log: [],
    library: [],
    gig: { bridge: 'off' },
  };
  client: TonelabClient | null = null;
  virtual: VirtualTonelab | null = null;
  private listeners = new Set<Listener>();
  private offs: (() => void)[] = [];
  private lastSend = new Map<string, number>();

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;

  set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  toast(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
    this.set({ toast: { text, kind, at: Date.now() } });
  }

  // ----- settings / library -----

  updateSettings(patch: Partial<AppSettings>) {
    const guitarChanged = patch.activeGuitarId !== undefined && patch.activeGuitarId !== this.state.settings.activeGuitarId;
    const settings = { ...this.state.settings, ...patch };
    saveSettings(settings);
    this.set({ settings });
    // Swapping guitars mid-song at a gig: load the current track's tone for the new guitar.
    if (guitarChanged && this.bridge && this.state.gig.track) void this.applyTrack(this.state.gig.track);
  }

  /** The guitar being played now. */
  get guitar() {
    return activeGuitar(this.state.settings);
  }

  setActiveGuitar(id: string) {
    this.updateSettings({ activeGuitarId: id });
  }

  async refreshLibrary() {
    try {
      this.set({ library: await library.all() });
    } catch (e) {
      this.toast(`Could not open the library: ${(e as Error).message}`, 'error');
    }
  }

  // ----- gig: follow Winamp -----

  private bridge: BridgeHandle | null = null;
  /** "index|title" of the last track handled, so pausing and resuming doesn't reload it. */
  private handledTrack: string | null = null;

  private setGig(patch: Partial<GigState>) {
    this.set({ gig: { ...this.state.gig, ...patch } });
  }

  /** Start loading each Winamp track's tone as it starts. Remembered for next time. */
  startFollowing() {
    this.bridge?.close();
    this.handledTrack = null;
    if (!this.state.settings.gigFollow) this.updateSettings({ gigFollow: true });
    this.bridge = connectBridge(
      (s) => this.onSnapshot(s),
      (bridge) => this.setGig({ bridge }),
    );
  }

  stopFollowing() {
    this.bridge?.close();
    this.bridge = null;
    this.updateSettings({ gigFollow: false });
    this.set({ gig: { bridge: 'off' } });
  }

  private onSnapshot(s: NowPlaying) {
    this.setGig({ nowPlaying: s });
    if (s.winamp !== 'running' || s.state !== 'playing') return;
    const id = `${s.index}|${s.title}`;
    if (id === this.handledTrack) return;
    this.handledTrack = id;
    void this.applyTrack(parseTrack(s), s.changedAt);
  }

  /** Find the track's tone for the guitar being played and load it into the edit buffer. */
  private async applyTrack(track: Track, changedAt?: number) {
    const { recipe, otherGuitar } = findTone(track, this.state.library, this.guitar.id, this.state.settings.trackLinks);
    this.setGig({ track, toneId: recipe?.id, otherGuitarToneId: otherGuitar?.id, lastSwitchMs: undefined });
    if (!recipe || this.state.recipe?.id === recipe.id) return;
    const sent = await this.loadRecipe(recipe);
    if (sent && changedAt) this.setGig({ lastSwitchMs: Date.now() - changedAt });
  }

  private findPrefill: { song?: string; artist?: string } | null = null;

  /** Open Find with these fields filled in (read once by the Find screen). */
  prefillFind(p: { song?: string; artist?: string }) {
    this.findPrefill = p;
  }

  takeFindPrefill() {
    const p = this.findPrefill;
    this.findPrefill = null;
    return p;
  }

  /** Always use this tone for this track (null = back to automatic). */
  linkTrack(key: string, recipeId: string | null) {
    const trackLinks = { ...this.state.settings.trackLinks };
    if (recipeId) trackLinks[key] = recipeId;
    else delete trackLinks[key];
    this.updateSettings({ trackLinks });
    const track = this.state.gig.track;
    if (track?.key === key) void this.applyTrack(track);
  }

  /** Past edits made with the guitar being played now (habits differ per guitar). */
  learned() {
    const id = this.guitar.id;
    return learnedEdits(this.state.library.filter((r) => recipeGuitarId(r) === id));
  }

  // ----- MIDI -----

  async scanPorts() {
    try {
      const access = await getMidiAccess();
      this.set({ ports: listPortPairs(access) });
      access.onstatechange = () => this.set({ ports: listPortPairs(access) });
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
  }

  async connect(target: PortPair | 'virtual') {
    this.disconnect();
    this.set({ conn: { status: 'connecting' } });
    try {
      let connection;
      if (target === 'virtual') {
        this.virtual = new VirtualTonelab(this.state.settings.midiChannel);
        connection = this.virtual;
      } else {
        connection = openWebMidi(await getMidiAccess(), target);
      }
      const client = new TonelabClient(connection, this.state.settings.midiChannel);
      this.client = client;
      this.offs.push(client.on('log', (e: LogEntry) => this.set({ log: [...this.state.log.slice(-199), e] })));
      this.offs.push(client.on('parameterChange', (m: { id: number; sub: number; value: number }) => this.onPedalParam(m.id, m.sub, m.value)));
      this.offs.push(
        client.on('modeChange', (m: { program: number }) => {
          this.set({ slot: m.program, lastFromPedal: `Program ${programLabel(m.program)} selected`, baseline: null, recipe: null });
          void this.readEditBuffer();
        }),
      );
      let version: string | undefined;
      try {
        const reply = await client.inquire();
        version = reply.version;
        if (reply.channel !== this.state.settings.midiChannel) this.updateSettings({ midiChannel: reply.channel });
      } catch (e) {
        // Some setups don't answer the universal inquiry; fall back to the configured channel.
        client.channel = this.state.settings.midiChannel;
        this.toast(`${(e as Error).message} Trying channel ${client.channel + 1}.`, 'info');
      }
      const program = await client.requestCurrentProgram();
      let mode;
      try {
        mode = await client.requestMode();
      } catch {
        mode = undefined;
      }
      let global;
      try {
        global = await client.requestGlobal();
      } catch {
        global = undefined;
      }
      this.set({
        conn: { status: 'connected', name: connection.name, virtual: connection.virtual, version },
        program,
        baseline: null,
        recipe: null,
        slot: mode?.program,
        global,
      });
      if (target !== 'virtual') this.updateSettings({ lastPortName: target.name });
      if (global && global.outputSelect !== this.state.settings.rig.output) {
        this.toast(`The pedal's Output Select is ${global.outputSelect}, but your rig is set to ${this.state.settings.rig.output}. Change it on the pedal (GLOBAL) or in Settings.`, 'error');
      } else if (global && !global.sysexOut) {
        this.toast('SYEX OUT is off on the pedal: turning its knobs will not update this screen. Turn it on under GLOBAL.', 'info');
      } else {
        this.toast(`Connected to ${connection.name}`, 'ok');
      }
    } catch (e) {
      this.set({ conn: { status: 'error', error: (e as Error).message } });
      this.toast((e as Error).message, 'error');
      this.disconnect(true);
    }
  }

  disconnect(keepStatus = false) {
    for (const off of this.offs) off();
    this.offs = [];
    this.client?.close();
    this.client = null;
    this.virtual = null;
    if (!keepStatus) this.set({ conn: { status: 'disconnected' } });
  }

  get connected() {
    return this.state.conn.status === 'connected' && !!this.client;
  }

  async readEditBuffer() {
    if (!this.client) return;
    try {
      this.set({ program: await this.client.requestCurrentProgram() });
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
  }

  private onPedalParam(id: number, sub: number, value: number) {
    const ref = controlFromAddress(this.state.program, id, sub);
    if (!ref) {
      this.set({ lastFromPedal: `Parameter ${id},${sub} = ${value}` });
      return;
    }
    const program = write(this.state.program, ref, value);
    this.set({ program, lastFromPedal: describeRef(ref, value) });
    // An effect type change reshapes that slot's parameters: re-read to stay exact.
    if (ref.kind === 'effectType') void this.readEditBuffer();
  }

  // ----- editing -----

  /** Change one control on screen and, when connected, on the pedal. */
  setControl(ref: ControlRef, raw: number, opts: { final?: boolean } = {}) {
    const program = write(this.state.program, ref, raw);
    if (read(program, ref) === read(this.state.program, ref) && !opts.final) return;
    this.set({ program });
    if (!this.client) return;
    const key = JSON.stringify(ref);
    const now = performance.now();
    if (opts.final || now - (this.lastSend.get(key) ?? 0) > 25) {
      this.lastSend.set(key, now);
      this.client.setControl(program, ref, read(program, ref));
      if (ref.kind === 'effectType') void this.client.sendProgram(program).catch(() => undefined);
    }
  }

  /** Load a recipe: build the program from it and send it to the edit buffer. */
  /** Puts a tone in the edit buffer (nothing is stored). Resolves true once the pedal confirmed it. */
  async loadRecipe(recipe: ToneRecipe): Promise<boolean> {
    const { bytes, warnings } = applyRecipe(recipe.pedal, this.state.program);
    this.set({ program: bytes, baseline: bytes, recipe });
    if (warnings.length) this.toast(`Adjusted: ${warnings.join(' ')}`, 'info');
    if (!this.client) {
      this.toast('Not connected: the tone is on screen only. Connect under MIDI to send it.', 'info');
      return false;
    }
    try {
      await this.client.sendProgram(bytes);
      this.toast(`Loaded "${recipe.pedal.name}" into the pedal (not stored)`, 'ok');
      return true;
    } catch (e) {
      this.toast((e as Error).message, 'error');
      return false;
    }
  }

  backToRecipe() {
    if (this.state.recipe) void this.loadRecipe(this.state.recipe);
  }

  async saveRecipe(recipe: ToneRecipe) {
    await library.put(recipe);
    await this.refreshLibrary();
  }

  /** "Save my version": store the current panel as an edited recipe linked to the loaded one. */
  async saveMyVersion() {
    if (this.client) await this.readEditBuffer();
    const pedal = readRecipe(this.state.program);
    const parent = this.state.recipe;
    const recipe: ToneRecipe = {
      id: newId(),
      createdAt: new Date().toISOString(),
      source: parent ? 'edited' : 'captured',
      parentId: parent?.source === 'ai' ? parent.id : parent?.parentId,
      request: parent?.request ?? { song: pedal.name },
      original: parent?.original,
      pedal,
      guitar: parent?.guitar ?? defaultSetup(this.guitar.kind),
      guitarId: parent ? recipeGuitarId(parent) : this.guitar.id,
      guitarName: parent ? parent.guitarName : this.guitar.name,
      tips: parent?.tips,
      why: parent?.why,
      confidence: parent?.confidence,
      warnings: parent?.warnings,
      sources: parent?.sources,
      model: parent?.model,
    };
    if (parent && !this.state.library.some((r) => r.id === parent.id)) await library.put(parent);
    await this.saveRecipe(recipe);
    this.set({ recipe, baseline: this.state.program });
    this.toast('Saved your version to the library', 'ok');
  }

  async storeToSlot(slot: number) {
    if (!this.client) return this.toast('Connect to the pedal first.', 'error');
    try {
      await this.client.sendProgram(this.state.program);
      await this.client.writeProgram(slot);
      this.set({ slot });
      this.toast(`Stored in program ${programLabel(slot)}`, 'ok');
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
  }

  async backupAll(download: (name: string, text: string) => void) {
    if (!this.client) return this.toast('Connect to the pedal first.', 'error');
    try {
      this.toast('Reading every program… do not touch the pedal.', 'info');
      const b = await this.client.backupAll();
      await backups.put(b);
      download(`tonelab-se-backup-${b.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.json`, JSON.stringify(b, null, 1));
      this.toast('Backup saved (in the app and as a download)', 'ok');
    } catch (e) {
      this.toast((e as Error).message, 'error');
    }
  }
}

function describeRef(ref: ControlRef, value: number): string {
  switch (ref.kind) {
    case 'ampParam':
      return `${ref.key} ${ref.ch} → ${(value / (ref.key === 'nrSens' ? 5 : 10)).toFixed(1)}`;
    case 'effectParam':
      return `${ref.slot} ${ref.key} → ${value}`;
    case 'status':
      return `${ref.key} ${value ? 'on' : 'off'}`;
    default:
      return `${ref.kind} → ${value}`;
  }
}

export const store = new Store();

export function useStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
