// SPDX-License-Identifier: MIT
/**
 * Main-bus audio helpers — pure config for the MAIN [SETUP]: the
 * main 3-band EQ, the main limiter, the reverb (return / time / type), the
 * multiband compressor, and the AUX bus. The AudioMixer builds the graph
 * from these.
 */
import { nearestRatio } from './strip.js'

export const REVERB_TYPES = ['room', 'hall']

export const MAIN_DEFAULTS = Object.freeze({
    mainMute: false,
    mainLimiter: true, mainLimiterThreshold: -6,
    eqHi: 0, eqHiFreq: 10000,
    eqMid: 0, eqMidFreq: 500, eqMidQ: 1,
    eqLo: 0, eqLoFreq: 100,
    reverbReturn: -60, reverbTime: 1.5, reverbType: 'room',
    mbComp: false,
    mbHiThres: -20, mbMidThres: -16, mbLoThres: -20,
    mbHiRatio: 2, mbMidRatio: 2.5, mbLoRatio: 2,
    auxMute: false, auxLevel: 0, auxDelay: 0,
    autoMixing: false, // AUTO MIXING global switch
})

const RANGES = {
    mainLimiterThreshold: [-40, 0],
    eqHi: [-15, 15], eqHiFreq: [1000, 20000],
    eqMid: [-15, 15], eqMidFreq: [20, 20000], eqMidQ: [0.5, 16],
    eqLo: [-15, 15], eqLoFreq: [20, 500],
    reverbReturn: [-60, 10], reverbTime: [0, 5],
    mbHiThres: [-40, 0], mbMidThres: [-40, 0], mbLoThres: [-40, 0],
    auxLevel: [-60, 10], auxDelay: [0, 500],
}
const BOOLS = new Set(['mainMute', 'mainLimiter', 'mbComp', 'auxMute', 'autoMixing'])
const RATIOS = new Set(['mbHiRatio', 'mbMidRatio', 'mbLoRatio'])

export function clampMainParam(key, value) {
    if (BOOLS.has(key)) return !!value
    if (RATIOS.has(key)) return nearestRatio(Number(value))
    if (key === 'reverbType') return REVERB_TYPES.includes(value) ? value : 'room'
    const range = RANGES[key]
    if (!range) return value
    const v = Number(value)
    if (Number.isNaN(v)) return MAIN_DEFAULTS[key]
    return Math.max(range[0], Math.min(range[1], v))
}

/** Impulse length + decay exponent for the reverb convolver. */
export function reverbIRParams(type, time) {
    const seconds = Math.max(0.1, Number(time) || 0)
    const decay = type === 'hall' ? 1.6 : 2.8 // room decays faster (shorter tail)
    return { seconds, decay }
}
