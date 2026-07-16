// SPDX-License-Identifier: MIT
/**
 * Logo mark — the Material Symbols "instant_mix" glyph (three vertical
 * faders), inlined as SVG so the mark ships with the app instead of pulling
 * an icon font. Path data unmodified from Google's Material Symbols
 * (Apache-2.0). Rendered beside the top-bar logotype and in the About
 * dialog; the fill follows the surrounding text colour (currentColor).
 */

const PATH = 'M200-160v-280h-80v-80h240v80h-80v280h-80Zm0-440v-200h80v200h-80Zm160 0v-80h80v-120h80v120h80v80H360Zm80 440v-360h80v360h-80Zm240 0v-120h-80v-80h240v80h-80v120h-80Zm0-280v-360h80v360h-80Z'

/** Inline SVG markup for the mark (decorative; hidden from the a11y tree). */
export function logoSvg(className = '') {
    const cls = className ? ` class="${className}"` : ''
    return `<svg${cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="${PATH}"/></svg>`
}
