// SPDX-License-Identifier: MIT
/**
 * Camera devices — enumerate video inputs for the per-channel source
 * picker. The pure mapping is unit-tested; listCameras() is the
 * browser-bound wrapper.
 */

/** Map enumerateDevices() output to [{ deviceId, label }] camera options. */
export function cameraOptionsFromDevices(devices) {
    if (!Array.isArray(devices)) return []
    return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
}

/** Enumerate available cameras. Returns [] if unavailable. */
export async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return []
    try {
        return cameraOptionsFromDevices(await navigator.mediaDevices.enumerateDevices())
    } catch {
        return []
    }
}
