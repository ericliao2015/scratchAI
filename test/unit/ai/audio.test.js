import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {makeVM} from '../../helpers/ai-vm.js';
import {RATE, encodeWav, noteToMidi} from '../../../src/ai/audio/synth.js';
import {SFX_PRESETS, normalizeSfx, renderSfx} from '../../../src/ai/audio/sfx.js';
import {MUSIC_STYLES, composeLoop, normalizeScore, renderScore, scoreSeconds} from '../../../src/ai/audio/music.js';
import {addSoundToTarget, composeWithAI, designSfx, makeSound} from '../../../src/ai/audio/index.js';
import {applyGenerated, generate} from '../../../src/ai/generate.js';

const fakeClient = replies => ({
    calls: [],
    async complete (request) {
        this.calls.push(request);
        return {text: replies.shift(), usage: {}, model: 'fake'};
    }
});

const peak = samples => samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);

describe('synthesized audio', () => {
    test('notes and WAV encoding', () => {
        expect(noteToMidi('C4')).toBe(60);
        expect(noteToMidi('A4')).toBe(69);
        expect(noteToMidi('F#3')).toBe(54);
        expect(noteToMidi('x')).toBeNaN();
        const wav = encodeWav(new Float32Array([0, 1, -1]));
        const text = String.fromCharCode(...wav.slice(0, 4)) + String.fromCharCode(...wav.slice(8, 12));
        expect(text).toBe('RIFFWAVE');
        expect(wav.length).toBe(44 + 6);
        expect(new DataView(wav.buffer).getUint32(24, true)).toBe(RATE);
    });

    test('every preset renders a non-silent sound of the right length', () => {
        for (const [id, preset] of Object.entries(SFX_PRESETS)) {
            const samples = renderSfx(preset.params);
            expect(samples.length).toBe(Math.ceil(normalizeSfx(preset.params).duration * RATE));
            expect(peak(samples)).toBeGreaterThan(0.3);
            expect(samples.every(Number.isFinite)).toBe(true);
            expect(id).toBeTruthy();
        }
        // parameters out of range are clamped instead of breaking
        expect(normalizeSfx({wave: 'bogus', freq: -5, duration: 99})).toMatchObject({wave: 'square', freq: 30, duration: 3});
    });

    test('every style composes a loop of exactly the bar length', () => {
        for (const style of Object.keys(MUSIC_STYLES)) {
            const score = composeLoop({style, bars: 4, seed: 5});
            const samples = renderScore(score);
            expect(samples.length).toBe(Math.round(scoreSeconds(score) * RATE));
            expect(peak(samples)).toBeGreaterThan(0.5);
            expect(samples.every(Number.isFinite)).toBe(true);
        }
        // different seeds give different melodies; the same seed the same one
        const a = composeLoop({style: 'happy', seed: 1}).tracks[0].notes;
        expect(composeLoop({style: 'happy', seed: 1}).tracks[0].notes).toEqual(a);
        expect(composeLoop({style: 'happy', seed: 2}).tracks[0].notes).not.toEqual(a);
    });

    test('AI scores are cleaned up and filled in from the style', () => {
        const score = normalizeScore({style: 'space', bpm: 999, bars: 3, tracks: [
            {instrument: 'lead', notes: [[0, 1, 'C5'], [2, 1, 'Q9'], [99, 1, 'C5'], {t: 4, d: 2, n: 'E5'}]}
        ]});
        expect(score.bpm).toBe(200);
        expect(score.bars).toBe(8);
        expect(score.tracks[0].notes).toEqual([[0, 1, 72, 0.8], [4, 2, 76, 0.8]]);
        expect(score.tracks.some(t => t.instrument === 'bass')).toBe(true);
        expect(score.drums).toEqual(MUSIC_STYLES.space.drums);
    });

    test('AI designs effects and composes loops', async () => {
        const sfxClient = fakeClient([JSON.stringify({name: '雷射槍', params: {wave: 'saw', freq: 2000, freqEnd: 200, duration: 0.2}})]);
        const sfx = await designSfx({client: sfxClient, description: '雷射槍'});
        expect(sfx).toMatchObject({name: '雷射槍', params: {wave: 'saw', freq: 2000}});
        expect(sfxClient.calls[0].system).toContain('laser:');

        const musicClient = fakeClient([JSON.stringify({bpm: 100, bars: 4, tracks: [{instrument: 'lead', notes: [[0, 2, 'G4']]}]})]);
        const score = await composeWithAI({client: musicClient, style: 'calm', bars: 4});
        expect(score).toMatchObject({style: 'calm', bpm: 100, bars: 4});
        expect(musicClient.calls[0].system).toContain('輕鬆');
    });

    test('sounds are added to the project, also from generated programs', async () => {
        const vm = await makeVM();
        const stage = vm.runtime.getTargetForStage();
        const name = await addSoundToTarget(vm, makeSound('coin', renderSfx(SFX_PRESETS.coin.params)), stage.id);
        expect(name).toBe('coin');
        expect(stage.getSounds()[0]).toMatchObject({name: 'coin', dataFormat: 'wav', rate: RATE});

        const program = {
            type: 'program',
            stage: {
                sounds: [{music: 'adventure', name: 'bgm'}],
                scripts: [[{opcode: 'event_whenflagclicked'}, {opcode: 'control_forever', substacks: {SUBSTACK: [
                    {opcode: 'sound_playuntildone', inputs: {SOUND_MENU: 'bgm'}}
                ]}}]]
            },
            sprites: [{name: 'Cat', sounds: [{sfx: 'jump', name: '跳'}]}]
        };
        const result = await generate({client: fakeClient([JSON.stringify(program)]), vm, catalog, request: '加背景音樂'});
        expect(result.warnings.join(' ')).not.toContain('bgm');
        await applyGenerated({vm, catalog, result, record: false});
        expect(stage.getSounds().map(s => s.name)).toEqual(['coin', 'bgm']);
        expect(vm.runtime.getSpriteTargetByName('Cat').getSounds()
            .map(s => s.name)).toEqual(['跳']);
    });
});
