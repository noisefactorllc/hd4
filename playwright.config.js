// SPDX-License-Identifier: MIT
import { defineConfig, devices } from '@playwright/test'

const PORT = 3014
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
    testDir: './tests/e2e',
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
    // CDN shader compiles (camera/media + mixer pipelines) are slow on a
    // cold cache; give each spec room. Mirrors visualize's budget.
    timeout: 120_000,
    expect: { timeout: 15_000 },
    // The integration specs spin up headless WebGL contexts and fetch the
    // shader bundle from the CDN; concurrent runs cause GPU/bandwidth
    // contention that flakes. One worker keeps them honest.
    workers: 1,
    use: {
        baseURL,
        headless: true,
        trace: 'on-first-retry',
        // Fake audio + video devices so camera/audio specs exercise the
        // real getUserMedia / AudioContext path against deterministic
        // synthetic devices, and auto-grant permission (no OS prompt).
        launchOptions: {
            args: [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
            ],
        },
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
})
