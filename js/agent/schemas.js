// SPDX-License-Identifier: MIT
/**
 * Argument schemas for HD4Agent commands, and the validator that checks
 * them. Every schema is strict: an undeclared field fails with
 * INVALID_ARGS_UNKNOWN, so a command with no arguments accepts only {}.
 * `default` documents the value a handler uses when the field is omitted.
 *
 * Supported subset: object (properties, required, additionalProperties),
 * string (enum, minLength, maxLength), number and integer (min, max, enum),
 * boolean, and a list of types (`type: ['string', 'integer']`) checked
 * against `enum`.
 *
 * The allowed values come from the modules that define them, so a schema
 * cannot drift from the controls it drives.
 *
 * @module agent/schemas
 */

import { SHADER_PRESETS } from '../sources/presets.js'
import { MAX_PROGRAM_LENGTH } from '../programPaste.js'
import { CURVE_ORDER } from '../curves.js'
import { BLEND_MODES } from '../blend.js'
import { VFX_ORDER } from '../vfx.js'
import { COMPOSITION_MODES } from '../compositorState.js'
import { PINP_SIZES, PINP_SHAPES, PINP_ASPECTS, BORDER_COLORS, SPLIT_PATTERNS } from '../compositing.js'
import { KEY_TYPES, CHROMA_COLORS, LUMA_COLORS } from '../key.js'
import { AUTO_MODES } from '../autoMix.js'
import { MIN_BPM, MAX_BPM } from '../beatClock.js'
import { STRIP_DEFAULTS, STRIP_RANGES } from '../audio/strip.js'
import { MAIN_DEFAULTS, MAIN_RANGES, REVERB_TYPES } from '../audio/mainBus.js'
import { MEMORY_SLOTS } from '../memory.js'
import { RESOLUTIONS } from '../settings.js'
import { THEMES } from '../theme.js'
import { USER_ACTIONS, USER_BUTTON_COUNT } from '../userButtons.js'

const strict = (properties, required = []) =>
    ({ type: 'object', properties, required, additionalProperties: false })

const NONE = strict({})
const CHANNEL = { type: 'integer', min: 1, max: 4 }
const PROGRAM_TEXT = { type: 'string', minLength: 1, maxLength: MAX_PROGRAM_LENGTH }
const LEVEL = { type: 'number', min: 0, max: 1 }

/** The transition types of the TRANSITION section (CUT / MIX / WIPE). */
export const TRANSITION_TYPES = ['cut', 'mix', 'wipe']

/** Source-library entries a channel can show, plus the captured still. */
export const LIBRARY_SOURCES = [...SHADER_PRESETS.map(preset => preset.name), 'still']

/** The sections that getControls reports. */
export const CONTROL_SECTIONS = ['channels', 'composition', 'audio', 'auto']

// Sends at -60 dB are the strip's "off"; JSON has no -Infinity.
const SEND_FLOOR = -60
// A ratio above 24 is INF:1 (a limiter); see nearestRatio in audio/strip.js.
const RATIO = { type: 'number', min: 1, max: 100 }

/** A partial-update schema for a parameter set: booleans, enums, ranges. */
function parameters(defaults, ranges, special = {}) {
    const properties = {}
    for (const [key, value] of Object.entries(defaults)) {
        if (special[key]) properties[key] = special[key]
        else if (typeof value === 'boolean') properties[key] = { type: 'boolean' }
        else if (ranges[key]) {
            const [min, max] = ranges[key]
            properties[key] = { type: 'number', min: Number.isFinite(min) ? min : SEND_FLOOR, max }
        }
    }
    return strict(properties)
}

const STRIP = parameters(STRIP_DEFAULTS, STRIP_RANGES, { compRatio: RATIO })
const MAIN_BUS = parameters(MAIN_DEFAULTS, MAIN_RANGES, {
    reverbType: { type: 'string', enum: REVERB_TYPES },
    mbHiRatio: RATIO,
    mbMidRatio: RATIO,
    mbLoRatio: RATIO,
})

const PINP = strict({
    source: CHANNEL,
    size: { type: 'string', enum: Object.keys(PINP_SIZES) },
    aspect: { type: 'string', enum: PINP_ASPECTS },
    shape: { type: 'string', enum: PINP_SHAPES },
    borderWidth: { type: 'integer', min: 0, max: 15 },
    borderColor: { type: 'string', enum: Object.keys(BORDER_COLORS) },
    hPosition: { type: 'number', min: -50, max: 50 },
    vPosition: { type: 'number', min: -50, max: 50 },
    hCropping: { type: 'number', min: 1, max: 100 },
    vCropping: { type: 'number', min: 1, max: 100 },
    hViewPosition: { type: 'number', min: -50, max: 50 },
    vViewPosition: { type: 'number', min: -50, max: 50 },
})

