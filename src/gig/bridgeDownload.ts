// The Winamp and Spotify bridges as one zip, built from tools/ so it always matches this version of the app.

import winampCmd from '../../tools/Winamp bridge.cmd?raw';
import spotifyCmd from '../../tools/Spotify bridge.cmd?raw';
import winampPs1 from '../../tools/winamp-bridge.ps1?raw';
import mediaPs1 from '../../tools/media-bridge.ps1?raw';
import serverPs1 from '../../tools/bridge-server.ps1?raw';
import { makeZip } from './zip';

const FOLDER = 'Tonelab bridge';

const README = `Tonelab SE Tone Assistant - player bridge (Windows)

1. Keep this folder anywhere on the laptop (e.g. Documents\\Tonelab bridge).
2. Double-click "Spotify bridge.cmd" (Spotify desktop app) or "Winamp bridge.cmd" (classic Winamp 5.x).
   Keep its window open during the gig. Run one bridge at a time.
3. In the app, open Gig and turn on "Follow Winamp or Spotify".

If Windows says "Windows protected your PC": More info > Run anyway.
To avoid it: before unzipping, right-click the zip > Properties > tick "Unblock" > OK.
The bridge only reads what the player is playing and answers the app on this computer (127.0.0.1); it installs nothing.
`;

/** Windows batch and PowerShell files want CRLF; the GitHub build checks them out with LF. */
const crlf = (s: string) => s.replace(/\r?\n/g, '\r\n');

export function bridgeZip(): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const files: [string, string][] = [
    ['Winamp bridge.cmd', winampCmd],
    ['Spotify bridge.cmd', spotifyCmd],
    ['winamp-bridge.ps1', winampPs1],
    ['media-bridge.ps1', mediaPs1],
    ['bridge-server.ps1', serverPs1],
    ['README.txt', README],
  ];
  return makeZip(files.map(([name, text]) => ({ name: `${FOLDER}/${name}`, data: enc.encode(crlf(text)) })));
}

export function downloadBridge() {
  const url = URL.createObjectURL(new Blob([bridgeZip()], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tonelab-bridge.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
