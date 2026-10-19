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

## Gigs with Winamp

The app can load each song's tone by itself as Winamp starts the track. Winamp, the app (in Chrome) and the UM-ONE must be on the same Windows laptop. It works with classic Winamp 5.x.

1. Double-click `tools/Winamp bridge.cmd` and keep its window open. It only reads what Winamp is playing and tells the app; nothing to install.
2. Start Winamp and connect the pedal under MIDI.
3. Open **Gig** and turn on **Follow Winamp**. It stays on next time you open the app.

When a track starts, the app finds the song in the Library bank of the guitar you're playing and loads its first tone into the pedal's edit buffer (nothing is stored), usually about 0.1 s after the track starts. Name your files or tags `Artist - Title` so the songs match. If a track gets the wrong tone or none, pick one under **Tone for this track**: the app remembers it.

## Screens

| Screen | What it does |
| --- | --- |
| Pedal | Live two-way copy of the pedal: amp channels A/B, cabinets, effects, footswitches, expression pedals, guitar setup card. Knobs moved away from the loaded recipe turn blue. |
| Find | Song / artist / part → tone from the AI (Anthropic or OpenRouter), optional web search, "Adjust it" for quick follow-ups. |
| Library | Saved tones (AI suggestions and your own versions), one bank per guitar. Export/import as JSON to move between devices. |
| Gig | Follows Winamp and loads each track's tone as it starts. |
| MIDI | Connect, device inquiry, round-trip test, full backup, traffic log, and a **virtual Tonelab** for testing without hardware. |
| Settings | AI provider, key and models; guitar and rig profile. |

## Safety

- Tones load into the pedal's **edit buffer** only (func `40`). Nothing is stored until you press **Store to slot…** and confirm.
- Take a **Full backup** under MIDI before storing anything. Backups are kept in the app and downloaded as a file.
- The API key is kept in this browser's local storage on this device only.

## Code map

| Folder | Contents |
| --- | --- |
| `src/tonelab/` | The Tonelab SE protocol from the VOX MIDI Implementation v1.0: parameter map (`spec.ts`), value scales, 7-bit packing, SysEx builders/parser, program read/write, recipes. |
| `src/midi/` | Web MIDI connection, high-level client with timeouts, virtual pedal. |
| `src/ai/` | Prompt, JSON schema, Anthropic/OpenRouter adapters, tone engine, learning from your edits. |
| `src/store/` | IndexedDB library and settings. |
| `src/gig/` | Winamp bridge connection and track-to-tone matching. |
| `tools/` | The Winamp bridge (PowerShell). |
| `src/ui/` | React screens. |

Before trusting it on the real pedal, run the checklist in [docs/HARDWARE-TEST.md](docs/HARDWARE-TEST.md).