const SPLIT = strict({
    sourceB: CHANNEL,
    pattern: { type: 'string', enum: SPLIT_PATTERNS },
    aCenter: { type: 'number', min: 0, max: 100 },
    bCenter: { type: 'number', min: 0, max: 100 },
    centerPosition: { type: 'number', min: -50, max: 50 },
})

export const SCHEMAS = {
    getState: NONE,
    getProgram: strict({ channel: CHANNEL }),
    getControls: strict({ section: { type: 'string', enum: CONTROL_SECTIONS } }, ['section']),
    validateProgram: strict({ dsl: PROGRAM_TEXT }, ['dsl']),
    setProgram: strict({ dsl: PROGRAM_TEXT, channel: CHANNEL }, ['dsl']),
    searchEffects: strict({
        query: { type: 'string' },
        namespace: { type: 'string' },
        limit: { type: 'integer', min: 1, max: 500, default: 50 },
    }),
    getEffectDefinition: strict({ effectId: { type: 'string', minLength: 1 } }, ['effectId']),
    setSource: strict({ channel: CHANNEL, source: { type: 'string', enum: LIBRARY_SOURCES } }, ['source']),
    setChannelOptions: strict({
        channel: CHANNEL,
        fit: { type: 'string', enum: ['cover', 'contain'] },
        autoInclude: { type: 'boolean' },
    }, ['channel']),
    listDevices: NONE,
    setCameraSource: strict({ channel: CHANNEL, deviceId: { type: 'string' } }),
    setPreview: strict({ channel: CHANNEL }, ['channel']),
    take: strict({ channel: CHANNEL, transition: { type: 'string', enum: ['auto', 'cut'], default: 'auto' } }),
    setTransition: strict({
        type: { type: 'string', enum: TRANSITION_TYPES },
        time: { type: 'number', min: 0, max: 4 },
        curve: { type: 'string', enum: CURVE_ORDER },
        blend: { type: 'string', enum: BLEND_MODES },
    }),
    setAuto: strict({
        on: { type: 'boolean' },
        mode: { type: 'string', enum: AUTO_MODES },
        bars: { type: 'integer', min: 1, max: 32 },
        bpm: { type: 'number', min: MIN_BPM, max: MAX_BPM },
        matchAudio: { type: 'boolean' },
    }),
    setComposition: strict({ mode: { type: 'string', enum: COMPOSITION_MODES }, pinp: PINP, split: SPLIT }),
    setKey: strict({
        on: { type: 'boolean' },
        type: { type: 'string', enum: KEY_TYPES },
        source: { type: ['integer', 'string'], enum: [1, 2, 3, 4, 'still'] },
        level: { type: 'integer', min: 0, max: 255 },
        gain: { type: 'integer', min: 0, max: 255 },
        chromaColor: { type: 'string', enum: CHROMA_COLORS },
        lumaColor: { type: 'string', enum: LUMA_COLORS },
    }),
    setOutput: strict({
        freeze: { type: 'boolean' },
        fade: { type: 'boolean' },
        vfx: { type: 'string', enum: VFX_ORDER },
    }),
    captureStill: NONE,
    setRecording: strict({ recording: { type: 'boolean' } }, ['recording']),
    openViewport: NONE,
    setAudioChannel: strict({
        channel: CHANNEL,
        fader: LEVEL,
        mute: { type: 'boolean' },
        solo: { type: 'boolean' },
        source: { type: 'string', enum: ['follow', 'none'] },
        strip: STRIP,
    }, ['channel']),
    setAudioMain: strict({
        fader: LEVEL,
        monitor: { type: 'string', enum: ['main', 'aux'] },
        recordSource: { type: 'string', enum: ['program', 'aux'] },
        bus: MAIN_BUS,
    }),
    setAudioInput: strict({ channel: CHANNEL, deviceId: { type: 'string' } }, ['channel']),
    listMemory: NONE,
    saveMemory: strict({ slot: { type: 'integer', min: 1, max: MEMORY_SLOTS } }, ['slot']),
    recallMemory: strict({ slot: { type: 'integer', min: 1, max: MEMORY_SLOTS } }, ['slot']),
    getSettings: NONE,
    setSettings: strict({
        resolution: { type: 'string', enum: RESOLUTIONS },
        outputFadeTime: { type: 'number', min: 0.1, max: 3 },
        beatSensitivity: { type: 'number', min: 1, max: 3 },
        theme: { type: 'string', enum: THEMES.map(theme => theme.value) },
    }),
    setUserButton: strict({
        button: { type: 'integer', min: 1, max: USER_BUTTON_COUNT },
        action: { type: 'string', enum: [...USER_ACTIONS.map(action => action.id), 'none'] },
    }, ['button', 'action']),
    getThumbnail: strict({
        maxDimension: { type: 'integer', min: 16, max: 1024, default: 256 },
        format: { type: 'string', enum: ['png', 'jpg'], default: 'jpg' },
        source: { type: ['string', 'integer'], enum: ['program', 'preview', 1, 2, 3, 4], default: 'program' },
    }),
}

