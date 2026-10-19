// SPDX-License-Identifier: MIT
/**
 * Shader source driver — compiles a Noisemaker DSL program into the
 * channel's renderer. The renderer self-animates, so tick() is a no-op.
 * stop() intentionally leaves the renderer running: the next source's
 * driver recompiles into the same persistent renderer.
 *
 * A program that fails to compile never reached the screen (the renderer
 * keeps its previous program), so start() rejects: the channel then falls
 * back to its previous source instead of naming one it is not showing.
 */
export function makeShaderDriver(source, renderer) {
    return {
        async start() {
            const result = await renderer.compile(source.dsl)
            if (!result?.success) throw new Error(result?.error || 'compile error')
            return result
        },
        stop() { /* renderer is persistent across source swaps */ },
        tick() { /* shaders advance on the renderer's own loop */ },
    }
}
