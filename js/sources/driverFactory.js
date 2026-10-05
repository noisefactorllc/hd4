// SPDX-License-Identifier: MIT
/**
 * Per-channel driver factory. Bound to a channel's persistent
 * ChannelRenderer (and its audio binding into the mixer), it dispatches a
 * source descriptor to the right driver. This is the seam the Channel's
 * injected `driverFactory` plugs into; the Channel stays renderer-agnostic.
 * `loadStill(id)` resolves a stored still's Blob for an image source that
 * names a still by id (a recalled memory slot).
 */
import { makeShaderDriver } from './shaderSource.js'
import { makeMediaDriver } from './mediaSource.js'

const NULL_DRIVER = { start() {}, stop() {}, tick() {} }

export function makeChannelDriverFactory(renderer, audio = null, { loadStill = null } = {}) {
    return (source, ctx) => {
        switch (source.type) {
            case 'shader':
                return makeShaderDriver(source, renderer)
            case 'camera':
            case 'video':
            case 'image':
                return makeMediaDriver(source, renderer, { ...ctx, audio, loadStill })
            default:
                return NULL_DRIVER
        }
    }
}
