// SPDX-License-Identifier: MIT
/**
 * Shared Playwright fixtures for the HD4 e2e suite.
 *
 * Pre-release helper: when HANDFISH_LOCAL points at a local handfish build
 * (e.g. HANDFISH_LOCAL=../handfish/dist), serve the handfish CDN from it so the
 * not-yet-published industrial components (tempo-bar, slider-value,
 * select-dropdown, industrial.css, …) can be exercised before they ship. No
 * machine path is committed; with the env var unset the suite runs against the
 * real CDN. The route is installed automatically before every test (it must be
 * in place before page.goto), via an auto-`use` fixture — specs import { test,
 * expect } from './fixtures.js' instead of '@playwright/test'.
 */
import { test as base, expect } from '@playwright/test'
import { readFileSync } from 'fs'

export const test = base.extend({
    handfishLocal: [async ({ page }, run) => {
        const local = process.env.HANDFISH_LOCAL
        if (local) {
            await page.route('https://handfish.noisefactor.io/0/**', async (route) => {
                const rel = new URL(route.request().url()).pathname.replace(/^\/0\//, '')
                try {
                    const body = readFileSync(`${local}/${rel}`)
                    const type = rel.endsWith('.css')
                        ? 'text/css'
                        : rel.endsWith('.js')
                            ? 'text/javascript'
                            : 'application/octet-stream'
                    await route.fulfill({ status: 200, contentType: type, body })
                } catch {
                    await route.fulfill({ status: 404, body: 'missing ' + rel })
                }
            })
        }
        await run(local || null)
    }, { auto: true }],
})

export { expect }
