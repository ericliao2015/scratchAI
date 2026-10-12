/**
 * Game sound effects from a handful of parameters (in the spirit of sfxr). The AI only has to
 * choose numbers, which small and large models both do well.
 */
import {RATE, envelope, normalize, oscillator, seededRandom} from './synth.js';

export const WAVES = ['square', 'sine', 'triangle', 'saw', 'noise'];

const DEFAULTS = {
    wave: 'square',
    freq: 440,
    freqEnd: 440,
    duration: 0.3,
    attack: 0.005,
    decay: 0.08,
    sustain: 0.5,
    release: 0.12,
    duty: 0.5,
    vibratoDepth: 0,
    vibratoRate: 6,
    arpeggio: [],
    arpeggioSpeed: 0.08,
    noiseMix: 0,
    lowpass: 1,
    volume: 0.9
};

// Labels are Chinese with English in messages-en.js (the panel translates them).
export const SFX_PRESETS = {
    jump: {label: '跳躍', params: {wave: 'square', freq: 260, freqEnd: 720, duration: 0.28, duty: 0.25, sustain: 0.4}},
    coin: {label: '金幣', params: {wave: 'square', freq: 990, freqEnd: 990, duration: 0.35, arpeggio: [0, 7], arpeggioSpeed: 0.07, duty: 0.5}},
    laser: {label: '雷射', params: {wave: 'saw', freq: 1500, freqEnd: 180, duration: 0.25, sustain: 0.3}},
    explosion: {label: '爆炸', params: {wave: 'noise', freq: 120, freqEnd: 40, duration: 0.9, attack: 0.002, decay: 0.3, sustain: 0.3, release: 0.5, lowpass: 0.35}},
    hit: {label: '受傷', params: {wave: 'noise', freq: 300, freqEnd: 80, duration: 0.18, noiseMix: 0.6, lowpass: 0.6}},
    powerup: {label: '升級', params: {wave: 'triangle', freq: 330, freqEnd: 990, duration: 0.6, arpeggio: [0, 4, 7, 12], arpeggioSpeed: 0.06, vibratoDepth: 0.3}},
    click: {label: '按鈕', params: {wave: 'sine', freq: 1200, freqEnd: 900, duration: 0.06, attack: 0.001, decay: 0.03, sustain: 0.2, release: 0.02}},
    boing: {label: '彈跳', params: {wave: 'sine', freq: 180, freqEnd: 420, duration: 0.45, vibratoDepth: 2, vibratoRate: 14}},
    magic: {label: '魔法', params: {wave: 'triangle', freq: 880, freqEnd: 1760, duration: 0.9, arpeggio: [0, 5, 9, 12, 16], arpeggioSpeed: 0.05, vibratoDepth: 0.4, release: 0.4}},
    win: {label: '過關', params: {wave: 'square', freq: 523, freqEnd: 523, duration: 1.1, arpeggio: [0, 4, 7, 12, 7, 12], arpeggioSpeed: 0.14, duty: 0.35, sustain: 0.6, release: 0.25}},
    lose: {label: '失敗', params: {wave: 'saw', freq: 392, freqEnd: 196, duration: 1.0, arpeggio: [0, -1, -2, -5], arpeggioSpeed: 0.22, lowpass: 0.5, sustain: 0.6}},
    alarm: {label: '警報', params: {wave: 'square', freq: 700, freqEnd: 700, duration: 1.2, vibratoDepth: 5, vibratoRate: 4, sustain: 0.8}},
    step: {label: '腳步', params: {wave: 'noise', freq: 200, freqEnd: 120, duration: 0.08, attack: 0.001, decay: 0.04, sustain: 0.1, release: 0.03, lowpass: 0.25}},
    pop: {label: '泡泡', params: {wave: 'sine', freq: 400, freqEnd: 1100, duration: 0.1, attack: 0.001, decay: 0.05, sustain: 0.2, release: 0.04}}
};

const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Accept parameters from people or the AI, keeping every value in a safe range.
 * @param {object} input parameters
 * @returns {object} complete parameters
 */
