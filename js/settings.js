// SPDX-License-Identifier: MIT
/**
 * Settings — persisted global config. A tiny key/value store over an
 * injected storage (localStorage in the app), merging stored values over
 * defaults. The drawer UI reads/writes it; the app applies changes.
 */
export const SETTINGS_DEFAULTS = {
    resolution: '1280x720', // program output resolution (WxH)
    outputFadeTime: 0.5, // OUTPUT FADE duration, seconds
    beatSensitivity: 1.4, // audio beat-detector threshold (SYNC)
    theme: 'neutral-dark',
}

export class Settings {
    constructor(storage, { key = 'hd4.settings.v1' } = {}) {
        this._storage = storage
        this._key = key
        this._values = { ...SETTINGS_DEFAULTS, ...this._load() }
    }

    get(k) { return this._values[k] }

    set(k, v) {
        this._values[k] = v
        this._save()
    }

    all() { return { ...this._values } }

    _load() {
        try {
            const raw = this._storage.getItem(this._key)
            const parsed = raw ? JSON.parse(raw) : {}
            return (parsed && typeof parsed === 'object') ? parsed : {}
        } catch {
            return {}
        }
    }

    _save() {
        try { this._storage.setItem(this._key, JSON.stringify(this._values)) } catch { /* ignore */ }
    }
}

/** Parse a "WxH" resolution string into { width, height }. */
export function parseResolution(str) {
    const [w, h] = String(str).split('x').map((n) => parseInt(n, 10))
    return { width: w, height: h }
}
