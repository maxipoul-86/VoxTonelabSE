import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectBridge, type NowPlaying } from './bridge';

/** Minimal stand-in for the browser's EventSource. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static last: FakeEventSource;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  send(s: Partial<NowPlaying>) {
    this.onmessage?.({ data: JSON.stringify(s) });
  }
  close() {
    this.closed = true;
  }
}

const snap = (title: string): NowPlaying => ({ winamp: 'running', state: 'playing', index: 0, title, file: '', changedAt: 1 });

describe('connectBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the push stream when it opens', () => {
    const snapshots: NowPlaying[] = [];
    const statuses: string[] = [];
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const h = connectBridge((s) => snapshots.push(s), (s) => statuses.push(s));
    expect(FakeEventSource.last.url).toBe('http://127.0.0.1:8737/events');
    FakeEventSource.last.open();
    FakeEventSource.last.send(snap('Alan Jackson - Mercury Blues'));
    vi.advanceTimersByTime(5000);
    expect(statuses).toEqual(['connecting', 'live']);
    expect(snapshots.map((s) => s.title)).toEqual(['Alan Jackson - Mercury Blues']);
    expect(fetchMock).not.toHaveBeenCalled();
    h.close();
    expect(FakeEventSource.last.closed).toBe(true);
  });

  it('falls back to polling when the stream does not open, and stops once it does', async () => {
    const snapshots: NowPlaying[] = [];
    const statuses: string[] = [];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(snap('Lodi'))));
    vi.stubGlobal('fetch', fetchMock);
    const h = connectBridge((s) => snapshots.push(s), (s) => statuses.push(s));
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8737/now-playing', expect.anything());
    await vi.advanceTimersByTimeAsync(1400);
    expect(statuses).toContain('polling');
    expect(snapshots.at(-1)?.title).toBe('Lodi');
    const calls = fetchMock.mock.calls.length;
    FakeEventSource.last.open();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(statuses.at(-1)).toBe('live');
    h.close();
  });

  it('reports an unreachable bridge', async () => {
    const statuses: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const h = connectBridge(() => {}, (s) => statuses.push(s));
    FakeEventSource.last.onerror?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(statuses.at(-1)).toBe('unreachable');
    h.close();
  });
});
