/**
 * Post-processing for audio from AI services, before it goes into a Scratch project:
 * mono, 22 kHz (keeps projects small), trimmed, normalized, and for music a seamless loop.
 */
import {RATE, normalize} from './synth.js';

export const MAX_SECONDS = 30;

/**
 * Raw 16-bit little-endian mono PCM (ElevenLabs "pcm_22050") to samples.
 * @param {ArrayBuffer} buffer bytes
 * @returns {Float32Array} samples
 */
export const pcm16ToFloat = buffer => {
    const view = new DataView(buffer);
    const out = new Float32Array(Math.floor(buffer.byteLength / 2));
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
    return out;
};

/**
 * Average channels into one.
 * @param {Float32Array[]} channels channel data
 * @returns {Float32Array} mono samples
 */
export const toMono = channels => {
    if (channels.length === 1) return channels[0];
    const out = new Float32Array(channels[0].length);
    for (const channel of channels) {
        for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
    }
    return out;
};

/**
 * Linear-interpolation resampling (good enough for game audio at 22 kHz).
 * @param {Float32Array} samples input
 * @param {number} from input rate
 * @param {number} [to] output rate
 * @returns {Float32Array} resampled
 */
export const resample = (samples, from, to = RATE) => {
    if (from === to) return samples;
    const ratio = from / to;
    const out = new Float32Array(Math.floor(samples.length / ratio));
    for (let i = 0; i < out.length; i++) {
        const pos = i * ratio;
        const index = Math.floor(pos);
        const frac = pos - index;
        const a = samples[index] || 0;
        const b = samples[Math.min(index + 1, samples.length - 1)] || 0;
        out[i] = a + ((b - a) * frac);
    }
    return out;
};

/**
 * Cut quiet parts at the start and end.
 * @param {Float32Array} samples samples
 * @param {object} [options] {threshold, keep (seconds of margin), rate}
 * @returns {Float32Array} trimmed copy
 */
export const trimSilence = (samples, {threshold = 0.01, keep = 0.02, rate = RATE} = {}) => {
    let start = 0;
    let end = samples.length - 1;
    while (start < end && Math.abs(samples[start]) < threshold) start++;
    while (end > start && Math.abs(samples[end]) < threshold) end--;
    const margin = Math.round(keep * rate);
    return samples.slice(Math.max(0, start - margin), Math.min(samples.length, end + margin + 1));
};

/**
 * Short fades so a sound effect does not click.
 * @param {Float32Array} samples samples (changed in place)
 * @param {number} [seconds] fade length
 * @param {number} [rate] sample rate
 * @returns {Float32Array} samples
 */
export const fadeEdges = (samples, seconds = 0.01, rate = RATE) => {
    const n = Math.min(Math.round(seconds * rate), Math.floor(samples.length / 2));
    for (let i = 0; i < n; i++) {
        samples[i] *= i / n;
        samples[samples.length - 1 - i] *= i / n;
    }
    return samples;
};

/**
 * Make music loop seamlessly: the last part is cross-faded into the beginning and removed,
 * so the end flows straight into the start.
 * @param {Float32Array} samples samples
 * @param {object} [options] {crossfade (seconds), rate}
 * @returns {Float32Array} loopable samples
 */
export const makeLoop = (samples, {crossfade = 1.5, rate = RATE} = {}) => {
    const n = Math.min(Math.round(crossfade * rate), Math.floor(samples.length / 4));
    if (n < 2) return samples;
    const out = samples.slice(0, samples.length - n);
    for (let i = 0; i < n; i++) {
        // Equal-power cross-fade keeps the loudness steady through the seam.
        const t = i / n;
        const tail = samples[samples.length - n + i];
        out[i] = (out[i] * Math.sin(t * Math.PI / 2)) + (tail * Math.cos(t * Math.PI / 2));
    }
    return out;
};

/**
 * Full chain for one generated sound.
 * @param {object} input {channels: Float32Array[], sampleRate}
 * @param {object} [options] {kind: 'sfx' | 'music', loop, seamless, maxSeconds}
 * @returns {Float32Array} samples at RATE
 */
export const prepareAudio = ({channels, sampleRate}, {
    kind = 'sfx', loop = kind === 'music', seamless = false, maxSeconds = MAX_SECONDS
} = {}) => {
    let samples = resample(toMono(channels), sampleRate, RATE);
    if (samples.length > maxSeconds * RATE) samples = samples.slice(0, maxSeconds * RATE);
    // `seamless`: the service already made a loop (ElevenLabs loop mode); keep it as it is.
    if (!loop) samples = fadeEdges(kind === 'sfx' ? trimSilence(samples) : samples);
    else if (!seamless) samples = makeLoop(trimSilence(samples, {threshold: 0.002, keep: 0}));
    return normalize(samples, 0.85);
};

// Browser decoder for MP3/WAV/OGG from AI services.
const browserDecode = async data => {
    const Context = typeof window === 'undefined' ? null : (window.AudioContext || window.webkitAudioContext);
    if (!Context) throw new Error('這個瀏覽器無法解碼音訊');
    const context = new Context();
    try {
        const buffer = await context.decodeAudioData(data.slice(0));
        const channels = [];
        for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
        return {channels, sampleRate: buffer.sampleRate};
    } finally {
        if (context.close) context.close();
    }
};

/**
 * Turn service output (services.js) into channels.
 * @param {object} audio {format: 'pcm16', rate, data} or {format: 'encoded', data}
 * @param {object} [options] {decoder: async ArrayBuffer => {channels, sampleRate}}
 * @returns {Promise<object>} {channels, sampleRate}
 */
export const decodeAudio = (audio, {decoder = browserDecode} = {}) => {
    if (audio.format === 'pcm16') return Promise.resolve({channels: [pcm16ToFloat(audio.data)], sampleRate: audio.rate});
    return decoder(audio.data);
};
