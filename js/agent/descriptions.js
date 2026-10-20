// SPDX-License-Identifier: MIT
/**
 * What each HD4Agent command does and returns, in the groups and order that
 * llms-full.txt lists them. scripts/build-llms-full.mjs renders the command
 * reference from this file and SCHEMAS, and tests/unit/agentContract.test.js
 * fails when they disagree.
 *
 * `remote: false` marks a command that a Seance session cannot run: it needs
 * the person at the browser (a device permission, a download or a pop-up
 * window), or it reads or changes what the person keeps in this browser
 * (memory slots, settings, USER buttons, device names). Seance relays every
 * answer to everyone in the session, and any writer can send commands, so
 * those stay out of the relay. Through a session they answer
 * REMOTE_UNAVAILABLE.
 *
 * @module agent/descriptions
 */

export const COMMAND_GROUPS = [
    {
        title: 'Read state',
        commands: {
            getState: {
                does: 'Returns the state snapshot. Every envelope already includes it in `state`.',
                returns: 'the snapshot',
            },
            getProgram: {
                does: 'Returns the program text of one channel and whether it is the program that runs. A channel that shows a camera, a video, an image or nothing has no program text. Through a Seance session it is the text the session holds for the channel. `channel` defaults to the PVW channel.',
                returns: '`{ channel, source, dsl, running }`, where `source` is `shader`, `camera`, `video`, `image` or `none`',
            },
            getControls: {
                does: 'Returns every parameter of one section of the live mixer: `channels` (sources, fit, AUTO rotation, whether a still was captured), `composition` (PinP, SPLIT and KEY parameters), `audio` (strips, main bus, monitor, record source) or `auto` (auto-switching and tempo).',
                returns: '`{ section, ... }` with the section\'s values',
            },
        },
    },
    {
        title: 'Programs',
        commands: {
            validateProgram: {
                does: 'Compiles `dsl` without applying it.',
                returns: '`{ valid, diagnostics }`',
            },
            setProgram: {
                does: 'Compiles `dsl` and makes it the shader source of one channel, like a pasted program. `channel` defaults to the PVW channel, so a new program can be checked on preview before a take. A program that does not compile changes nothing and fails with INVALID_PROGRAM. A channel that showed a camera, a video or an image stops it.',
                returns: '`{ applied: true, channel, diagnostics }` (warnings only)',
            },
        },
    },
    {
        title: 'Effects',
        commands: {
            searchEffects: {
                does: 'Lists effects whose id, description or tags contain `query`. `namespace` keeps one namespace.',
                returns: '`{ total, effects: [{ effectId, namespace, name, description, tags }] }`',
            },
            getEffectDefinition: {
                does: 'Returns the DSL function name and the parameters of one effect.',
                returns: '`{ effectId, func, namespace, description, params: [{ name, type, default, min?, max?, enum?, choices?, label? }] }`',
            },
        },
    },
    {
        title: 'Channels',
        commands: {
            setSource: {
                does: 'Shows a pattern or a fill from the source library on a channel, or `still`, the still captured in this page (see captureStill; not through a Seance session). `channel` defaults to the PVW channel.',
                returns: '`{ channel, source, name }`',
            },
            setChannelOptions: {
                does: 'Sets how a camera, video or image fills the channel (`cover` crops, `contain` scales) and whether the channel takes part in the AUTO rotation.',
                returns: '`{ channel, fit, autoInclude }`',
            },
            listDevices: {
                does: 'Lists the cameras and audio inputs the browser reports, with their device ids for setCameraSource and setAudioInput. Names can be empty until the person allows camera or microphone access.',
                returns: '`{ cameras: [{ deviceId, label }], audioInputs: [{ deviceId, label }] }`',
                remote: false,
            },
            setCameraSource: {
                does: 'Shows a camera on a channel. `deviceId` picks a camera (see listDevices); empty or omitted is the default camera. The browser can ask the person for camera permission. `channel` defaults to the PVW channel.',
                returns: '`{ channel, source: "camera", deviceId }`',
                remote: false,
            },
        },
    },
    {
        title: 'Switching',
        commands: {
            setPreview: {
                does: 'Queues a channel on the PVW (preview) monitor.',
                returns: '`{ live, preview, transitioning }`',
            },
            take: {
                does: 'Takes a channel to program. Without `channel` it takes the PVW channel, and the outgoing program returns to PVW, like the TAKE (`cut`) and AUTO (`auto`) buttons. With `channel` it takes that channel and leaves PVW alone, like the program bus buttons. `auto` uses the selected transition type and time; `cut` switches at once, also during a transition. An `auto` take while a transition runs fails with CONFLICT_TRANSITION_RUNNING.',
                returns: '`{ live, preview, transitioning }`',
            },
            setTransition: {
                does: 'Sets the transition type (`cut`, `mix`, `wipe`), its time in seconds, the fade curve (also used by OUTPUT FADE) and the MIX blend mode. Omitted fields keep their value.',
                returns: '`{ type, time, curve, blend }`',
            },
            setAuto: {
                does: 'Sets beat-synced auto-switching: AUTO on or off, the mode (`scan`, `random`, `follows-audio`), bars per switch, the tempo in BPM, and SYNC (match the tempo to the audio). Omitted fields keep their value.',
                returns: '`{ on, mode, bars, bpm, matchAudio }`',
            },
        },
    },
    {
        title: 'Composition',
        commands: {
            setComposition: {
                does: 'Sets the composition type (`off`, `pinp`, `split`, `quad`) and the PinP and SPLIT parameters. Positions run from -50 (left or top) through 0 (centre) to 50. Omitted fields keep their value.',
                returns: '`{ mode, pinp, split }`',
            },
            setKey: {
                does: 'Sets the KEY overlay: on or off, `chroma` or `luma`, its source (a channel, or `still`, which a Seance session cannot use), LEVEL and GAIN (0 to 255) and the key colour. Turning the key on with no source keys channel 1. Omitted fields keep their value.',
                returns: '`{ on, type, source, level, gain, chromaColor, lumaColor }`, where `source` is a channel, `still` or `null`',
            },
        },
    },
    {
        title: 'Output',
        commands: {
            setOutput: {
                does: 'Sets FREEZE (hold the program frame), OUTPUT FADE (fade the program to black over the fade time) and the output VFX filter. Omitted fields keep their value.',
                returns: '`{ freeze, fade, vfx }`, where `fade` is true while the output fades to or holds black',
            },
            captureStill: {
                does: 'Captures the program as a still, like the STILL button. The still becomes the KEY source `still` and the channel source `still`. HD4 also keeps its bytes in this browser, as the STILL button does, so memory slots can name it.',
                returns: '`{ captured, width, height }`',
                remote: false,
            },
            setRecording: {
                does: 'Starts or stops recording the program and its audio. Stopping saves the recording as a browser download.',
                returns: '`{ recording }`',
                remote: false,
            },
            openViewport: {
                does: 'Opens the program in a window for a secondary display, or focuses it. A pop-up blocker can refuse it.',
                returns: '`{ open }`',
                remote: false,
            },
        },
    },
    {
        title: 'Audio',
        commands: {
            setAudioChannel: {
                does: 'Sets one channel strip: fader (0 to 1), mute, solo, its audio source (`follow` the video, or `none`) and its processing (`strip`: high-pass filter, 3-band EQ, gate, compressor, pan, delay, AUX and reverb sends, auto-audio). Omitted fields keep their value.',
                returns: '`{ channel, fader, mute, solo, source }`',
            },
            setAudioMain: {
                does: 'Sets the main fader (0 to 1), what the speakers monitor (`main` or the `aux` mix), what a recording captures (`program` or `aux`), and the main bus (`bus`: mute, limiter, EQ, reverb, multiband compressor, AUX bus, AUTO MIXING). Omitted fields keep their value.',
                returns: '`{ fader, monitor, recordSource }`',
            },
            setAudioInput: {
                does: 'Uses an audio input device as a channel\'s audio source. `deviceId` empty or omitted is the default input. The browser can ask the person for microphone permission.',
                returns: '`{ channel, source }`, where `source` is `device`, or `none` when the input did not start',
                remote: false,
            },
        },
    },
    {
        title: 'Memory',
        commands: {
            listMemory: {
                does: 'Lists the eight memory slots, which this browser keeps.',
                returns: '`{ slots: [{ slot, occupied }] }`',
                remote: false,
            },
            saveMemory: {
                does: 'Saves the full mixer state to a memory slot, replacing what the slot held. A slot keeps channel sources, fit, PVW, the program channel, transition, VFX, composition and audio.',
                returns: '`{ saved: true, slot }`',
                remote: false,
            },
            recallMemory: {
                does: 'Recalls a memory slot. A source that cannot start (a camera without permission) falls back on its channel.',
                returns: '`{ recalled: true, slot }`',
                remote: false,
            },
        },
    },
    {
        title: 'Settings',
        commands: {
            getSettings: {
                does: 'Returns the settings this browser keeps (output resolution, OUTPUT FADE time, SYNC beat sensitivity, theme), the USER button assignments and the actions a USER button can take.',
                returns: '`{ settings, userButtons: [{ button, action }], actions: [{ id, label }] }`',
                remote: false,
            },
            setSettings: {
                does: 'Sets the program output resolution, the OUTPUT FADE time in seconds, the SYNC beat sensitivity and the theme. The settings persist in this browser. Omitted fields keep their value.',
                returns: 'every setting',
                remote: false,
            },
            setUserButton: {
                does: 'Assigns an action to a USER button (1 to 5), or `none`. The assignment persists in this browser.',
                returns: '`{ button, action }`',
                remote: false,
            },
        },
    },
    {
        title: 'Images',
        commands: {
            getThumbnail: {
                does: 'Returns an image of the program output (`program`), of the PVW channel (`preview`) or of channel 1 to 4. Through a Seance session the image is added to the session as its own bytes, and `image` replaces `bytes`; there it answers REMOTE_UNAVAILABLE unless every channel shows a program (a channel still showing the last frame of its previous source counts as not showing it), the KEY does not show the still and FREEZE is off, because cameras, video, images and stills stay on the person\'s computer.',
                returns: '`{ bytes, mimeType, width, height, source, channel }`, with `bytes` in base64 and `channel` the channel shown (`null` for the program output). Through a session: `{ image: { id, mimeType, bytes }, mimeType, width, height, source, channel }`, where `image.bytes` is the byte count',
            },
        },
    },
]
