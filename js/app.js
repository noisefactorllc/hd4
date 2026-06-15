// SPDX-License-Identifier: MIT
/**
 * HD4 — application boot.
 *
 * Owns the central `state`, instantiates the subsystems (channels,
 * switcher, program compositor, transition mixer, audio mixer, memory),
 * and wires their callbacks together. Kept deliberately small: each
 * subsystem lives in its own module and is unit-testable on its own.
 *
 * Phase 1: establish the boot path + the `window.__hd4` test hook. The
 * subsystems land in subsequent phases.
 */

const VERSION = '0.1.0'

const state = {
    version: VERSION,
    ready: false,
}

function boot() {
    const app = document.getElementById('app')
    if (app) app.dataset.booted = 'true'

    state.ready = true

    // Test/automation hook — Playwright drives the app through this
    // surface instead of scraping the DOM (mirrors visualize's
    // window.__visualize).
    window.__hd4 = {
        version: VERSION,
        state,
        get ready() { return state.ready },
    }

    document.dispatchEvent(new CustomEvent('hd4:ready', { detail: { version: VERSION } }))
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
    boot()
}

export { state, VERSION }
