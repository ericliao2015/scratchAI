/**
 * Background loop music. A score is plain JSON (from the built-in composer or from the AI)
 * and is rendered with the software synthesizer so the end joins the start seamlessly.
 *
 * Score:
 * {
 *   bpm: 120, bars: 8, style: 'happy',
 *   tracks: [{instrument: 'lead' | 'bass' | 'pad' | 'arp' | 'bell',
 *             notes: [[startBeat, beats, 'C5', velocity?], ...]}],
 *   drums: {kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14]}   16th-note steps of one bar
 * }
 */
import {RATE, midiToFreq, normalize, noteToMidi, seededRandom} from './synth.js';

const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    harmonic: [0, 2, 3, 5, 7, 8, 11],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9]
};

const INSTRUMENTS = {
    lead: {wave: 'square', duty: 0.3, attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.08, gain: 0.32},
    bass: {wave: 'triangle', attack: 0.005, decay: 0.1, sustain: 0.8, release: 0.05, gain: 0.5},
    pad: {wave: 'saw', attack: 0.25, decay: 0.3, sustain: 0.7, release: 0.4, gain: 0.12, lowpass: 0.25},
    arp: {wave: 'square', duty: 0.15, attack: 0.002, decay: 0.08, sustain: 0.3, release: 0.05, gain: 0.18},
    bell: {wave: 'sine', attack: 0.002, decay: 0.5, sustain: 0.15, release: 0.4, gain: 0.35, overtone: 0.4}
};

export const INSTRUMENT_NAMES = Object.keys(INSTRUMENTS);

// Labels are Chinese with English in messages-en.js.
export const MUSIC_STYLES = {
    happy: {label: '快樂童趣',
        bpm: 120,
        root: 'C4',
        scale: 'major',
        chords: [0, 4, 5, 3],
        lead: 'square',
        rhythm: 'bouncy',
        drums: {kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14]},
        bass: 'eighths',
        pad: false,
        arp: false},
    adventure: {label: '冒險',
        bpm: 132,
        root: 'D4',
        scale: 'dorian',
        chords: [0, 6, 5, 6],
        lead: 'saw',
        rhythm: 'driving',
        drums: {kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14]},
        bass: 'octaves',
        pad: true,
        arp: false},
    chiptune: {label: '8-bit 電玩',
        bpm: 150,
        root: 'A3',
        scale: 'minor',
        chords: [0, 5, 2, 6],
        lead: 'square',
        rhythm: 'driving',
        drums: {kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14]},
        bass: 'octaves',
        pad: false,
        arp: true},
    calm: {label: '輕鬆',
        bpm: 84,
        root: 'F4',
        scale: 'major',
        chords: [0, 5, 3, 4],
        lead: 'triangle',
        rhythm: 'gentle',
        drums: {kick: [0], snare: [], hat: [4, 12]},
        bass: 'whole',
        pad: true,
        arp: false,
        leadInstrument: 'bell'},
    tense: {label: '緊張',
        bpm: 140,
        root: 'A3',
        scale: 'harmonic',
        chords: [0, 0, 5, 4],
        lead: 'saw',
        rhythm: 'driving',
        drums: {kick: [0, 3, 8, 11], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]},
        bass: 'pulse',
        pad: true,
        arp: false},
    mystery: {label: '神秘',
        bpm: 90,
        root: 'E4',
        scale: 'phrygian',
        chords: [0, 1, 0, 6],
        lead: 'triangle',
        rhythm: 'sparse',
        drums: {kick: [0], snare: [], hat: [6, 14]},
        bass: 'whole',
        pad: true,
        arp: true,
        leadInstrument: 'bell'},
    space: {label: '太空',
        bpm: 100,
        root: 'C4',
        scale: 'lydian',
        chords: [0, 1, 0, 4],
        lead: 'sine',
        rhythm: 'gentle',
        drums: {kick: [], snare: [], hat: [0, 4, 8, 12]},
        bass: 'whole',
        pad: true,
        arp: true,
        leadInstrument: 'bell'},
    victory: {label: '勝利',
        bpm: 128,
        root: 'G4',
        scale: 'major',
        chords: [0, 3, 4, 0],
        lead: 'square',
        rhythm: 'bouncy',
        drums: {kick: [0, 8, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14]},
        bass: 'octaves',
        pad: true,
        arp: false},
    spooky: {label: '恐怖',
        bpm: 76,
        root: 'D4',
        scale: 'harmonic',
        chords: [0, 1, 0, 4],
        lead: 'triangle',
        rhythm: 'sparse',
        drums: {kick: [0, 10], snare: [], hat: []},
        bass: 'whole',
        pad: true,
        arp: false,
        leadInstrument: 'bell'}
};

