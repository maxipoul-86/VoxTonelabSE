# Tonelab SE Tone Assistant

Turns a song or band into VOX Tonelab SE settings, shows the pedal as a live on-screen panel, and sends everything over MIDI (Roland UM-ONE mk2). Runs in Chrome or Edge on the laptop and in Chrome on Android (Galaxy Tab S9 FE, Galaxy S23 Ultra).

## Run it on the laptop

Requires Node.js 22.12 or later (the current LTS from nodejs.org is fine). Vite 8 and Vitest 5 do not run on Node 20.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (protocol, MIDI client, tone engine)
npm run build      # production build in dist/
```

Web MIDI works on `localhost`, so the dev server is enough on the laptop. Chrome asks for MIDI permission (including SysEx) the first time you connect.

## Use it on the tablet or phone

Android Chrome only allows Web MIDI on HTTPS, so the app is published with GitHub Pages at <https://maxipoul-86.github.io/VoxTonelabSE/>:

1. Once, in the repository: Settings › Pages › Source: **GitHub Actions**.
2. Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which tests, builds and publishes the app.
3. Open the Pages URL in Chrome on the tablet, then "Add to Home screen" to install it.

Cable: UM-ONE mk2 → USB-C (male) to USB-A (female) OTG adapter → tablet.

## Gigs with Winamp or Spotify

The app can load each song's tone by itself as the player starts the track. The player, the app (in Chrome) and the UM-ONE must be on the same Windows laptop. It works with classic Winamp 5.x and the Spotify desktop app (Free or Premium, nothing to sign in to).

1. Get the bridge: **Download the bridge (.zip)** on the Gig screen (or use `tools/` in this repository) and unzip it anywhere. Double-click `Winamp bridge.cmd` or `Spotify bridge.cmd` and keep its window open. It only reads what the player is playing and tells the app; nothing to install. Run one bridge at a time.
2. Start the player and connect the pedal under MIDI.
3. Open **Gig** and turn on **Follow Winamp or Spotify**. It stays on next time you open the app.

When a track starts, the app finds the song in the Library bank of the guitar you're playing and loads its first tone into the pedal's edit buffer (nothing is stored), usually about 0.1 s after the track starts. For Winamp, name your files or tags `Artist - Title` so the songs match; Spotify gives the artist and title itself, and version notes like "- Remastered 2003" are ignored.

The Spotify bridge reads the "now playing" information Windows shows in its media pop-up, so it can follow other players too: `media-bridge.ps1 -App Chrome` follows YouTube in Chrome, for example. If a track gets the wrong tone or none, pick one under **Tone for this track**: the app remembers it.

## Screens

| Screen | What it does |
| --- | --- |
| Pedal | Live two-way copy of the pedal: amp channels A/B, cabinets, effects, footswitches, expression pedals, guitar setup card. Knobs moved away from the loaded recipe turn blue. **Swap A ⇄ B** swaps the channels; **Fine tune…** has the fast model (Haiku) adjust the loaded tone from a typed or spoken request. |
| Find | Song / artist / part → tone from the AI (Anthropic or OpenRouter), web search only when needed (or always / never), "Adjust it" for quick follow-ups. The mic buttons let you talk instead of typing, in Québec French or English (Chrome, needs internet). |
| Library | Saved tones (AI suggestions and your own versions), one bank per guitar. Export/import as JSON to move between devices, **Add starter tones** loads the tones bundled in `tones/`, **Delete all…** empties it. |
| Gig | Follows Winamp or Spotify and loads each track's tone as it starts. |
| MIDI | Connect, device inquiry, round-trip test, full backup, traffic log, and a **virtual Tonelab** for testing without hardware. |
| Settings | AI provider, key and models; guitar and rig profile. |

## Safety

- Tones load into the pedal's **edit buffer** only (func `40`). The app never writes to the pedal's program slots; to keep a sound on the pedal, use its own WRITE button.
- Take a **Full backup** under MIDI before storing anything. Backups are kept in the app and downloaded as a file.
- The API key is kept in this browser's local storage on this device only.

## Code map

| Folder | Contents |
| --- | --- |
| `src/tonelab/` | The Tonelab SE protocol from the VOX MIDI Implementation v1.0: parameter map (`spec.ts`), value scales, 7-bit packing, SysEx builders/parser, program read/write, recipes. |
| `src/midi/` | Web MIDI connection, high-level client with timeouts, virtual pedal. |
| `src/ai/` | Prompt, JSON schema, Anthropic/OpenRouter adapters, tone engine, learning from your edits. |
| `src/store/` | IndexedDB library and settings. |
| `src/gig/` | Player bridge connection and track-to-tone matching. |
| `tools/` | The Winamp and Spotify bridges (PowerShell), sharing `bridge-server.ps1`. |
| `src/ui/` | React screens. |

Before trusting it on the real pedal, run the checklist in [docs/HARDWARE-TEST.md](docs/HARDWARE-TEST.md).