function fail(code, message, details) {
    return { ok: false, code, message, details }
}

function typeName(v) {
    if (v === null) return 'null'
    if (Array.isArray(v)) return 'array'
    return typeof v
}

function isType(value, type) {
    switch (type) {
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
        case 'string': return typeof value === 'string'
        case 'boolean': return typeof value === 'boolean'
        case 'integer': return Number.isInteger(value)
        case 'number': return typeof value === 'number' && Number.isFinite(value)
        default: return true
    }
}

function enumFailure(schema, field, value) {
    return fail('INVALID_ARGS_ENUM', `${field}: expected one of [${schema.enum.join(', ')}]`,
        { field, allowed: schema.enum, got: value })
}

/**
 * Validate `value` against `schema`.
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string, details: object}}
 */
export function validate(value, schema, path = '') {
    if (!schema) return { ok: true }
    const field = path || 'args'
    if (Array.isArray(schema.type)) {
        const type = schema.type.find(candidate => isType(value, candidate))
        if (!type) {
            return fail('INVALID_ARGS_TYPE', `${field}: expected ${schema.type.join(' or ')}, got ${typeName(value)}`,
                { field, expected: schema.type, got: typeName(value) })
        }
        return validate(value, { ...schema, type }, path)
    }
    switch (schema.type) {
        case 'object': {
            if (!isType(value, 'object')) {
                return fail('INVALID_ARGS_TYPE', `${field}: expected object, got ${typeName(value)}`,
                    { field, expected: 'object', got: typeName(value) })
            }
            for (const req of schema.required || []) {
                if (!(req in value)) {
                    const f = path ? `${path}.${req}` : req
                    return fail('INVALID_ARGS_REQUIRED', `${f} is required`, { field: f })
                }
            }
            for (const key of Object.keys(value)) {
                const f = path ? `${path}.${key}` : key
                const sub = schema.properties?.[key]
                if (!sub) {
                    if (schema.additionalProperties === false) {
                        return fail('INVALID_ARGS_UNKNOWN', `${f}: unknown field`, { field: f })
                    }
                    continue
                }
                const r = validate(value[key], sub, f)
                if (!r.ok) return r
            }
            return { ok: true }
        }
        case 'string':
            if (typeof value !== 'string') {
                return fail('INVALID_ARGS_TYPE', `${field}: expected string, got ${typeName(value)}`,
                    { field, expected: 'string', got: typeName(value) })
            }
            if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
                return fail('INVALID_ARGS_RANGE', `${field}: shorter than ${schema.minLength} characters`,
                    { field, min: schema.minLength, got: value.length })
            }
            if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
                return fail('INVALID_ARGS_RANGE', `${field}: longer than ${schema.maxLength} characters`,
                    { field, max: schema.maxLength, got: value.length })
            }
            if (schema.enum && !schema.enum.includes(value)) return enumFailure(schema, field, value)
            return { ok: true }
        case 'number':
        case 'integer':
            if (!isType(value, schema.type)) {
                return fail('INVALID_ARGS_TYPE', `${field}: expected ${schema.type}, got ${typeName(value)}`,
                    { field, expected: schema.type, got: typeName(value) })
            }
            if (schema.enum && !schema.enum.includes(value)) return enumFailure(schema, field, value)
            if ((typeof schema.min === 'number' && value < schema.min)
                || (typeof schema.max === 'number' && value > schema.max)) {
                return fail('INVALID_ARGS_RANGE', `${field}: ${value} is outside ${schema.min} to ${schema.max}`,
                    { field, min: schema.min, max: schema.max, got: value })
            }
            return { ok: true }
        case 'boolean':
            if (typeof value !== 'boolean') {
                return fail('INVALID_ARGS_TYPE', `${field}: expected boolean, got ${typeName(value)}`,
                    { field, expected: 'boolean', got: typeName(value) })
            }
            return { ok: true }
        default:
            return { ok: true }
    }
}
