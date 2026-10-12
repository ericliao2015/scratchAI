import {PROVIDERS} from '../../../src/ai/providers/index.js';
import {ErrorKind} from '../../../src/ai/providers/errors.js';

const fakeFetch = (status, body) => {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({url, init, body: init.body ? JSON.parse(init.body) : null});
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: {get: () => null},
            text: async () => JSON.stringify(body)
        };
    };
    fn.calls = calls;
    return fn;
};

const request = {system: 'sys', messages: [{role: 'user', content: 'hi'}], json: true};

describe('anthropic adapter', () => {
    test('sends browser header and reads text blocks', async () => {
        const fetchImpl = fakeFetch(200, {
            content: [{type: 'thinking', thinking: ''}, {type: 'text', text: '{"ok":true}'}],
            stop_reason: 'end_turn',
            usage: {input_tokens: 5, output_tokens: 3}
        });
        const result = await PROVIDERS.anthropic.complete({...request, apiKey: 'k', model: 'claude-opus-5-5', fetchImpl});
        expect(result.text).toBe('{"ok":true}');
        const call = fetchImpl.calls[0];
        expect(call.url).toBe('https://api.anthropic.com/v1/messages');
        expect(call.init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
        expect(call.body.system).toBe('sys');
        expect(call.body).not.toHaveProperty('temperature');
    });

    test('maps billing error to quota', async () => {
        const fetchImpl = fakeFetch(402, {type: 'error', error: {type: 'billing_error', message: 'pay'}});
        await expect(PROVIDERS.anthropic.complete({...request, apiKey: 'k', model: 'm', fetchImpl}))
            .rejects.toMatchObject({kind: ErrorKind.QUOTA});
    });
});

describe('openai adapter', () => {
    test('uses json mode and system message', async () => {
        const fetchImpl = fakeFetch(200, {
            choices: [{message: {content: '{}'}, finish_reason: 'stop'}],
            usage: {prompt_tokens: 1, completion_tokens: 2}
        });
        await PROVIDERS.openai.complete({...request, apiKey: 'k', model: 'gpt-5', fetchImpl});
        const call = fetchImpl.calls[0];
        expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
        expect(call.body.response_format).toEqual({type: 'json_object'});
        expect(call.body.messages[0]).toEqual({role: 'system', content: 'sys'});
    });

    test('insufficient_quota is quota', async () => {
        const fetchImpl = fakeFetch(429, {error: {code: 'insufficient_quota', message: 'quota'}});
        await expect(PROVIDERS.openai.complete({...request, apiKey: 'k', model: 'gpt-5', fetchImpl}))
            .rejects.toMatchObject({kind: ErrorKind.QUOTA});
    });

    test('compatible adapter uses custom base url without key', async () => {
        const fetchImpl = fakeFetch(200, {data: [{id: 'llama3'}]});
        const models = await PROVIDERS.compatible.listModels({baseUrl: 'http://localhost:11434/v1/', fetchImpl});
        expect(models).toEqual(['llama3']);
        expect(fetchImpl.calls[0].url).toBe('http://localhost:11434/v1/models');
        expect(fetchImpl.calls[0].init.headers).not.toHaveProperty('Authorization');
    });
});

describe('gemini adapter', () => {
    test('maps roles and json mime type', async () => {
        const fetchImpl = fakeFetch(200, {
            candidates: [{content: {parts: [{text: '{"a":1}'}]}, finishReason: 'STOP'}]
        });
        const result = await PROVIDERS.gemini.complete({
            ...request,
            messages: [{role: 'user', content: 'a'}, {role: 'assistant', content: 'b'}],
            apiKey: 'k',
            model: 'gemini-2.5-flash',
            fetchImpl
        });
        expect(result.text).toBe('{"a":1}');
        const call = fetchImpl.calls[0];
        expect(call.url).toContain('/models/gemini-2.5-flash:generateContent');
        expect(call.body.contents[1].role).toBe('model');
        expect(call.body.generationConfig.responseMimeType).toBe('application/json');
    });

    test('daily quota vs per-minute limit', async () => {
        const daily = fakeFetch(429, {error: {status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit per day'}});
        await expect(PROVIDERS.gemini.complete({...request, apiKey: 'k', model: 'm', fetchImpl: daily}))
            .rejects.toMatchObject({kind: ErrorKind.QUOTA});
        const minute = fakeFetch(429, {error: {status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded per minute'}});
        await expect(PROVIDERS.gemini.complete({...request, apiKey: 'k', model: 'm', fetchImpl: minute}))
            .rejects.toMatchObject({kind: ErrorKind.RATE_LIMIT});
    });
});
