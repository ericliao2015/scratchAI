/**
 * Tiny software synthesizer for sound effects and loop music. Pure JavaScript (no Web Audio),
 * so it works offline, in tests and in workers, and the result is the same everywhere.
 */

export const RATE = 22050;

const NOTE_INDEX = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11};

/**
 * @param {string|number} note 'C4', 'F#3', 'Bb5' or a MIDI number
 * @returns {number} MIDI number (C4 = 60), NaN when invalid
 */
export const noteToMidi = note => {
    if (typeof note === 'number') return note;
    const match = /^([a-gA-G])([#b]?)(-?\d)$/.exec(String(note).trim());
    if (!match) return NaN;
    const accidental = match[2] === '#' ? 1 : (match[2] === 'b' ? -1 : 0);
    return ((Number(match[3]) + 1) * 12) + NOTE_INDEX[match[1].toLowerCase()] + accidental;
};

export const midiToFreq = midi => 440 * (2 ** ((midi - 69) / 12));

/**
 * Small deterministic random generator.
 * @param {number} seed seed
 * @returns {function(): number} random numbers in [0, 1)
 */
export const seededRandom = seed => {
    let state = (Math.floor(seed) >>> 0) || 1;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * One sample of a waveform.
 * @param {string} wave sine | square | triangle | saw | noise
 * @param {number} phase position in the cycle, 0..1
 * @param {object} [options] {duty, random}
 * @returns {number} -1..1
 */
export const oscillator = (wave, phase, {duty = 0.5, random = Math.random} = {}) => {
    const p = phase - Math.floor(phase);
    switch (wave) {
    case 'square': return p < duty ? 1 : -1;
    case 'triangle': return 1 - (4 * Math.abs(p - 0.5));
    case 'saw': return (2 * p) - 1;
    case 'noise': return (random() * 2) - 1;
    default: return Math.sin(2 * Math.PI * p);
    }
};

/**
 * ADSR envelope value at time t of a sound lasting `length` seconds.
 * @param {number} t seconds since start
 * @param {number} length total seconds (including release)
 * @param {object} env {attack, decay, sustain, release}
 * @returns {number} 0..1
 */
export const envelope = (t, length, {attack = 0.01, decay = 0.1, sustain = 0.7, release = 0.1}) => {
    if (t < 0 || t >= length) return 0;
    const releaseStart = Math.max(length - release, 0);
    let level;
    if (t < attack) level = t / Math.max(attack, 1e-4);
    else if (t < attack + decay) level = 1 - ((1 - sustain) * ((t - attack) / Math.max(decay, 1e-4)));
    else level = sustain;
    if (t >= releaseStart) level *= Math.max(0, 1 - ((t - releaseStart) / Math.max(release, 1e-4)));
    return level;
};

/**
 * Peak-normalize in place.
 * @param {Float32Array} samples samples
 * @param {number} [peak] target peak
 * @returns {Float32Array} samples
 */
export const normalize = (samples, peak = 0.85) => {
    let max = 0;
    for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
    if (max > 0) {
        const gain = peak / max;
        for (let i = 0; i < samples.length; i++) samples[i] *= gain;
    }
    return samples;
};

/**
 * 16-bit mono PCM WAV file.
 * @param {Float32Array} samples -1..1
 * @param {number} [rate] sample rate
 * @returns {Uint8Array} file bytes
 */
export const encodeWav = (samples, rate = RATE) => {
    const buffer = new ArrayBuffer(44 + (samples.length * 2));
    const view = new DataView(buffer);
    const text = (offset, value) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + (samples.length * 2), true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + (i * 2), s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buffer);
};
