/**
 * AI audio services: Google Lyria (music, via the Gemini API), ElevenLabs (sound effects and
 * music) and the class gateway (the teacher's server calls them with its own keys).
 *
 * Every function returns {format: 'pcm16', rate, data: ArrayBuffer} or
 * {format: 'encoded', mimeType, data: ArrayBuffer}; decode.js turns either into samples.
 */
import {fetchJson} from '../providers/http.js';
import {AIError, ErrorKind, classifyHttpError} from '../providers/errors.js';
import {gatewayRequest} from '../providers/gateway.js';
import {fromBase64} from '../backend/base64.js';

export const AUDIO_PROVIDERS = {
    synth: {label: '內建合成（免費、離線）', sfx: true, music: true, ai: false},
    lyria: {label: 'Google Lyria（AI 音樂，用 Gemini KEY）', sfx: false, music: true, ai: true},
    elevenlabs: {label: 'ElevenLabs（AI 音效＋音樂）', sfx: true, music: true, ai: true},
    gateway: {label: '班級閘道（老師提供）', sfx: true, music: true, ai: true}
};

export const LYRIA_MODEL = 'lyria-3-clip-preview';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';
const ELEVENLABS_URL = 'https://api.elevenlabs.io';

// Style words that work well as prompts for music models.
export const STYLE_PROMPTS = {
    happy: 'cheerful, playful children\'s game music, bouncy rhythm, major key, xylophone, ukulele and claps',
    adventure: 'heroic adventure game music, driving drums, strings and brass, sense of exploration',
    chiptune: 'retro 8-bit chiptune video game music, square-wave lead, arpeggios, fast tempo',
    calm: 'calm, relaxing background music, soft piano and warm pads, gentle and slow',
    tense: 'tense, suspenseful game music, pulsing bass, ticking percussion, rising strings',
    mystery: 'mysterious, curious puzzle game music, plucked strings, celesta, light and sneaky',
    space: 'dreamy space ambient music, shimmering synth pads, slow arpeggios, wide and floating',
    victory: 'triumphant victory fanfare music, brass, timpani, celebratory and bright',
    spooky: 'spooky but child-friendly Halloween music, harpsichord, pizzicato, playful creepiness'
};

/**
 * Prompt for loop music from a style and optional description.
 * @param {string} style style id
 * @param {string} [description] extra description
 * @returns {string} prompt
 */
export const musicPrompt = (style, description = '') => [
    STYLE_PROMPTS[style] || STYLE_PROMPTS.happy,
    description ? `Scene: ${description}` : '',
    'instrumental only, no vocals, steady tempo, suitable as a seamless background loop for a children\'s game'
].filter(Boolean).join('. ');

// Binary POST with AIError handling (ElevenLabs answers with raw audio).
const fetchBinary = async (url, {headers, body, signal, fetchImpl = fetch, provider}) => {
    let response;
    try {
        response = await fetchImpl(url, {method: 'POST', headers, body: JSON.stringify(body), signal});
    } catch (e) {
        if (signal && signal.aborted) throw new AIError(ErrorKind.ABORTED, 'Cancelled', {provider});
        throw new AIError(ErrorKind.NETWORK, `Network error: ${e.message}`, {provider});
    }
    if (!response.ok) {
        let message = '';
        try {
            const json = await response.json();
            const detail = json.detail || json.error || json;
            message = typeof detail === 'string' ? detail : (detail.message || JSON.stringify(detail));
        } catch (e) {
            message = response.statusText;
        }
        throw classifyHttpError(response.status, message || `HTTP ${response.status}`, {
            headers: response.headers,
            hint: /quota|credits|insufficient/i.test(message) ? ErrorKind.QUOTA : null,
            provider
        });
    }
    return response.arrayBuffer();
};

/**
 * Google Lyria 3 Clip: a 30-second instrumental clip (MP3).
 * @param {object} options {apiKey, prompt, model, signal, fetchImpl}
 * @returns {Promise<object>} encoded audio
 */
export const lyriaMusic = async ({apiKey, prompt, model = LYRIA_MODEL, signal, fetchImpl}) => {
    const body = await fetchJson(`${GEMINI_URL}/models/${model}:generateContent`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey},
        body: JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}]}),
        provider: 'lyria',
        model,
        signal,
        fetchImpl,
        timeout: 3 * 60 * 1000
    });
    const parts = (body.candidates && body.candidates[0] && body.candidates[0].content &&
        body.candidates[0].content.parts) || [];
    const audio = parts.find(p => (p.inlineData || p.inline_data));
    if (!audio) {
        const text = parts.map(p => p.text).filter(Boolean)
            .join(' ');
        throw new AIError(ErrorKind.BAD_REQUEST, text || 'Lyria 沒有回傳音樂（可能是描述被安全規則擋下）', {provider: 'lyria'});
    }
    const inline = audio.inlineData || audio.inline_data;
    return {format: 'encoded', mimeType: inline.mimeType || inline.mime_type || 'audio/mpeg', data: fromBase64(inline.data)};
};

/**
 * ElevenLabs sound effect (raw 22 kHz PCM, no decoding needed).
 * @param {object} options {apiKey, prompt, durationSeconds, loop, signal, fetchImpl}
 * @returns {Promise<object>} pcm audio
 */
