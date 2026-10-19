// SPDX-License-Identifier: MIT
/**
 * The opt-in `?agent=1` command form: an accessible fallback for browser
 * tools that cannot run page JavaScript. It runs the same serialized
 * commands as window.HD4Agent.
 *
 * @module agent/console
 */
import { SCHEMAS } from './schemas.js'
import { DESCRIPTIONS, imageResult, jsonSchema } from './transports.js'
import { makeFailure } from './dispatcher.js'

/** Opt-in, accessible fallback for browser tools that cannot execute page JS. */
export function mountAgentConsole(agent) {
    if (document.getElementById('hd4-agent-console')) return
    const stylesheet = document.createElement('link')
    stylesheet.rel = 'stylesheet'
    stylesheet.href = new URL('../../css/agent.css', import.meta.url).href
    document.head.append(stylesheet)
    const panel = document.createElement('section')
    panel.id = 'hd4-agent-console'
    panel.setAttribute('aria-label', 'HD4 agent')
    panel.innerHTML = `
        <details open>
            <summary>HD4 agent</summary>
            <form>
                <label>Command <select aria-label="Command"></select></label>
                <p class="agent-description"></p>
                <details><summary>Argument schema</summary><pre class="agent-schema"></pre></details>
                <label>Arguments (JSON)<textarea aria-label="Arguments (JSON)" rows="5" spellcheck="false">{}</textarea></label>
                <button type="submit" disabled>Run command</button>
                <p role="status">Waiting for HD4…</p>
            </form>
            <pre aria-label="Command result" tabindex="0"></pre>
            <img alt="Command image" hidden>
            <a hidden download="hd4-thumbnail.png">Download image</a>
        </details>`
    document.body.append(panel)
    const select = panel.querySelector('select')
    const input = panel.querySelector('textarea')
    const button = panel.querySelector('button')
    const status = panel.querySelector('[role="status"]')
    const output = panel.querySelector('[aria-label="Command result"]')
    const preview = panel.querySelector('img')
    const download = panel.querySelector('a')
    let imageURL
    for (const name of Object.keys(SCHEMAS)) select.add(new Option(name, name))
    const describe = () => {
        panel.querySelector('.agent-description').textContent = DESCRIPTIONS[select.value].does
        panel.querySelector('.agent-schema').textContent = JSON.stringify(jsonSchema(SCHEMAS[select.value]), null, 2)
    }
    select.addEventListener('change', describe)
    describe()
    const clearImage = () => {
        if (imageURL) URL.revokeObjectURL(imageURL)
        imageURL = undefined
        preview.hidden = download.hidden = true
        preview.removeAttribute('src')
        download.removeAttribute('href')
    }
    window.addEventListener('pagehide', clearImage)
    panel.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault()
        if (button.disabled) return
        button.disabled = true
        const command = select.value
        status.textContent = `Running ${command}…`
        try {
            let envelope
            let args
            try { args = JSON.parse(input.value) } catch (err) {
                envelope = makeFailure(command, 'INVALID_JSON', err.message)
            }
            if (!envelope) envelope = await agent[command](args)
            const result = imageResult(envelope)
            clearImage()
            if (result.image) {
                const binary = atob(result.image.data)
                const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
                imageURL = URL.createObjectURL(new Blob([bytes], { type: result.image.mimeType }))
                preview.src = download.href = imageURL
                download.download = `hd4-thumbnail.${result.image.mimeType === 'image/png' ? 'png' : 'jpg'}`
                preview.hidden = download.hidden = false
            }
            output.textContent = JSON.stringify(result.envelope, null, 2)
            status.textContent = `${command}: ${envelope.ok ? 'complete' : envelope.error.code}`
        } catch (err) {
            output.textContent = JSON.stringify(makeFailure(command, 'INTERNAL_ERROR', err.message), null, 2)
            status.textContent = `${command}: failed`
        } finally {
            button.disabled = false
        }
    })
    agent.ready.then(() => {
        button.disabled = false
        status.textContent = 'Ready'
    })
}
