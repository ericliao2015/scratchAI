/**
 * AI sound effects and loop music: the AI picks synthesizer parameters or writes a score,
 * the browser renders it to a WAV and it is added to a sprite or the stage.
 */
import {extractJson} from '../json.js';
import {RATE, encodeWav} from './synth.js';
import {SFX_PRESETS, mutateSfx, normalizeSfx, renderSfx} from './sfx.js';
import {INSTRUMENT_NAMES, MUSIC_STYLES, composeLoop, normalizeScore, renderScore} from './music.js';

export {SFX_PRESETS, MUSIC_STYLES, composeLoop, mutateSfx, normalizeSfx, renderSfx, renderScore, normalizeScore};

/**
 * Rendered sound ready for the project.
 * @param {string} name sound name
 * @param {Float32Array} samples samples at RATE
 * @returns {object} {name, wav (Uint8Array), rate, sampleCount, seconds}
 */
export const makeSound = (name, samples) => ({
    name,
    wav: encodeWav(samples, RATE),
    rate: RATE,
    sampleCount: samples.length,
    seconds: samples.length / RATE
});

/**
 * Sound object for vm.addSound / sprite3 files.
 * @param {object} storage scratch storage
 * @param {object} sound makeSound() result
 * @returns {object} {name, assetId, ext, rate, sampleCount, asset} as used by apply.js
 */
export const soundAsset = (storage, sound) => {
    const asset = storage.createAsset(storage.AssetType.Sound, 'wav', sound.wav, null, true);
    return {name: sound.name, assetId: asset.assetId, ext: 'wav', rate: sound.rate, sampleCount: sound.sampleCount, asset};
};

/**
 * Add a generated sound to a target.
 * @param {object} vm VM
 * @param {object} sound makeSound() result
 * @param {string} targetId target
 * @returns {Promise<string>} name the sound got (Scratch renames duplicates)
 */
export const addSoundToTarget = async (vm, sound, targetId) => {
    const resolved = soundAsset(vm.runtime.storage, sound);
    await vm.addSound({
        name: resolved.name,
        assetId: resolved.assetId,
        dataFormat: 'wav',
        format: '',
        rate: resolved.rate,
        sampleCount: resolved.sampleCount,
        md5: `${resolved.assetId}.wav`,
        asset: resolved.asset
    }, targetId);
    const target = vm.runtime.getTargetById(targetId);
    const sounds = target ? target.getSounds() : [];
    return sounds.length ? sounds[sounds.length - 1].name : resolved.name;
};

/**
 * Sounds requested in generated programs: {"sfx": "jump"}, {"sfx": {params}}, {"music": "happy"}.
 * @param {object} spec sound spec
 * @returns {?object} makeSound() result, or null when the spec is not a generated sound
 */
export const soundFromSpec = spec => {
    if (!spec || typeof spec !== 'object') return null;
    if (spec.sfx) {
        const preset = typeof spec.sfx === 'string' ? SFX_PRESETS[spec.sfx] : null;
        const params = preset ? preset.params : spec.sfx;
        return makeSound(spec.name || (typeof spec.sfx === 'string' ? spec.sfx : 'effect'), renderSfx(params));
    }
    if (spec.music) {
        const style = typeof spec.music === 'string' ? spec.music : spec.music.style;
        const score = typeof spec.music === 'object' && spec.music.tracks ? spec.music :
            composeLoop({style, bars: (spec.music && spec.music.bars) || 8, seed: 11});
        return makeSound(spec.name || `music-${score.style || style || 'loop'}`, renderScore(score));
    }
    return null;
};

// ---- AI ----

const SFX_SYSTEM = `You design short game sound effects for a children's programming editor. The sound is made by a
small synthesizer; you choose its parameters. Reply with ONE JSON object only:
{"name": "short sound name", "params": {
  "wave": "square" | "sine" | "triangle" | "saw" | "noise",
  "freq": start pitch in Hz (30-4000), "freqEnd": end pitch in Hz (slides between them),
  "duration": seconds (0.03-3), "attack", "decay", "release": seconds, "sustain": 0-1,
  "duty": 0.05-0.95 (square only), "vibratoDepth": semitones (0-12), "vibratoRate": Hz,
  "arpeggio": [semitone steps, e.g. 0, 4, 7], "arpeggioSpeed": seconds per step,
  "noiseMix": 0-1, "lowpass": 0.02-1 (lower = more muffled), "volume": 0.1-1}}
Examples of good parameters:
${Object.entries(SFX_PRESETS).map(([id, p]) => `${id}: ${JSON.stringify(p.params)}`)
        .join('\n')}`;

/**
 * Ask the AI to design a sound effect.
 * @param {object} options {client, description, language, signal}
 * @returns {Promise<object>} {name, params}
 */
export const designSfx = async ({client, description, language = '繁體中文', signal}) => {
    const response = await client.complete({
        system: SFX_SYSTEM,
        messages: [{role: 'user', content: `Sound wanted: ${description}\nWrite "name" in ${language}.`}],
        json: true,
        maxTokens: 1000
    }, {signal});
    const answer = extractJson(response.text);
    return {name: String(answer.name || description).slice(0, 30), params: normalizeSfx(answer.params || answer)};
};

const musicSystem = style => `You compose short background LOOPS for children's games. Reply with ONE JSON object only:
{"bpm": 60-180, "bars": 4 or 8, "tracks": [
  {"instrument": "lead", "notes": [[startBeat, lengthInBeats, "C5", velocity 0-1], ...]},
  {"instrument": "bass", "notes": [...]}],
 "drums": {"kick": [16th-note steps 0-15 of one bar], "snare": [...], "hat": [...]}}
Instruments: ${INSTRUMENT_NAMES.join(', ')} (lead = melody, bass = low notes, pad = long chords, arp = fast broken
chords, bell = soft melody). Beats start at 0; 4 beats per bar; the drum pattern repeats every bar.
The music must loop: the last bar should lead back into the first. Keep the melody singable, in one key, and not
too busy. Style: ${style.label} (suggested ${style.bpm} bpm, ${style.scale} scale around ${style.root}).`;

/**
 * Ask the AI to compose a loop.
 * @param {object} options {client, style, description, bars, signal}
 * @returns {Promise<object>} normalized score
 */
export const composeWithAI = async ({client, style = 'happy', description = '', bars = 8, signal}) => {
    const styleInfo = MUSIC_STYLES[style] || MUSIC_STYLES.happy;
    const response = await client.complete({
        system: musicSystem(styleInfo),
        messages: [{role: 'user', content: `Compose a ${bars}-bar loop.${description ? ` Mood or use: ${description}` : ''}`}],
        json: true,
        maxTokens: 6000
    }, {signal});
    return normalizeScore({...extractJson(response.text), style, bars});
};