const RHYTHMS = {
    bouncy: [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1], [1, 1, 1, 1], [1.5, 0.5, 2]],
    driving: [[0.5, 0.5, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1], [0.75, 0.75, 0.5, 2]],
    gentle: [[2, 2], [1, 1, 2], [3, 1], [4]],
    sparse: [[3, 1], [2, -2], [-1, 1, 2], [4]]
};

const scaleNote = (style, degree, octave = 0) => {
    const scale = SCALES[style.scale] || SCALES.major;
    const n = scale.length;
    const index = ((degree % n) + n) % n;
    const octaves = Math.floor(degree / n) + octave;
    return noteToMidi(style.root) + scale[index] + (12 * octaves);
};

/**
 * Compose a loop with the built-in rules (no AI needed).
 * @param {object} options {style, bars, bpm, seed}
 * @returns {object} score
 */
export const composeLoop = ({style: styleId = 'happy', bars = 8, bpm, seed = 1} = {}) => {
    const style = MUSIC_STYLES[styleId] || MUSIC_STYLES.happy;
    const random = seededRandom(seed);
    const pick = list => list[Math.floor(random() * list.length)];
    const barCount = [2, 4, 8, 16].includes(Number(bars)) ? Number(bars) : 8;
    const lead = [];
    const bass = [];
    const pad = [];
    const arp = [];
    // A 4-bar phrase, repeated with a varied answer, ending on the tonic.
    const phrase = [];
    let degree = pick([0, 2, 4]);
    for (let bar = 0; bar < 4; bar++) {
        const chord = style.chords[bar % style.chords.length];
        const rhythm = pick(RHYTHMS[style.rhythm] || RHYTHMS.bouncy);
        let beat = 0;
        for (let i = 0; i < rhythm.length; i++) {
            const length = rhythm[i];
            const duration = Math.abs(length);
            if (length > 0) {
                // Strong beats land on chord tones, the rest move by step.
                if (beat % 2 === 0) degree = chord + pick([0, 2, 4]);
                else degree += pick([-1, 1, 1, 2, -2]);
                degree = Math.max(-2, Math.min(9, degree));
                phrase.push({bar, beat, duration: duration * 0.95, degree, accent: i === 0});
            }
            beat += duration;
        }
    }
    for (let bar = 0; bar < barCount; bar++) {
        const phraseBar = bar % 4;
        const answer = Math.floor(bar / 4) % 2 === 1;
        const chord = style.chords[bar % style.chords.length];
        for (const note of phrase.filter(n => n.bar === phraseBar)) {
            let d = note.degree;
            if (answer && phraseBar === 3) d = note === phrase.filter(n => n.bar === 3).slice(-1)[0] ? 7 : d - 1;
            else if (answer && random() < 0.3) d += pick([-1, 1]);
            lead.push([(bar * 4) + note.beat, note.duration, scaleNote(style, d, 1), note.accent ? 1 : 0.8]);
        }
        const root = scaleNote(style, chord, -1);
        const fifth = scaleNote(style, chord + 4, -1);
        if (style.bass === 'whole') bass.push([bar * 4, 3.9, root, 0.9]);
        else if (style.bass === 'pulse') for (let i = 0; i < 8; i++) bass.push([(bar * 4) + (i / 2), 0.4, root, 0.8]);
        else if (style.bass === 'octaves') for (let i = 0; i < 8; i++) bass.push([(bar * 4) + (i / 2), 0.45, root + (i % 2 ? 12 : 0), 0.8]);
        else for (let i = 0; i < 4; i++) bass.push([(bar * 4) + i, 0.9, i === 2 ? fifth : root, 0.85]);
        if (style.pad) [0, 2, 4].forEach(step => pad.push([bar * 4, 4, scaleNote(style, chord + step, 0), 0.7]));
        if (style.arp) {
            for (let i = 0; i < 8; i++) {
                arp.push([(bar * 4) + (i / 2), 0.45, scaleNote(style, chord + [0, 2, 4, 7][i % 4], 1), 0.6]);
            }
        }
    }
    const tracks = [{instrument: style.leadInstrument || 'lead', notes: lead}, {instrument: 'bass', notes: bass}];
    if (pad.length) tracks.push({instrument: 'pad', notes: pad});
    if (arp.length) tracks.push({instrument: 'arp', notes: arp});
    return {style: styleId, bpm: bpm || style.bpm, bars: barCount, tracks, drums: style.drums};
};

