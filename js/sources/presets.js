// SPDX-License-Identifier: MIT
/**
 * Built-in shader sources — utility patterns and color fills for a video
 * mixer (no generative/"noisedeck" effects). The test patterns come from
 * Noisemaker's synth/testPattern util effect; solids from synth/solid.
 * Pure data; verified against the live engine by the integration suite.
 */
const tp = (pattern) => `search synth\ntestPattern(pattern: ${pattern}).write(o0)\nrender(o0)`
const solid = (hex) => `search synth\nsolid(color: ${hex}).write(o0)\nrender(o0)`

export const SHADER_PRESETS = [
    { name: 'Color Bars', dsl: tp('colorBars') },
    { name: 'Checkerboard', dsl: tp('checkerboard') },
    { name: 'Grid', dsl: tp('gridLines') },
    { name: 'Black', dsl: solid('#000000') },
    { name: 'White', dsl: solid('#ffffff') },
    { name: 'Blue', dsl: solid('#4a88fb') },
    { name: 'Amber', dsl: solid('#f5a623') },
]
