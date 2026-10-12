/**
 * @jest-environment node
 */
import {createGateway} from '../../../server/core/gateway.js';
import {memoryStore} from '../../../server/core/stores.js';
import {gatewayAdmin, gatewayBackend} from '../../../src/ai/backend/index.js';
import gatewayProvider, {gatewayToken} from '../../../src/ai/providers/gateway.js';
import {createAIClient} from '../../../src/ai/providers/runner.js';
import {defaultSettings} from '../../../src/ai/settings.js';
import {buildChain} from '../../../src/ai/providers/tiers.js';

const upstream = {
    anthropic: {complete: async ({model}) => ({text: `{"from":"${model}"}`, usage: {inputTokens: 5, outputTokens: 1}})}
};

const setup = () => {
    const gateway = createGateway({store: memoryStore(), env: {ADMIN_TOKEN: 'adm', ANTHROPIC_KEY: 'k'}, providers: upstream});
    const fetchImpl = (url, init) => gateway.handle(new Request(url, init));
    return {fetchImpl, base: 'http://gw.test'};
};

describe('backend adapters with the class gateway', () => {
    test('teacher creates a class; a student uses AI, submits and saves projects', async () => {
        const {fetchImpl, base} = setup();
        const admin = gatewayAdmin({baseUrl: base, adminToken: 'adm', fetchImpl});
        const klass = await admin.createClass({name: '六甲', models: ['anthropic/claude-sonnet-5-5']});

        // The runner talks to the gateway like any other provider.
        const settings = defaultSettings();
        settings.active = 'gateway';
        settings.providers.gateway = {
            ...settings.providers.gateway, baseUrl: base, classCode: klass.code, student: '07',
            apiKey: gatewayToken(klass.code, '07'), model: 'default'
        };
        expect(buildChain(settings)).toEqual([{provider: 'gateway', model: 'default'}]);
        expect(await gatewayProvider.listModels({apiKey: settings.providers.gateway.apiKey, baseUrl: base, fetchImpl}))
            .toEqual(['anthropic/claude-sonnet-5-5']);
        const client = createAIClient({getSettings: () => settings, fetchImpl});
        const reply = await client.complete({messages: [{role: 'user', content: 'hi'}], json: true});
        expect(reply).toMatchObject({text: '{"from":"claude-sonnet-5-5"}', provider: 'gateway'});

        const backend = gatewayBackend({baseUrl: base, classCode: klass.code, student: '07', fetchImpl});
        expect(await backend.identity()).toMatchObject({name: '07', className: '六甲'});
        const data = new Uint8Array([80, 75, 3, 4, 1, 2, 3]).buffer;
        await backend.submit({data, fileName: '07.sb3', assignment: '作業一', report: '# 報告', summary: {total: 90}});
        await backend.saveProject('遊戲', data);
        expect((await backend.listProjects()).map(p => p.name)).toEqual(['遊戲']);
        expect(new Uint8Array(await backend.loadProject('遊戲'))).toEqual(new Uint8Array(data));

        const subs = await admin.listSubmissions(klass.code);
        expect(subs[0]).toMatchObject({student: '07', assignment: '作業一'});
        const full = await admin.getSubmission(klass.code, subs[0].id);
        expect(new Uint8Array(full.data)).toEqual(new Uint8Array(data));
        const usage = await admin.usage(klass.code, 1);
        expect(Object.keys(usage.students)).toEqual(['07']);
    });

    test('local models are only used for tutor requests', async () => {
        const settings = defaultSettings();
        settings.active = 'webllm';
        settings.providers.webllm = {...settings.providers.webllm, model: 'Qwen3.5-2B-q4f16_1-MLC'};
        expect(buildChain(settings, {purpose: 'tutor'})).toEqual([]);
        settings.providers.webllm.enabled = true;
        expect(buildChain(settings, {purpose: 'tutor'})).toEqual([{provider: 'webllm', model: 'Qwen3.5-2B-q4f16_1-MLC'}]);
        expect(buildChain(settings)).toEqual([]);
        const calls = [];
        const client = createAIClient({getSettings: () => settings, providers: {
            webllm: {purposes: ['tutor'], complete: async r => {
                calls.push(r);
                return {text: 'hint', usage: {}};
            }}
        }});
        await expect(client.complete({messages: [{role: 'user', content: 'x'}]})).rejects.toThrow('本機模型只能用來解釋與提示');
        const reply = await client.complete({messages: [{role: 'user', content: 'x'}], purpose: 'tutor'});
        expect(reply.text).toBe('hint');
        expect(calls[0].purpose).toBeUndefined();
    });
});
