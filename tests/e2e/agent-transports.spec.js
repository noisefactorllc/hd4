// SPDX-License-Identifier: MIT
/**
 * The two browser routes beside window.HD4Agent: WebMCP page tools
 * (hd4_<command>) and the opt-in ?agent=1 command form.
 */
import { test, expect } from './fixtures.js'

const RED = 'search synth\nsolid(color: #ff0000).write(o0)\nrender(o0)'

async function load(page, query = '') {
    await page.goto(`/${query}`)
    await page.waitForFunction(() => window.__hd4?.ready === true && window.HD4Agent?.setProgram, null, { timeout: 30_000 })
    await page.evaluate(() => window.HD4Agent.ready)
}

test('the command form runs validation, changes and images without page evaluation', async ({ page }) => {
    await page.goto('/?agent=1')
    const panel = page.getByRole('region', { name: 'HD4 agent' })
    await expect(panel).toBeVisible({ timeout: 30_000 })
    const command = panel.getByLabel('Command', { exact: true })
    const args = panel.getByLabel('Arguments (JSON)', { exact: true })
    const run = panel.getByRole('button', { name: 'Run command', exact: true })
    const output = panel.getByLabel('Command result', { exact: true })
    await expect(run).toBeEnabled({ timeout: 30_000 })
    await command.selectOption('setProgram')
    await args.fill(JSON.stringify({ dsl: RED, channel: 3 }))
    await run.click()
    await expect(output).toContainText('"applied": true')
    await command.selectOption('validateProgram')
    await args.fill(JSON.stringify({ dsl: 'search synth\nnoise(madeUp: 1).write(o0)\nrender(o0)' }))
    await run.click()
    await expect(output).toContainText('"valid": false')
    await args.fill('{')
    await run.click()
    await expect(output).toContainText('INVALID_JSON')
    await command.selectOption('getProgram')
    await args.fill('')
    // Typed key by key: c, a and the digits are mixer shortcuts outside text fields.
    await args.pressSequentially('{"channel":3}')
    await run.click()
    await expect(output).toContainText('solid(color: #ff0000)')
    expect(await page.evaluate(() => ({ type: window.__hd4.switcher.type, auto: window.__hd4.autoMix.enabled, live: window.__hd4.switcher.live })))
        .toEqual({ type: 'mix', auto: false, live: 1 })
    await command.selectOption('getThumbnail')
    await args.fill('{"maxDimension":64,"format":"png","source":3}')
    await run.click()
    await expect(panel.getByRole('img', { name: 'Command image' })).toBeVisible()
    await expect(output).toContainText('"width": 64')
    await expect(output).not.toContainText('"bytes"')
    await expect(panel.getByRole('link', { name: 'Download image' })).toHaveAttribute('href', /^blob:/)
})

test('the command form is opt-in', async ({ page }) => {
    await load(page)
    await expect(page.getByRole('region', { name: 'HD4 agent' })).toHaveCount(0)
})

test('WebMCP registers every command and runs the real handlers', async ({ page }) => {
    // Capture the native registration boundary in browsers without WebMCP.
    // The callbacks below are the actual app handlers, not command mocks.
    await page.addInitScript(() => {
        const tools = new Map()
        Object.defineProperty(document, 'modelContext', { value: {
            registerTool(tool) { tools.set(tool.name, tool) },
        } })
        window.registeredAgentTools = tools
    })
    await load(page)
    const out = await page.evaluate(async (dsl) => {
        const tools = window.registeredAgentTools
        const names = Array.from(tools.keys())
        const { SCHEMAS } = await import('/js/agent/schemas.js')
        const set = await tools.get('hd4_setProgram').execute({ dsl, channel: 2 })
        const invalid = await tools.get('hd4_setProgram').execute({ dsl: 'x', force: true })
        const program = await tools.get('hd4_getProgram').execute({ channel: 2 })
        const thumbnail = await tools.get('hd4_getThumbnail').execute({ maxDimension: 64, format: 'png', source: 2 })
        return {
            names,
            expected: Object.keys(SCHEMAS).map(name => `hd4_${name}`),
            set,
            invalid,
            program,
            thumbnail: { ...thumbnail, content: thumbnail.content.map(c => c.type === 'image' ? { ...c, data: c.data.slice(0, 12) } : c) },
            schema: tools.get('hd4_getThumbnail').inputSchema,
            readOnly: tools.get('hd4_getProgram').annotations.readOnlyHint,
            mutation: tools.get('hd4_take').annotations.readOnlyHint,
        }
    }, RED)
    expect([...out.names].sort()).toEqual([...out.expected].sort())
    expect(out.set.isError).toBe(false)
    expect(JSON.parse(out.program.content[0].text).result.dsl).toBe(RED)
    expect(out.invalid.isError).toBe(true)
    expect(JSON.parse(out.invalid.content[0].text).error.code).toBe('INVALID_ARGS_UNKNOWN')
    expect(out.thumbnail.content.find(c => c.type === 'image')).toMatchObject({ mimeType: 'image/png' })
    expect(out.thumbnail.content.find(c => c.type === 'text').text).not.toContain('"bytes"')
    expect(out.schema.properties.maxDimension).toMatchObject({ minimum: 16, maximum: 1024 })
    expect(out.schema.properties.source).toMatchObject({ type: ['string', 'integer'], enum: ['program', 'preview', 1, 2, 3, 4] })
    expect(out.readOnly).toBe(true)
    expect(out.mutation).toBe(false)
})

test('an unavailable WebMCP registration does not break commands or the form', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(document, 'modelContext', { value: {
            registerTool() { return Promise.reject(new Error('registration unavailable')) },
        } })
    })
    await load(page, '?agent=1')
    const env = await page.evaluate(() => window.HD4Agent.getState())
    expect(env.ok).toBe(true)
    await expect(page.getByRole('region', { name: 'HD4 agent' }).getByRole('button', { name: 'Run command' })).toBeEnabled()
})