const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Clean up a score (from the AI); fills bass and drums from the style when they are missing.
 * @param {object} input score
 * @returns {object} score
 */
export const normalizeScore = input => {
    const score = input && typeof input === 'object' ? input : {};
    const styleId = MUSIC_STYLES[score.style] ? score.style : 'happy';
    const style = MUSIC_STYLES[styleId];
    const bars = [2, 4, 8, 16].includes(Number(score.bars)) ? Number(score.bars) : 8;
    const beats = bars * 4;
    const tracks = (Array.isArray(score.tracks) ? score.tracks : []).slice(0, 6)
        .map(track => ({
            instrument: INSTRUMENTS[track && track.instrument] ? track.instrument : 'lead',
            notes: (Array.isArray(track && track.notes) ? track.notes : []).slice(0, 600)
                .map(n => (Array.isArray(n) ? n : [n && n.t, n && n.d, n && n.n, n && n.v]))
                .map(([t, d, note, v]) => [
                    clamp(t, 0, beats, -1), clamp(d, 0.05, 16, 0.5), noteToMidi(note), clamp(v, 0, 1, 0.8)
                ])
                .filter(([t, , midi]) => t >= 0 && t < beats && midi >= 24 && midi <= 108)
        }))
        .filter(track => track.notes.length);
    const defaults = composeLoop({style: styleId, bars, seed: 7});
    if (!tracks.some(t => t.instrument === 'bass')) tracks.push(defaults.tracks.find(t => t.instrument === 'bass'));
    if (!tracks.some(t => t.instrument !== 'bass')) tracks.unshift(defaults.tracks[0]);
    const steps = list => (Array.isArray(list) ? list : []).map(Number)
        .filter(s => Number.isInteger(s) && s >= 0 && s < 16);
    const drums = score.drums && typeof score.drums === 'object' ?
        {kick: steps(score.drums.kick), snare: steps(score.drums.snare), hat: steps(score.drums.hat)} : style.drums;
    return {style: styleId, bpm: clamp(score.bpm, 50, 200, style.bpm), bars, tracks, drums};
};

const TWO_PI = 2 * Math.PI;

// Fast waveform without allocations (this runs for every sample of every note).
const wave = (type, phase, duty) => {
    const p = phase - Math.floor(phase);
    if (type === 'square') return p < duty ? 1 : -1;
    if (type === 'triangle') return 1 - (4 * Math.abs(p - 0.5));
    if (type === 'saw') return (2 * p) - 1;
    return Math.sin(TWO_PI * p);
};