export const normalizeSfx = (input = {}) => {
    const p = {...DEFAULTS, ...(input && typeof input === 'object' ? input : {})};
    return {
        wave: WAVES.includes(p.wave) ? p.wave : 'square',
        freq: clamp(p.freq, 30, 4000, 440),
        freqEnd: clamp(p.freqEnd, 30, 4000, clamp(p.freq, 30, 4000, 440)),
        duration: clamp(p.duration, 0.03, 3, 0.3),
        attack: clamp(p.attack, 0, 1, DEFAULTS.attack),
        decay: clamp(p.decay, 0, 2, DEFAULTS.decay),
        sustain: clamp(p.sustain, 0, 1, DEFAULTS.sustain),
        release: clamp(p.release, 0, 2, DEFAULTS.release),
        duty: clamp(p.duty, 0.05, 0.95, 0.5),
        vibratoDepth: clamp(p.vibratoDepth, 0, 12, 0),
        vibratoRate: clamp(p.vibratoRate, 0, 30, 6),
        arpeggio: (Array.isArray(p.arpeggio) ? p.arpeggio : []).slice(0, 16)
            .map(n => clamp(n, -24, 24, 0)),
        arpeggioSpeed: clamp(p.arpeggioSpeed, 0.02, 1, 0.08),
        noiseMix: clamp(p.noiseMix, 0, 1, 0),
        lowpass: clamp(p.lowpass, 0.02, 1, 1),
        volume: clamp(p.volume, 0.1, 1, 0.9)
    };
};

/**
 * @param {object} params sound parameters (normalizeSfx)
 * @param {object} [options] {seed, rate}
 * @returns {Float32Array} samples
 */
export const renderSfx = (params, {seed = 1, rate = RATE} = {}) => {
    const p = normalizeSfx(params);
    const random = seededRandom(seed);
    const length = Math.ceil(p.duration * rate);
    const out = new Float32Array(length);
    const ratio = p.freqEnd / p.freq;
    // One-pole low-pass: 1 keeps everything, small values sound muffled.
    const alpha = p.lowpass >= 1 ? 1 : 1 - Math.exp(-2 * Math.PI * (p.lowpass * p.lowpass * 8000) / rate);
    let phase = 0;
    let filtered = 0;
    let held = 0;
    for (let i = 0; i < length; i++) {
        const t = i / rate;
        let freq = p.freq * (ratio ** (t / p.duration));
        if (p.arpeggio.length) {
            const step = Math.min(Math.floor(t / p.arpeggioSpeed), p.arpeggio.length - 1);
            freq *= 2 ** (p.arpeggio[step] / 12);
        }
        if (p.vibratoDepth) freq *= 2 ** ((p.vibratoDepth * Math.sin(2 * Math.PI * p.vibratoRate * t)) / 12);
        phase += freq / rate;
        let sample;
        if (p.wave === 'noise') {
            // Sample-and-hold noise: lower "frequency" sounds rumbly, higher sounds hissy.
            if (Math.floor(phase) !== Math.floor(phase - (freq / rate)) || i === 0) held = (random() * 2) - 1;
            sample = (held * 0.6) + (oscillator('noise', 0, {random}) * 0.4);
        } else {
            sample = oscillator(p.wave, phase, {duty: p.duty});
            if (p.noiseMix) sample = (sample * (1 - p.noiseMix)) + (oscillator('noise', 0, {random}) * p.noiseMix);
        }
        filtered += alpha * (sample - filtered);
        out[i] = filtered * envelope(t, p.duration, p);
    }
    return normalize(out, p.volume * 0.85);
};

/**
 * A slightly different version of a sound ("try another one").
 * @param {object} params parameters
 * @param {number} seed seed
 * @returns {object} parameters
 */
export const mutateSfx = (params, seed) => {
    const random = seededRandom(seed);
    const p = normalizeSfx(params);
    const wobble = (value, amount) => value * (1 + (((random() * 2) - 1) * amount));
    return normalizeSfx({
        ...p,
        freq: wobble(p.freq, 0.25),
        freqEnd: wobble(p.freqEnd, 0.25),
        duration: wobble(p.duration, 0.2),
        duty: wobble(p.duty, 0.3),
        vibratoDepth: p.vibratoDepth ? wobble(p.vibratoDepth, 0.4) : 0
    });
};
