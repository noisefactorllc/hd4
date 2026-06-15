// SPDX-License-Identifier: MIT
/**
 * Per-channel driver factory. Bound to a channel's persistent
 * ChannelRenderer, it dispatches a source descriptor to the right driver
 * (shader vs media). This is the seam the Channel's injected
 * `driverFactory` plugs into; the Channel itself stays renderer-agnostic.
 */
import { makeShaderDriver } from './shaderSource.js'
import { makeMediaDriver } from './mediaSource.js'

const NULL_DRIVER = { start() {}, stop() {}, tick() {} }

export function makeChannelDriverFactory(renderer) {
    return (source, ctx) => {
        switch (source.type) {
            case 'shader':
                return makeShaderDriver(source, renderer)
            case 'camera':
            case 'video':
            case 'image':
                return makeMediaDriver(source, renderer, ctx)
            default:
                return NULL_DRIVER
        }
    }
}
