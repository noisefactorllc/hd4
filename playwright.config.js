// SPDX-License-Identifier: MIT
import { defineConfig, devices } from '@playwright/test'

const PORT = 3014
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: 'list',
    timeout: 30_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL,
        headless: true,
        trace: 'on-first-retry',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: `npm run dev`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
})
