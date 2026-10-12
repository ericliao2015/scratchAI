import {createAIClient} from '../../../src/ai/providers/runner.js';
import {buildChain, getTier, groupModels} from '../../../src/ai/providers/tiers.js';
import {AIError, ErrorKind, classifyHttpError} from '../../../src/ai/providers/errors.js';
import {defaultSettings} from '../../../src/ai/settings.js';
import {extractJson} from '../../../src/ai/json.js';

const settingsWith = patch => {
    const s = defaultSettings();
    s.providers.anthropic = {apiKey: 'k', model: 'claude-opus-5-5', models: []};
    return Object.assign(s, patch);
};

const fakeProvider = behaviour => ({
    calls: [],
    async complete ({model}) {
        this.calls.push(model);
        const result = behaviour(model, this.calls.length);
        if (result instanceof Error) throw result;
        return {text: result, usage: {inputTokens: 1, outputTokens: 1}};
    }
});

describe('tiers', () => {
    test('classifies models', () => {
        expect(getTier('anthropic', 'claude-opus-5-5')).toBe('high');
        expect(getTier('anthropic', 'claude-haiku-5-5')).toBe('low');
        expect(getTier('anthropic', 'something-else')).toBe(null);
    });

    test('high-first chain goes down one model per tier', () => {
        const chain = buildChain(settingsWith({}));
        expect(chain.map(e => e.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    });

    test('chain respects the available model list', () => {
        const s = settingsWith({});
        s.providers.anthropic.models = ['claude-opus-5-5', 'claude-haiku-5-5'];
        expect(buildChain(s).map(e => e.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    });

    test('fixed strategy uses only the selected model', () => {
        const s = settingsWith({strategy: 'fixed'});
        s.providers.openai = {apiKey: 'x', model: 'gpt-5', models: []};
        expect(buildChain(s)).toEqual([{provider: 'anthropic', model: 'claude-opus-5-5'}]);
    });

    test('economy strategy starts cheap', () => {
        const chain = buildChain(settingsWith({strategy: 'economy'}));
        expect(chain.map(e => e.model)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
    });

    test('other configured providers follow as backup', () => {
        const s = settingsWith({});
        s.providers.gemini = {apiKey: 'g', model: 'gemini-2.5-flash', models: []};
        const chain = buildChain(s);
        expect(chain.slice(-2)).toEqual([
            {provider: 'gemini', model: 'gemini-2.5-flash'},
            {provider: 'gemini', model: 'gemini-2.5-flash-lite'}
        ]);
    });

    test('groups available models with unranked ones last', () => {
        const groups = groupModels('anthropic', ['claude-opus-5-5', 'custom-model']);
        expect(groups).toEqual([
            {tier: 'high', models: ['claude-opus-5-5']},
            {tier: null, models: ['custom-model']}
        ]);
    });
});

describe('error classification', () => {
    test('quota vs rate limit', () => {
        expect(classifyHttpError(429, 'Rate limit reached for requests per minute').kind).toBe(ErrorKind.RATE_LIMIT);
        expect(classifyHttpError(429, 'You exceeded your current quota').kind).toBe(ErrorKind.QUOTA);
        expect(classifyHttpError(402, 'payment required').kind).toBe(ErrorKind.QUOTA);
        expect(classifyHttpError(401, 'bad key').kind).toBe(ErrorKind.AUTH);
        expect(classifyHttpError(400, 'Your credit balance is too low').kind).toBe(ErrorKind.QUOTA);
        expect(classifyHttpError(503, 'overloaded').kind).toBe(ErrorKind.OVERLOADED);
    });
});

describe('runner', () => {
    test('downgrades on quota and stays downgraded', async () => {
        const anthropic = fakeProvider(model => (model === 'claude-opus-5-5' ?
            new AIError(ErrorKind.QUOTA, 'no credit') : `ok:${model}`));
        const events = [];
        const client = createAIClient({
            getSettings: () => settingsWith({}),
            providers: {anthropic},
            onEvent: e => events.push(e.type)
        });
        const first = await client.complete({messages: []});
        expect(first.model).toBe('claude-sonnet-5-5');
        expect(first.downgraded).toBe(true);
        expect(events).toContain('fallback');
        await client.complete({messages: []});
        expect(anthropic.calls).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5-5']);
    });

    test('retries rate limits without downgrading', async () => {
        const anthropic = fakeProvider((model, n) => (n === 1 ? new AIError(ErrorKind.RATE_LIMIT, 'slow down') : 'ok'));
        const client = createAIClient({
            getSettings: () => settingsWith({}),
            providers: {anthropic},
            sleep: () => Promise.resolve()
        });
        const result = await client.complete({messages: []});
        expect(result.model).toBe('claude-opus-5-5');
        expect(anthropic.calls).toHaveLength(2);
    });

    test('stops on invalid key', async () => {
        const anthropic = fakeProvider(() => new AIError(ErrorKind.AUTH, 'bad key'));
        const client = createAIClient({getSettings: () => settingsWith({}), providers: {anthropic}});
        await expect(client.complete({messages: []})).rejects.toMatchObject({kind: ErrorKind.AUTH});
        expect(anthropic.calls).toHaveLength(1);
    });

    test('invalid key on primary falls back to another provider', async () => {
        const s = settingsWith({});
        s.providers.gemini = {apiKey: 'g', model: 'gemini-2.5-flash', models: []};
        const anthropic = fakeProvider(() => new AIError(ErrorKind.AUTH, 'bad key'));
        const gemini = fakeProvider(() => 'ok');
        const client = createAIClient({getSettings: () => s, providers: {anthropic, gemini}});
        const result = await client.complete({messages: []});
        expect(result.provider).toBe('gemini');
    });

    test('onBeforeFallback can pause', async () => {
        const anthropic = fakeProvider(() => new AIError(ErrorKind.QUOTA, 'no credit'));
        const client = createAIClient({getSettings: () => settingsWith({}), providers: {anthropic}});
        await expect(client.complete({messages: []}, {onBeforeFallback: () => false}))
            .rejects.toMatchObject({kind: ErrorKind.ABORTED});
    });

    test('throws helpful error when nothing is configured', async () => {
        const client = createAIClient({getSettings: () => defaultSettings(), providers: {}});
        await expect(client.complete({messages: []})).rejects.toMatchObject({kind: ErrorKind.AUTH});
    });
});

describe('extractJson', () => {
    test('handles fences and surrounding text', () => {
        expect(extractJson('{"a":1}')).toEqual({a: 1});
        expect(extractJson('Here:\n```json\n{"a":2}\n```')).toEqual({a: 2});
        expect(extractJson('Sure! {"a":3} hope it helps')).toEqual({a: 3});
        expect(() => extractJson('no json')).toThrow(SyntaxError);
    });
});
