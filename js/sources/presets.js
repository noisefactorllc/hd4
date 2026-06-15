// SPDX-License-Identifier: MIT
/**
 * Built-in shader presets — known-good Noisemaker DSL programs used as
 * channel defaults and as quick picks in the source selector. Pure data,
 * importable anywhere. Verified against the live engine by the
 * integration suite (a preset that fails to compile fails that test).
 */
export const SHADER_PRESETS = [
    { name: 'Noise', dsl: 'search synth\nnoise().write(o0)\nrender(o0)' },
    { name: 'Gradient', dsl: 'search synth\ngradient().write(o0)\nrender(o0)' },
    { name: 'Blue', dsl: 'search synth\nsolid(color: #4a88fb).write(o0)\nrender(o0)' },
    { name: 'Amber', dsl: 'search synth\nsolid(color: #f5a623).write(o0)\nrender(o0)' },
]

/** Which preset each channel (1–4) boots with, by index into SHADER_PRESETS. */
export const DEFAULT_SOURCE_PRESET_INDEX = [0, 1, 2, 3]
