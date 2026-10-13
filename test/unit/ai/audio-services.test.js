/**
 * @jest-environment node
 */
import {RATE} from '../../../src/ai/audio/synth.js';
import {
    decodeAudio, fadeEdges, makeLoop, pcm16ToFloat, prepareAudio, resample, toMono, trimSilence
} from '../../../src/ai/audio/process.js';
import {
    audioCapabilities, elevenLabsMusic, elevenLabsSfx, generateAudio, lyriaMusic, musicPrompt
} from '../../../src/ai/audio/services.js';
import {defaultSettings} from '../../../src/ai/settings.js';
import {createGateway} from '../../../server/core/gateway.js';
import {memoryStore} from '../../../server/core/stores.js';

const sine = (seconds, rate, freq = 440) => Float32Array.from({length: Math.round(seconds * rate)},
    (_, i) => Math.sin(2 * Math.PI * freq * i / rate) * 0.5);

const pcm = samples => {
    const buffer = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buffer);
    samples.forEach((s, i) => view.setInt16(i * 2, Math.round(s * 32767), true));
    return buffer;
};

// Records requests and answers like the real services.
const fakeFetch = handler => {
    const calls = [];
    const impl = async (url, init) => {
        const call = {url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null};
        calls.push(call);
        const {status = 200, json, binary} = handler(call);
        return new Response(binary || JSON.stringify(json), {
            status,
            headers: {'Content-Type': binary ? 'application/octet-stream' : 'application/json'}
        });
    };
    impl.calls = calls;
    return impl;
};

