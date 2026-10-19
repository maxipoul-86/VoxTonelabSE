# First hardware test

Everything has been tested against the virtual Tonelab, which follows the VOX spec. These steps check the real pedal and settle the few points the spec leaves open. Do them in order on the laptop (`npm run dev`, Chrome).

## 0. Pedal setup (GLOBAL button)

- [ ] MIDI CH: note it (default 1)
- [ ] SYEX OUT: **On** (needed for the live on-screen mirror)
- [ ] CCHG I/O: On, PCHG OUT: On
- [ ] Output: Line (your mixer/PA setup)
- [ ] UM-ONE mk2: plug marked **IN** → pedal MIDI **OUT**, plug marked **OUT** → pedal MIDI **IN**

## 1. Connect and back up

- [ ] MIDI screen → pick the UM-ONE → Connect. Expect "Connected" and the pedal's firmware version.
- [ ] If it times out: check the channel, swap the two MIDI plugs, retry.
- [ ] **Full backup** → keep the downloaded `tonelab-se-backup-*.json` somewhere safe.

## 2. Round trip

- [ ] **Round-trip test**: expect "Round trip OK".
- [ ] If it reports differing bytes, save the log (Save log) and note which bytes.

## 3. Settle the open points (marked VERIFY in `src/tonelab/spec.ts`)

| # | Question | How to check | Where to fix |
| --- | --- | --- | --- |
| 1 | Byte order of 2-byte fields (delay time, expression ranges) | On the pedal set a delay to **ANALOG DELAY, 1000 ms**, then Read edit buffer. Under "Current program bytes" (rows start with their decimal offset) look at bytes 32–33: `03 E8` = MSB first (current setting), `E8 03` = LSB first. | `TWO_BYTE_ORDER` in `spec.ts` |
| 2 | Chain order labels | Set each chain order on the pedal and watch the log: byte 12 / parameter `02,10` values 0–5 vs the order shown on the pedal. | `CHAIN_ORDERS` in `spec.ts` |
| 3 | Chain parameter sub ID | When you change the chain on the pedal, the log shows `Parameter change 02,xx`. `xx` should be `10`. | `CHAIN_SUB` in `spec.ts` |
| 4 | TEXTREM expression code | Select TEXTREM, assign EXP 2 to its speed on the pedal, read the edit buffer: byte 82 should be `10` (hex). | TEXTREM `exp` in `spec.ts` |
| 5 | A loaded tone sounds right away | Load any tone from the Library and play. If the sound only changes after touching a knob, tell me: the app will add a mode change after loading. | `store.loadRecipe` |

## 4. Live mirror

- [ ] Turn GAIN on the pedal: the on-screen Gain knob follows, and "Last from pedal" updates.
- [ ] Drag a knob on screen: the pedal follows.
- [ ] Switch programs with your foot: the screen redraws.

## 5. Tablet

- [ ] Deploy (README › Use it on the tablet), open in Chrome on the Tab S9 FE, repeat steps 1–4 through the OTG adapter.

Send me the MIDI log (Save log) if anything fails; it has every byte in both directions.
