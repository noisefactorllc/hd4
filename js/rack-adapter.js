// SPDX-License-Identifier: MIT
/**
 * rack-adapter.js — HD4 as a Noisedeck Audio rack module (the first VIDEO module).
 *
 *   export default function createModule(host) -> instance
 *
 * This is the ADDITIVE rack entry point. The standalone app (index.html -> js/app.js)
 * is completely unchanged: it still auto-boots into the page's #app with its own lazy
 * AudioContext and its main bus routed to the speakers. This adapter is a SECOND
 * consumer of the very same boot, built purely against the rack-core `host` contract
 * (docs/design/module-sdk.md §1-§4, §8):
 *
 *   - UI + engine: it builds HD4's exact DOM scaffold inside host.container, then calls
 *     the SAME bootInto() the standalone uses, passing { container, audioContext,
 *     destination }. So HD4's full mixer (4 channels, switcher, 2D program compositor,
 *     output stage, WebAudio mixer, memory, MIDI, keyboard) runs identically — just
 *     fed the rack's shared context and per-module destination instead of the speakers.
 *     With no options bootInto() is byte-for-byte the previous app; that single optional
 *     argument set is the whole standalone-preservation story.
 *
 * Jacks (rendered on the faceplate as <rk-jack> and resolved for the router, §4/§7/§8):
 *   hd4.vout  video out -> { kind:'video', frameSource:{ getFrame: () => <program canvas> } }
 *                          the on-air PGM canvas the recorder also captures; the rack's
 *                          video router pulls frames from it (router.js reads src.frameSource).
 *   hd4.out   audio out -> { kind:'audio', node: host.audio.destination }
 *                          HD4's main/monitor bus feeds this node; the rack reads the mix OUT of it.
 *   hd4.vin1..4 video in -> { kind:'video' }   (DECLARED; accept-into-channel is a no-op stub —
 *                          see VIDEO-IN note below). The router records any patched source for
 *                          these jacks; HD4 does not yet draw an external frame into a channel.
 *
 * Transport sync (§5): the adapter subscribes to host.transport for tempo + play-state and
 * polls host.transport.positionBeats() once per frame, calling the boot surface's
 * syncToExternalBeat() on each integer-beat crossing. HD4's AUTO then follows the rack's
 * beats/bars instead of its free-running BeatClock. Standalone keeps its internal clock
 * (external-beat mode is rack-only) — purely additive.
 *
 * VIDEO-IN (best-effort, declared stub): cleanly feeding an externally-supplied frameSource
 * into one of HD4's channels would require a new channel source kind threaded through
 * sourceModel/driverFactory/channelRenderer — too invasive for a safe additive pass, and the
 * RackHost does not currently hand a module a frame-pull path for its input jacks. So the four
 * video inputs are DECLARED with the correct endpoint shape ({kind:'video'}) and reserved, but
 * "accept an external frame into a channel" is an explicit no-op. Standalone is never at risk.
 *
 * rack-core is reached only through the injected `host`; nothing here imports rack internals.
 * No alert/confirm/prompt; handfish/Atkinson typography only (inherited from HD4's own UI).
 *
 * NOTE: bootInto() is imported DYNAMICALLY inside mount(), not at module top. app.js pulls in
 * the browser-only `handfish` ESM (resolved via the page importmap), so a static import would
 * make this whole module unimportable off-browser. Deferring it keeps the jack contract
 * (getJacks / resolveJack) testable with a plain fake host under node, and the large app.js is
 * only loaded when the module actually mounts.
 */
const JACK_DEFS = [
    { id: 'hd4.vout', dir: 'out', kind: 'video', label: 'PGM' },
    { id: 'hd4.out', dir: 'out', kind: 'audio', label: 'AUD' },
    { id: 'hd4.vin1', dir: 'in', kind: 'video', label: 'IN1' },
    { id: 'hd4.vin2', dir: 'in', kind: 'video', label: 'IN2' },
    { id: 'hd4.vin3', dir: 'in', kind: 'video', label: 'IN3' },
    { id: 'hd4.vin4', dir: 'in', kind: 'video', label: 'IN4' },
]