export const elevenLabsSfx = async ({apiKey, prompt, durationSeconds, loop = false, signal, fetchImpl}) => {
    const data = await fetchBinary(`${ELEVENLABS_URL}/v1/sound-generation?output_format=pcm_22050`, {
        headers: {'Content-Type': 'application/json', 'xi-api-key': apiKey},
        body: {
            text: prompt,
            ...(durationSeconds ? {duration_seconds: Math.min(Math.max(durationSeconds, 0.5), 30)} : {}),
            loop,
            prompt_influence: 0.5,
            model_id: 'eleven_text_to_sound_v2'
        },
        signal,
        fetchImpl,
        provider: 'elevenlabs'
    });
    return {format: 'pcm16', rate: 22050, data};
};

/**
 * ElevenLabs music (MP3).
 * @param {object} options {apiKey, prompt, seconds, signal, fetchImpl}
 * @returns {Promise<object>} encoded audio
 */
export const elevenLabsMusic = async ({apiKey, prompt, seconds = 30, signal, fetchImpl}) => {
    const data = await fetchBinary(`${ELEVENLABS_URL}/v1/music?output_format=mp3_44100_128`, {
        headers: {'Content-Type': 'application/json', 'xi-api-key': apiKey},
        body: {
            prompt,
            music_length_ms: Math.round(Math.min(Math.max(seconds, 3), 60) * 1000),
            force_instrumental: true
        },
        signal,
        fetchImpl,
        provider: 'elevenlabs'
    });
    return {format: 'encoded', mimeType: 'audio/mpeg', data};
};

/**
 * Through the class gateway (keys stay on the teacher's server).
 * @param {object} options {baseUrl, token, kind, prompt, durationSeconds, loop, engine, signal, fetchImpl}
 * @returns {Promise<object>} audio
 */
export const gatewayAudio = async ({
    baseUrl, token, kind, prompt, durationSeconds, loop, engine, signal, fetchImpl
}) => {
    const body = await gatewayRequest({
        baseUrl,
        token,
        path: '/v1/audio',
        method: 'POST',
        body: {kind, prompt, durationSeconds, loop, engine},
        signal,
        fetchImpl,
        timeout: 3 * 60 * 1000
    });
    const data = fromBase64(body.data);
    return body.format === 'pcm16' ?
        {format: 'pcm16', rate: body.rate || 22050, data} :
        {format: 'encoded', mimeType: body.mimeType || 'audio/mpeg', data};
};

/**
 * Generate audio with the configured service.
 * @param {object} options {settings (AI settings), kind: 'sfx' | 'music', prompt, durationSeconds, loop, signal}
 * @returns {Promise<object>} audio
 */
export const generateAudio = ({settings, kind, prompt, durationSeconds, loop, signal, fetchImpl}) => {
    const audio = settings.audio || {};
    const provider = audio.provider || 'synth';
    if (provider === 'lyria') {
        if (kind !== 'music') throw new AIError(ErrorKind.BAD_REQUEST, 'Google Lyria 只能產生音樂，音效請改用 ElevenLabs 或內建合成。');
        const apiKey = audio.geminiKey || (settings.providers.gemini && settings.providers.gemini.apiKey);
        if (!apiKey) throw new AIError(ErrorKind.AUTH, '請先到「設定」填入 Gemini KEY。');
        return lyriaMusic({apiKey, prompt, signal, fetchImpl});
    }
    if (provider === 'elevenlabs') {
        if (!audio.elevenlabsKey) throw new AIError(ErrorKind.AUTH, '請先到「設定」填入 ElevenLabs KEY。');
        return kind === 'music' ?
            elevenLabsMusic({apiKey: audio.elevenlabsKey, prompt, seconds: 30, signal, fetchImpl}) :
            elevenLabsSfx({apiKey: audio.elevenlabsKey, prompt, durationSeconds, loop, signal, fetchImpl});
    }
    if (provider === 'gateway') {
        const gateway = settings.providers.gateway || {};
        if (!gateway.baseUrl || !gateway.apiKey) throw new AIError(ErrorKind.AUTH, '請先到「設定」設定班級閘道。');
        return gatewayAudio({
            baseUrl: gateway.baseUrl, token: gateway.apiKey, kind, prompt, durationSeconds, loop, signal, fetchImpl
        });
    }
    throw new AIError(ErrorKind.BAD_REQUEST, '內建合成不需要呼叫 AI 服務');
};

/**
 * What the configured audio service can do right now.
 * @param {object} settings AI settings
 * @returns {object} {provider, sfx, music, ready, reason}
 */
export const audioCapabilities = settings => {
    const audio = settings.audio || {};
    const provider = AUDIO_PROVIDERS[audio.provider] ? audio.provider : 'synth';
    const info = AUDIO_PROVIDERS[provider];
    let reason = '';
    if (provider === 'lyria' && !(audio.geminiKey || (settings.providers.gemini && settings.providers.gemini.apiKey))) {
        reason = '要先到「設定 → AI 音效／音樂」填入 Gemini KEY';
    } else if (provider === 'elevenlabs' && !audio.elevenlabsKey) {
        reason = '要先到「設定 → AI 音效／音樂」填入 ElevenLabs KEY';
    } else if (provider === 'gateway' && !(settings.providers.gateway && settings.providers.gateway.apiKey)) {
        reason = '要先到「設定」設定班級閘道';
    }
    return {provider, sfx: info.sfx, music: info.music, ai: info.ai, ready: info.ai && !reason, reason};
};