const addVoice = (out, {start, length, freq, velocity, instrument, rate}) => {
    const spec = INSTRUMENTS[instrument] || INSTRUMENTS.lead;
    const {attack, decay, sustain, release, gain} = spec;
    const duty = spec.duty || 0.5;
    const total = length + release;
    const count = Math.ceil(total * rate);
    const releaseStart = Math.max(total - release, 0);
    const alpha = spec.lowpass ? 1 - Math.exp(-2 * Math.PI * (spec.lowpass * spec.lowpass * 8000) / rate) : 1;
    const step = freq / rate;
    const amp = gain * velocity;
    const n = out.length;
    let filtered = 0;
    let index = Math.round(start * rate) % n;
    for (let i = 0; i < count; i++) {
        const t = i / rate;
        const phase = step * i;
        let s = wave(spec.wave, phase, duty);
        if (spec.overtone) s += spec.overtone * Math.sin(TWO_PI * phase * 2.01);
        if (instrument === 'pad') s = (s + wave('saw', phase * 1.005, duty)) / 2;
        filtered += alpha * (s - filtered);
        let level;
        if (t < attack) level = t / attack;
        else if (t < attack + decay) level = 1 - ((1 - sustain) * ((t - attack) / decay));
        else level = sustain;
        if (t >= releaseStart) level *= 1 - ((t - releaseStart) / release);
        // Wrap around so notes ringing past the end continue at the start: a seamless loop.
        out[index] += filtered * level * amp;
        index = index + 1 === n ? 0 : index + 1;
    }
};

const addDrum = (out, {start, kind, rate, random}) => {
    const lengths = {kick: 0.18, snare: 0.14, hat: 0.04};
    const count = Math.ceil(lengths[kind] * rate);
    const startIndex = Math.round(start * rate);
    let phase = 0;
    let previous = 0;
    for (let i = 0; i < count; i++) {
        const t = i / rate;
        const decay = Math.exp(-t / (lengths[kind] / 4));
        let s;
        if (kind === 'kick') {
            phase += (40 + (110 * Math.exp(-t * 30))) / rate;
            s = Math.sin(2 * Math.PI * phase) * 0.9;
        } else if (kind === 'snare') {
            s = (((random() * 2) - 1) * 0.6) + (Math.sin(2 * Math.PI * 185 * t) * 0.3);
        } else {
            const noise = (random() * 2) - 1;
            s = (noise - previous) * 0.5;
            previous = noise;
        }
        out[(startIndex + i) % out.length] += s * decay * (kind === 'hat' ? 0.35 : 0.6);
    }
};

/**
 * @param {object} score score (normalizeScore is applied)
 * @param {object} [options] {rate, seed}
 * @returns {Float32Array} samples of exactly `bars` bars
 */
export const renderScore = (score, {rate = RATE, seed = 3} = {}) => {
    const s = normalizeScore(score);
    const beat = 60 / s.bpm;
    const out = new Float32Array(Math.round(s.bars * 4 * beat * rate));
    for (const track of s.tracks) {
        for (const [t, d, midi, v] of track.notes) {
            addVoice(out, {
                start: t * beat,
                length: d * beat,
                freq: midiToFreq(midi),
                velocity: v,
                instrument: track.instrument,
                rate
            });
        }
    }
    const random = seededRandom(seed);
    for (let bar = 0; bar < s.bars; bar++) {
        for (const kind of ['kick', 'snare', 'hat']) {
            for (const step of s.drums[kind] || []) {
                addDrum(out, {start: ((bar * 4) + (step / 4)) * beat, kind, rate, random});
            }
        }
    }
    return normalize(out, 0.8);
};

/**
 * Length of a score in seconds.
 * @param {object} score score
 * @returns {number} seconds
 */
export const scoreSeconds = score => {
    const s = normalizeScore(score);
    return s.bars * 4 * 60 / s.bpm;
};
