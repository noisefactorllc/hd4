// SPDX-License-Identifier: MIT
/**
 * Noisedeck Sync output dialog markup — the modal that pairs HD4 with the
 * local Sync companion and starts / stops publishing the program. The
 * element ids are the contract js/syncOutputDialog.js binds to (shared with
 * visualize); this module only builds the DOM and registers the open modal
 * on the handfish escape stack, so Escape closes it before any panel
 * beneath it, like the rest of HD4's overlays.
 */
import { registerEscapeable, unregisterEscapeable } from 'handfish'

// Static markup only: never interpolate user input into this template.
const MARKUP = `
<dialog id="sync-output-dialog" class="sync-output-dialog" aria-labelledby="sync-output-title" aria-describedby="sync-output-description sync-output-preview">
    <div class="sync-output-titlebar">
        <div class="sync-output-heading">
            <span id="sync-output-title">Noisedeck Sync</span>
            <span id="sync-output-live" class="sync-output-live" hidden>LIVE</span>
        </div>
        <button type="button" id="sync-output-close" class="hf-icon-btn tooltip" aria-label="Close Sync output" data-title="Close Sync output (Esc)"><span class="hf-icon">close</span></button>
    </div>
    <div class="sync-output-body">
        <p id="sync-output-description">Publish HD4’s program output through the local Sync companion.</p>
        <p id="sync-output-preview" class="sync-output-preview">Preview — Sync is not ready for general use. <a href="https://sync.noisedeck.app/" target="_blank" rel="noopener">learn about Sync</a></p>
        <label class="sync-output-field" for="sync-output-name">
            <span>output name</span>
            <input type="text" id="sync-output-name" class="tooltip" data-title="Sync output name" value="HD4" placeholder="HD4" autocomplete="off" spellcheck="false" maxlength="64">
        </label>
        <div class="sync-output-meta">
            <div><span>state</span><strong id="sync-output-state">Disconnected</strong></div>
            <div><span>provider</span><strong id="sync-output-provider">No provider</strong></div>
            <div><span>format</span><strong id="sync-output-format">—×— · 60 fps</strong></div>
        </div>
        <div class="sync-output-counters" aria-label="Sync output counters">
            <div><span>sent</span><output id="sync-output-sent">0</output></div>
            <div><span>GPU busy</span><output id="sync-output-gpu-busy">0</output></div>
            <div><span>network</span><output id="sync-output-network">0</output></div>
            <div><span>failed</span><output id="sync-output-failed">0</output></div>
        </div>
        <div class="sync-output-message" role="status" aria-live="polite" aria-atomic="true">
            <p id="sync-output-connect-notice" hidden>Your browser may request loopback access. Sync will separately ask whether this exact origin may pair.</p>
            <p id="sync-output-status">Sync is not connected.</p>
        </div>
        <button type="button" id="sync-output-action" class="sync-output-action">Check again</button>
    </div>
</dialog>`

/**
 * Append the Sync output dialog to `container`. Returns the dialog element
 * and a remove() for teardown.
 */
export function buildSyncOutputPanel(container) {
    const template = container.ownerDocument.createElement('template')
    template.innerHTML = MARKUP.trim()
    const dialog = template.content.firstElementChild
    container.appendChild(dialog)

    // showModal() is called by the binder; watch the `open` attribute so the
    // escape stack tracks the modal however it was opened or closed.
    const close = () => { if (dialog.open) dialog.close() }
    const track = () => {
        if (dialog.open) registerEscapeable(dialog, close)
        else unregisterEscapeable(dialog)
    }
    const observer = new MutationObserver(track)
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] })

    return {
        dialog,
        get isOpen() { return dialog.open },
        remove() {
            observer.disconnect()
            unregisterEscapeable(dialog)
            dialog.remove()
        },
    }
}
