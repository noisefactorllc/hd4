// SPDX-License-Identifier: MIT
/**
 * Shader source driver — compiles a Noisemaker DSL program into the
 * channel's renderer. The renderer self-animates, so tick() is a no-op.
 * stop() intentionally leaves the renderer running: the next source's
 * driver recompiles into the same persistent renderer.
 */
export function makeShaderDriver(source, renderer) {
    return {
        start() { return renderer.compile(source.dsl) },
        stop() { /* renderer is persistent across source swaps */ },
        tick() { /* shaders advance on the renderer's own loop */ },
    }
}
