# HD4

**A four-channel software video mixer for the open web.**

HD4 is a broadcast-style video switcher with an integrated audio mixer.
It runs entirely client-side in vanilla JavaScript on the Noise Factor platform.
It uses the [Noisemaker](https://noisemaker.app) shader engine for video, WebAudio
for sound, and the handfish design language for the interface.

Its true north is the classic one-box AV mixer: pick a live channel,
transition with **CUT / MIX / WIPE**, composite (**PinP / SPLIT / QUAD / KEY**),
apply output effects, and ride a full channel-strip audio mixer — all in the
browser. Any of the four channels can be a live camera, a video file, an image,
or a Noisemaker shader.

It is a sibling of [`visualize`](../visualize) (our two-channel mixer), scaled to
four channels and reframed from a VJ crossfader to a utilitarian program-bus
switcher.

## Status

The full feature set is built and tested (215 unit tests + a
Playwright integration suite).

**Switching & program**
- **4 channels**: each accepts a camera, video file, image, or pattern/fill from the source library.
  For cameras, select the **device**. Use **per-channel fit** to select scale or zoom/crop.
- **Multiview** of all four sources, a **program monitor**, and a **preview (PVW)**
  monitor with **TAKE / AUTO**.
- **VIDEO INPUT SELECT [1–4]** takes through **CUT / MIX / WIPE** + transition **TIME**,
  **fade curves** (linear / dipped / sharp / cut), and MIX **blend modes** (add / screen / multiply).

**Compositing & output**
- **PinP** (size / shape / border / position / aspect / crop), **SPLIT** (V/H centre &
  stretch), **QUAD**, and **KEY** (chroma blue/green + luma black/white).
- **FREEZE**, **OUTPUT FADE**, **STILL** capture (a freeze-frame usable as a KEY source
  or a channel image), and output **VFX** (negative / mono / sepia / posterize / emboss / find-edges).
- **Recording** the program (video + audio) to a file via MediaRecorder.

**Audio**
- Full per-channel strip: **HPF, 3-band EQ, gate, compressor, pan, delay**, plus **AUX / REV sends**.
- Main bus: **3-band EQ, limiter, reverb** (time / type), **multiband compressor**, and an **AUX bus**.
- Per-channel **fader / mute / solo / meter**. Select each channel's audio source independently:
  **follow the video, none, or a specific input device**.
- **Auto-audio**: audio-follows-video, **AUTO MIXING** (level/weight gain sharing), and **VIDEO FOLLOWS AUDIO**.

**Control & state**
- **Auto-switching + beat matching**: tap tempo / BPM, audio tempo detection (SYNC),
  beat-synced switching (scan / random / follows-audio).
- **USER [1–5]** assignable macro buttons and **MIDI** control (learn + map), both persisted.
- **8 memory slots** (save / recall the full state, persisted to `localStorage`).
- **Settings** drawer: output resolution, theme, output-fade time, beat sensitivity.
- handfish design language, broadcast-industrial layout, and keyboard shortcuts.

The full design rationale and the per-area implementation notes are in
[`docs/superpowers/specs/2026-06-14-hd4-design.md`](docs/superpowers/specs/2026-06-14-hd4-design.md).

## Keyboard

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| `1`–`4` | Take that channel | `q` | QUAD |
| `c` | CUT transition | `p` | PinP |
| `d` | MIX (dissolve) | `k` | KEY overlay |
| `w` | WIPE | `f` | FREEZE |
| `a` | AUTO (beat-synced) | `b` | FADE to black |
| `s` | Settings | `r` | REC (record) |

## Develop

```sh
npm install            # installs dev tooling (http-server, Playwright)
npm run dev            # serves the app at http://127.0.0.1:3014
npm test               # fast unit tests (Node test runner, no browser)
npm run test:e2e       # Playwright integration tests (needs: npx playwright install)
npm run lint           # syntax-check all JS
```

## Tech

- **Vanilla JS, ES modules, no build step** — CDN imports, like the rest of the line.
- **Video:** Noisemaker (`shaders.noisedeck.app`).
- **Audio:** WebAudio.
- **UI:** handfish design language (`handfish.noisefactor.io`).

## License

MIT © Noise Factor LLC