describe('audio post-processing', () => {
    test('mono, resampling, trimming and fades', () => {
        expect(Array.from(toMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
        expect(resample(sine(1, 44100), 44100).length).toBe(RATE);
        const padded = new Float32Array(RATE);
        padded.set(sine(0.2, RATE), RATE / 2);
        const trimmed = trimSilence(padded);
        expect(trimmed.length).toBeLessThan(0.3 * RATE);
        const faded = fadeEdges(Float32Array.from({length: 1000}, () => 1));
        expect(faded[0]).toBe(0);
        expect(faded[500]).toBe(1);
        pcm16ToFloat(pcm([0, 0.5, -0.5])).forEach((v, i) => expect(v).toBeCloseTo([0, 0.5, -0.5][i], 3));
    });

    test('loops are cross-faded: the end flows into the start without a jump', () => {
        const ramp = Float32Array.from({length: RATE * 4}, (_, i) => i / (RATE * 4));
        const loop = makeLoop(ramp, {crossfade: 1});
        expect(loop.length).toBe(RATE * 3);
        // the first sample continues where the cut-off tail started
        expect(Math.abs(loop[0] - ramp[RATE * 3])).toBeLessThan(0.01);
        expect(Math.abs(loop[loop.length - 1] - loop[0])).toBeLessThan(0.01);
    });

    test('prepareAudio limits music to 30 s at 22 kHz', async () => {
        const decoded = {channels: [sine(40, 44100), sine(40, 44100, 220)], sampleRate: 44100};
        const music = prepareAudio(decoded, {kind: 'music'});
        expect(music.length).toBeLessThanOrEqual(30 * RATE);
        expect(music.length).toBeGreaterThan(27 * RATE);
        const raw = await decodeAudio({format: 'pcm16', rate: 22050, data: pcm(sine(1, 22050))});
        expect(raw.sampleRate).toBe(22050);
        const decoder = jest.fn(async () => decoded);
        await decodeAudio({format: 'encoded', data: new ArrayBuffer(4)}, {decoder});
        expect(decoder).toHaveBeenCalled();
    });
});

describe('audio services', () => {
    test('Lyria uses the Gemini API and returns the MP3 clip', async () => {
        const fetchImpl = fakeFetch(() => ({json: {candidates: [{content: {parts: [
            {text: 'Here is your clip'}, {inlineData: {mimeType: 'audio/mpeg', data: btoa('ID3fake')}}
        ]}}]}}));
        const result = await lyriaMusic({apiKey: 'g-key', prompt: musicPrompt('space', '外星人'), fetchImpl});
        expect(fetchImpl.calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/lyria-3-clip-preview:generateContent');
        expect(fetchImpl.calls[0].headers['x-goog-api-key']).toBe('g-key');
        expect(fetchImpl.calls[0].body.contents[0].parts[0].text).toContain('dreamy space');
        expect(fetchImpl.calls[0].body.contents[0].parts[0].text).toContain('no vocals');
        expect(result.format).toBe('encoded');
        expect(new TextDecoder().decode(result.data)).toBe('ID3fake');

        const blocked = fakeFetch(() => ({json: {candidates: [{content: {parts: [{text: 'cannot'}]}}]}}));
        await expect(lyriaMusic({apiKey: 'k', prompt: 'x', fetchImpl: blocked})).rejects.toThrow('cannot');
    });

    test('ElevenLabs sound effects (PCM) and music (MP3)', async () => {
        const fetchImpl = fakeFetch(call => ({binary: call.url.includes('sound-generation') ? pcm(sine(0.5, 22050)) : new ArrayBuffer(8)}));
        const sfx = await elevenLabsSfx({apiKey: 'el', prompt: 'ice spell', durationSeconds: 2, loop: true, fetchImpl});
        expect(fetchImpl.calls[0].url).toBe('https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_22050');
        expect(fetchImpl.calls[0].headers['xi-api-key']).toBe('el');
        expect(fetchImpl.calls[0].body).toMatchObject({text: 'ice spell', duration_seconds: 2, loop: true, model_id: 'eleven_text_to_sound_v2'});
        expect(sfx).toMatchObject({format: 'pcm16', rate: 22050});
        await elevenLabsMusic({apiKey: 'el', prompt: 'calm', fetchImpl});
        expect(fetchImpl.calls[1].url).toBe('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128');
        expect(fetchImpl.calls[1].body).toMatchObject({music_length_ms: 30000, force_instrumental: true});

        const broke = fakeFetch(() => ({status: 401, json: {detail: {message: 'quota exceeded for this key'}}}));
        await expect(elevenLabsSfx({apiKey: 'x', prompt: 'p', fetchImpl: broke})).rejects.toMatchObject({kind: 'quota'});
    });

    test('settings choose the service; capabilities explain what is missing', async () => {
        const settings = defaultSettings();
        expect(audioCapabilities(settings)).toMatchObject({provider: 'synth', ready: false, ai: false});
        settings.audio.provider = 'lyria';
        expect(audioCapabilities(settings)).toMatchObject({ready: false, sfx: false});
        expect(audioCapabilities(settings).reason).toContain('Gemini KEY');
        settings.providers.gemini.apiKey = 'shared';
        expect(audioCapabilities(settings)).toMatchObject({ready: true, music: true});
        const fetchImpl = fakeFetch(() => ({json: {candidates: [{content: {parts: [{inlineData: {mimeType: 'audio/mpeg', data: 'AAAA'}}]}}]}}));
        await generateAudio({settings, kind: 'music', prompt: 'p', fetchImpl});
        expect(fetchImpl.calls[0].headers['x-goog-api-key']).toBe('shared');
        expect(() => generateAudio({settings, kind: 'sfx', prompt: 'p'})).toThrow('只能產生音樂');
        settings.audio.provider = 'elevenlabs';
        expect(audioCapabilities(settings).reason).toContain('ElevenLabs KEY');
    });

    test('the class gateway generates audio with its keys and a daily limit', async () => {
        const upstream = fakeFetch(call => (call.url.includes('elevenlabs') ?
            {binary: pcm(sine(0.3, 22050))} :
            {json: {candidates: [{content: {parts: [{inlineData: {mimeType: 'audio/mpeg', data: 'SUQz'}}]}}]}}));
        const gateway = createGateway({
            store: memoryStore(),
            env: {ADMIN_TOKEN: 'a', ANTHROPIC_KEY: 'x', GEMINI_KEY: 'g', ELEVENLABS_KEY: 'e'},
            fetchImpl: upstream
        });
        const call = (path, body, token) => gateway.handle(new Request(`http://gw${path}`, {
            method: 'POST', headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: JSON.stringify(body)
        })).then(async r => ({status: r.status, body: await r.json()}));
        const klass = (await call('/v1/admin/classes', {name: 'c', models: ['anthropic/x'], limits: {audioPerDay: 2}}, 'a')).body;
        const token = `${klass.code}.01`;

        const settings = defaultSettings();
        settings.audio.provider = 'gateway';
        settings.providers.gateway = {...settings.providers.gateway, baseUrl: 'http://gw', apiKey: token};
        const gwFetch = (url, init) => gateway.handle(new Request(url, init));
        const music = await generateAudio({settings, kind: 'music', prompt: 'calm', fetchImpl: gwFetch});
        expect(music.format).toBe('encoded');
        expect(upstream.calls[0].url).toContain('lyria-3-clip-preview');
        const sfx = await generateAudio({settings, kind: 'sfx', prompt: 'boom', loop: false, fetchImpl: gwFetch});
        expect(sfx).toMatchObject({format: 'pcm16', rate: 22050});
        expect(upstream.calls[1].headers['xi-api-key']).toBe('e');
        await expect(generateAudio({settings, kind: 'sfx', prompt: 'again', fetchImpl: gwFetch}))
            .rejects.toMatchObject({kind: 'quota'});
    });
});
