// SPDX-License-Identifier: MIT
/**
 * manifest.js — HD4's static module description for the Noisedeck Audio rack.
 *
 * This is the whole compile-time contract the rack host needs: it is registered with the
 * host's Registry, which then `import()`s `entry` and calls its default factory
 * (rack-adapter.js's createModule) with a slot-bound host. Adding HD4 to a rack = adding this
 * manifest's URL to a rack config — no core edit. The shape matches rack-core's
 * validateManifest ({ id, name, version, units(1..8), entry(URL), capabilities: Role[],
 * jacks: JackDef[] }).
 *
 * HD4 is the first VIDEO module: it is a video source (its on-air PGM), a video sink (four
 * reserved video inputs), an audio source (its program audio), and a clock sink (its AUTO
 * switching follows the rack transport). `entry` and jack ids are root-relative so they
 * resolve under the shared dev origin; in production the entry is swapped for a CDN URL.
 *
 * Purely additive: this file does not exist on, and is never imported by, the standalone path.
 */
export default {
    id: 'hd4',
    name: 'HD4',
    version: '0.1.0',
    units: 4,
    entry: '/hd4/js/rack-adapter.js',
    capabilities: ['video-source', 'video-sink', 'audio-source', 'clock-sink'],
    jacks: [
        { id: 'hd4.vout', dir: 'out', kind: 'video', label: 'PGM' },
        { id: 'hd4.out', dir: 'out', kind: 'audio', label: 'AUD' },
        { id: 'hd4.vin1', dir: 'in', kind: 'video', label: 'IN1' },
        { id: 'hd4.vin2', dir: 'in', kind: 'video', label: 'IN2' },
        { id: 'hd4.vin3', dir: 'in', kind: 'video', label: 'IN3' },
        { id: 'hd4.vin4', dir: 'in', kind: 'video', label: 'IN4' },
    ],
}