const VIDEO_IN_IDS = new Set(['hd4.vin1', 'hd4.vin2', 'hd4.vin3', 'hd4.vin4'])

/**
 * Inject HD4's stylesheets into the document head (idempotent). The rack host
 * does not load module CSS, so a module styles itself (the same contract
 * drone-synth follows). We pull HD4's full standalone stylesheet for the
 * component chrome, then css/rack.css AFTER it for the 4U fit + body restore.
 *
 * URLs are resolved relative to this module's own URL (import.meta.url), so they
 * work wherever the module is served from (dev root-relative or the prod CDN) —
 * no hard-coded app path. A no-op if document is unavailable or already injected.
 */
function injectStyles() {
    if (typeof document === 'undefined') return
    const base = new URL('../css/', import.meta.url) // js/ -> ../css/
    const add = (id, file) => {
        if (document.getElementById(id)) return
        const link = document.createElement('link')
        link.id = id
        link.rel = 'stylesheet'
        link.href = new URL(file, base).href
        document.head?.appendChild(link)
    }
    add('hd4-styles', 'hd4.css')
    add('hd4-rack-styles', 'rack.css') // appended after hd4.css so its rules win
}

/**
 * Build HD4's structural DOM scaffold (the same tree index.html declares for the
 * standalone #app) inside the rack slot. bootInto() then scopes all its #hd4-*
 * lookups to this root, so the full app assembles into the slot with no app.js change.
 * Returns the scaffold root (which carries id="app" so the boot's data-booted flag and
 * any #app-scoped wiring behave exactly as standalone).
 */
function buildScaffold(container) {
    const root = document.createElement('div')
    root.id = 'app'
    root.className = 'hd4-rack-root'

    const make = (tag, id, cls) => {
        const el = document.createElement(tag)
        el.id = id
        el.className = cls
        return el
    }

    const topbar = make('header', 'hd4-topbar', 'hd4-topbar')
    const stage = make('main', 'hd4-stage', 'hd4-stage')
    const program = make('section', 'hd4-program', 'hd4-program')
    const sources = make('section', 'hd4-sources', 'hd4-sources')
    stage.append(program, sources)
    const compositor = make('section', 'hd4-compositor', 'hd4-compositor')
    const transition = make('section', 'hd4-transition', 'hd4-transition')
    const mixer = make('section', 'hd4-mixer', 'hd4-mixer')

    root.append(topbar, stage, compositor, transition, mixer)
    container.appendChild(root)
    return root
}

