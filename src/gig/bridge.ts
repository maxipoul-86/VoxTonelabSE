// Connection to tools/winamp-bridge.ps1, which reports what Winamp is playing.
// Push first (Server-Sent Events, about 50 ms after a track change); if that can't open,
// ask every 700 ms instead while the push connection keeps retrying in the background.

export const BRIDGE_URL = 'http://127.0.0.1:8737';
const OPEN_TIMEOUT_MS = 3000;
const POLL_MS = 700;

export interface NowPlaying {
  winamp: 'running' | 'not-running';
  state: 'playing' | 'paused' | 'stopped';
  index: number;
  title: string;
  file: string;
  /** Epoch ms when the bridge saw this change. */
  changedAt: number;
}

export type BridgeStatus = 'connecting' | 'live' | 'polling' | 'unreachable';

export interface BridgeHandle {
  close(): void;
}

export function connectBridge(onSnapshot: (s: NowPlaying) => void, onStatus: (s: BridgeStatus) => void, url = BRIDGE_URL): BridgeHandle {
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  onStatus('connecting');

  const parse = (text: string) => {
    try {
      onSnapshot(JSON.parse(text) as NowPlaying);
    } catch {
      // A malformed message is skipped; the next one replaces it.
    }
  };

  const poll = async () => {
    try {
      const res = await fetch(`${url}/now-playing`, { cache: 'no-store', signal: AbortSignal.timeout(POLL_MS - 100) });
      if (closed || !pollTimer) return;
      parse(await res.text());
      onStatus('polling');
    } catch {
      if (!closed && pollTimer) onStatus('unreachable');
    }
  };
  const startPolling = () => {
    if (pollTimer || closed) return;
    pollTimer = setInterval(() => void poll(), POLL_MS);
    void poll();
  };
  const stopPolling = () => {
    clearInterval(pollTimer);
    pollTimer = undefined;
  };

  const es = new EventSource(`${url}/events`);
  es.onopen = () => {
    stopPolling();
    onStatus('live');
  };
  es.onmessage = (e) => parse(e.data);
  // EventSource reconnects by itself; meanwhile keep the app informed by polling.
  es.onerror = () => startPolling();
  const openTimer = setTimeout(() => {
    if (es.readyState !== EventSource.OPEN) startPolling();
  }, OPEN_TIMEOUT_MS);

  return {
    close() {
      closed = true;
      clearTimeout(openTimer);
      stopPolling();
      es.close();
    },
  };
}
