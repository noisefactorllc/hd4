# HD4

**A four-channel software video mixer for the open web.**

HD4 is a broadcast-style video switcher with an integrated audio mixer, built
entirely client-side in vanilla JavaScript on the Noise Factor platform — the
[Noisemaker](https://noisemaker.app) shader engine for video, WebAudio for sound,
and the handfish design language for the interface.

Its true north is the classic one-box AV mixer: pick a live channel,
transition with **CUT / MIX / WIPE**, composite (**PinP / SPLIT / QUAD / KEY**),
apply output effects, and ride a full channel-strip audio mixer — all in the
browser. Any of the four channels can be a live camera, a video file, an image,
or a Noisemaker shader.

It is a sibling of [`visualize`](../visualize) (our two-channel mixer), scaled to
four channels and reframed from a VJ crossfader to a utilitarian program-bus
switcher.

## Status

Early development. See [`docs/superpowers/specs/2026-06-14-hd4-design.md`](docs/superpowers/specs/2026-06-14-hd4-design.md)
for the full design and roadmap.

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
