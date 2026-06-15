// SPDX-License-Identifier: MIT
/**
 * Built-in source library — utility patterns and color fills, organized
 * into categories for the per-channel source picker (no generative/VJ
 * effects). Patterns come from Noisemaker's synth/testPattern util effect;
 * fills from synth/solid. Pure data; verified against the live engine by
 * the integration suite. Sources are keyed by name (stable across reorders).
 */
const tp = (pattern) => `search synth\ntestPattern(pattern: ${pattern}).write(o0)\nrender(o0)`
const solid = (hex) => `search synth\nsolid(color: ${hex}).write(o0)\nrender(o0)`

export const SOURCE_LIBRARY = [
    {
        category: 'Patterns',
        items: [
            { name: 'Color Bars', dsl: tp('colorBars') },
            { name: 'Checkerboard', dsl: tp('checkerboard') },
            { name: 'Grid', dsl: tp('gridLines') },
            { name: 'UV Map', dsl: tp('uvMap') },
            { name: 'Dot Grid', dsl: tp('dotGrid') },
            { name: 'Color Grid', dsl: tp('colorGrid') },
        ],
    },
    {
        category: 'Fills',
        items: [
            { name: 'Black', dsl: solid('#000000') },
            { name: 'White', dsl: solid('#ffffff') },
            { name: 'Red', dsl: solid('#e5484d') },
            { name: 'Green', dsl: solid('#46a758') },
            { name: 'Blue', dsl: solid('#4a88fb') },
            { name: 'Amber', dsl: solid('#f5a623') },
        ],
    },
]

/** Flat list of every library source. */
export const SHADER_PRESETS = SOURCE_LIBRARY.flatMap((c) => c.items)

export function presetByName(name) {
    return SHADER_PRESETS.find((p) => p.name === name) || null
}

export function presetByDsl(dsl) {
    return SHADER_PRESETS.find((p) => p.dsl === dsl) || null
}