export default function createModule(host) {
    let app = null // the bootInto() surface (program canvas, audio, transport-sync hooks)
    let scaffoldRoot = null
    let jacksBar = null
    let unsubscribeTransport = null
    let beatPollId = null
    let lastBeat = -1
    let mounted = false

    // Sample the shared transport once per frame; fire one auto-switch step on each
    // integer-beat crossing while the rack is playing (the §5 "advance on shared beats").
    function pollBeats() {
        if (!mounted) return
        const tr = host.transport
        if (tr && tr.playing && typeof tr.positionBeats === 'function') {
            const beat = Math.floor(tr.positionBeats())
            if (beat !== lastBeat) {
                lastBeat = beat
                app?.syncToExternalBeat({ bpm: tr.bpm })
            }
        } else {
            lastBeat = -1
        }
        beatPollId = requestAnimationFrame(pollBeats)
    }

    const instance = {
        async mount() {
            if (mounted) return

            // The rack host doesn't load module CSS, so HD4 styles itself.
            injectStyles()

            // Mark the slot so the rack-only 4U fit CSS applies (scoped to .hd4-rack;
            // standalone never carries this class, so its layout is untouched).
            host.container.classList?.add('hd4-rack')

            // Import app.js FIRST. Its module-load auto-boot does `if (getElementById('app')) boot()`;
            // since buildScaffold's root carries id="app", building it first would let auto-boot fire a
            // SECOND time into module-level `state`, doubling state.channels and crashing faderOf in the
            // rack. Importing before buildScaffold means no #app exists yet, so auto-boot skips and this
            // adapter is the sole booter. (Dynamic import also keeps browser-only handfish out of the
            // node-testable static graph.)
            const { bootInto } = await import('./app.js')

            scaffoldRoot = buildScaffold(host.container)

            // Boot the full HD4 into the slot, fed the shared context + per-module
            // destination. This is the identical assembly the standalone runs.
            app = await bootInto({
                container: scaffoldRoot,
                audioContext: host.audio.context,
                destination: host.audio.destination,
            })

            // Slave HD4's auto-switch to the rack clock.
            app.setExternalBeatMode(true)
            if (typeof host.transport?.bpm === 'number') app.setSyncBpm(host.transport.bpm)

            // Tempo + play-state follow (snapshots on transport changes).
            unsubscribeTransport = host.transport?.subscribe?.(({ bpm, playing }) => {
                if (typeof bpm === 'number') app.setSyncBpm(bpm)
                if (!playing) lastBeat = -1 // re-anchor the beat counter on the next play
            }) || null

            // Per-frame beat sampling (the transport only pushes on state changes).
            beatPollId = requestAnimationFrame(pollBeats)

            host.registerJacks(JACK_DEFS, (id) => instance.resolveJack(id))
            renderFaceplateJacks()

            mounted = true
            host.log?.('hd4 mounted')
        },

        async unmount() {
            if (!mounted) return
            mounted = false
            if (beatPollId != null) { cancelAnimationFrame(beatPollId); beatPollId = null }
            if (unsubscribeTransport) { try { unsubscribeTransport() } catch { /* ignore */ } unsubscribeTransport = null }
            try { app?.stop() } catch { /* ignore */ } // halts RAF + detaches audio bus from the rack
            app = null
            if (jacksBar?.parentNode) jacksBar.parentNode.removeChild(jacksBar)
            jacksBar = null
            if (scaffoldRoot?.parentNode) scaffoldRoot.parentNode.removeChild(scaffoldRoot)
            scaffoldRoot = null
            host.container.classList?.remove('hd4-rack')
            host.log?.('hd4 unmounted')
        },

        getJacks() {
            return JACK_DEFS.map((d) => ({ ...d }))
        },

        /**
         * resolveJack — router endpoint per jack (module-sdk §4, §8; rack-core router.js).
         *   hd4.vout -> { kind:'video', frameSource:{ getFrame() } }  (the program canvas)
         *   hd4.out  -> { kind:'audio', node: host.audio.destination } (HD4's master node)
         *   hd4.vinN -> { kind:'video' }  (declared input; accept-into-channel is a no-op stub)
         */
        resolveJack(id) {
            if (id === 'hd4.vout') {
                // A live frameSource: getFrame() returns the current on-air PGM canvas
                // (a CanvasImageSource), which the rack's video router pulls each frame.
                return { kind: 'video', frameSource: { getFrame: () => app?.programCanvas || null } }
            }
            if (id === 'hd4.out') return { kind: 'audio', node: host.audio.destination }
            if (VIDEO_IN_IDS.has(id)) return { kind: 'video' } // reserved; no-op consumer (see note)
            return undefined
        },

        /** Optional host transport push — same effect as the subscribe handler. */
        onTransport(state) {
            if (!state) return
            if (typeof state.bpm === 'number') app?.setSyncBpm(state.bpm)
            if (state.playing === false) lastBeat = -1
        },
    }

    // Render the patch points on the faceplate (the rack-wide patchbay finds them by the
    // `jack` attribute and draws cables; we never draw cables ourselves — §7).
    function renderFaceplateJacks() {
        if (!scaffoldRoot || typeof document === 'undefined') return
        const bar = document.createElement('div')
        bar.className = 'hd4-rack-jacks'
        for (const d of JACK_DEFS) {
            const jack = document.createElement('rk-jack')
            jack.setAttribute('jack', d.id)
            jack.setAttribute('kind', d.kind)
            jack.setAttribute('dir', d.dir)
            jack.setAttribute('label', d.label)
            bar.append(jack)
        }
        scaffoldRoot.append(bar)
        jacksBar = bar
    }

    return instance
}
