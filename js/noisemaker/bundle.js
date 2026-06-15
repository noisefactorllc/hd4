// SPDX-License-Identifier: MIT
/**
 * ESM bundle loader for the Noisemaker shaders core.
 *
 * Dynamically imports the engine from the shaders CDN — minified in
 * production, non-minified for local dev so stack traces stay readable.
 * Mirrors the loader used across the product line (see visualize).
 *
 * The `/1` segment is the rolling major-version channel. Pin to a
 * specific release (e.g. `/1.0.60`) by changing SHADER_CDN.
 */

const SHADER_CDN = 'https://shaders.noisedeck.app/1'

const isLocalDev = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.protocol === 'file:'
)

const bundlePath = isLocalDev
    ? `${SHADER_CDN}/noisemaker-shaders-core.esm.js`
    : `${SHADER_CDN}/noisemaker-shaders-core.esm.min.js`

const bundle = await import(bundlePath)

export const CDN_BASE = SHADER_CDN

export const {
    CanvasRenderer,
    Effect,
    registerEffect,
    getEffect,
    getAllEffects,
    compile,
    extractEffectNamesFromDsl,
    extractEffectsFromDsl,
    AudioInputManager,
    ProgramState,
    VERSION
} = bundle

export const _bundle = bundle
