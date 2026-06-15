// SPDX-License-Identifier: MIT
/**
 * Themes — a curated set of handfish themes. Each maps a data-theme value
 * to its stylesheet file. applyTheme lazily injects the theme's stylesheet
 * (before css/hd4.css so our Atkinson font + tweaks always win) and sets
 * the data-theme attribute. THEMES is pure data.
 */
export const THEMES = [
    { value: 'neutral-dark', file: 'neutral', label: 'Neutral' },
    { value: 'gray-dark', file: 'gray', label: 'Gray' },
    { value: 'ocean', file: 'ocean', label: 'Ocean' },
    { value: 'dusk', file: 'dusk', label: 'Dusk' },
    { value: 'sunset', file: 'sunset', label: 'Sunset' },
    { value: 'terminal', file: 'terminal', label: 'Terminal' },
]

const THEME_BASE = 'https://handfish.noisefactor.io/0/styles/themes/'
const loadedFiles = new Set(['neutral']) // neutral.css is loaded in index.html

export function applyTheme(value) {
    const theme = THEMES.find((t) => t.value === value) || THEMES[0]
    if (!loadedFiles.has(theme.file)) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = `${THEME_BASE}${theme.file}.css`
        const appCss = document.querySelector('link[href="css/hd4.css"]')
        if (appCss) document.head.insertBefore(link, appCss)
        else document.head.appendChild(link)
        loadedFiles.add(theme.file)
    }
    document.documentElement.dataset.theme = theme.value
}
