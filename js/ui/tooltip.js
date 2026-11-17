// SPDX-License-Identifier: MIT
/**
 * Hover tooltips go through handfish: the `.tooltip` class plus `data-title`,
 * shown by initializeTooltips() in its own layer, which keeps the tooltip on
 * screen and at its full width at the edges of the page. A native `title`
 * would add the browser's own tooltip on top, so it is removed.
 */
export function setTooltip(el, text) {
    if (!el) return
    el.removeAttribute('title')
    if (text == null || text === '') {
        delete el.dataset.title
        el.classList.remove('tooltip')
        return
    }
    el.dataset.title = String(text)
    el.classList.add('tooltip')
}
