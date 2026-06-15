// SPDX-License-Identifier: MIT
/**
 * Audio input devices — enumerate microphones / line inputs for the
 * per-channel audio-source picker (independent of video). Pure mapping is
 * unit-tested; listAudioInputs() is the browser-bound wrapper.
 */

/** Map enumerateDevices() output to [{ deviceId, label }] audio inputs. */
export function audioInputOptionsFromDevices(devices) {
    if (!Array.isArray(devices)) return []
    return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }))
}

/** Enumerate available audio inputs. Returns [] if unavailable. */
export async function listAudioInputs() {
    if (!navigator.mediaDevices?.enumerateDevices) return []
    try {
        return audioInputOptionsFromDevices(await navigator.mediaDevices.enumerateDevices())
    } catch {
        return []
    }
}
