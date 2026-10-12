import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {applyGenerated, generate, summarizeProgram} from '../../../src/ai/generate.js';
import {restoreSnapshot} from '../../../src/ai/apply/apply.js';
import {makeVM} from '../../helpers/ai-vm.js';

const fakeClient = replies => {
    const calls = [];
    return {
        calls,
        async complete (request) {
            calls.push(JSON.parse(JSON.stringify(request)));
            const text = replies.shift();
            return {text, usage: {inputTokens: 10, outputTokens: 5}, model: 'fake', provider: 'fake'};
        }
    };
};

const GOOD = JSON.stringify({
    type: 'program',
    explanation: '按下綠旗後貓咪會一直轉圈。',
    sprites: [{name: 'Cat', scripts: [[
        {opcode: 'event_whenflagclicked'},
        {opcode: 'control_forever', substacks: {SUBSTACK: [{opcode: 'motion_turnright', inputs: {DEGREES: 5}}]}}
    ]]}]
});

describe('generate', () => {
    test('repairs a broken answer using compile errors', async () => {
        const vm = await makeVM();
        const bad = JSON.stringify({type: 'program', sprites: [{name: 'Cat', scripts: [[{opcode: 'motion_spin'}]]}]});
        const client = fakeClient([`Sure!\n\`\`\`json\n${bad}\n\`\`\``, GOOD]);
        const result = await generate({client, vm, catalog, request: '讓貓咪轉圈'});
        expect(result.type).toBe('program');
        expect(client.calls).toHaveLength(2);
        const repair = client.calls[1].messages[client.calls[1].messages.length - 1].content;
        expect(repair).toContain('motion_spin');
        expect(client.calls[0].system).toContain('motion_turnright');
        expect(client.calls[0].messages[0].content).toContain('## 角色 "Cat"');
        expect(summarizeProgram(result)).toMatchObject({scripts: 1, newSprites: [], changedSprites: ['Cat']});

        const applied = await applyGenerated({vm, catalog, result});
        expect(applied.summary.scriptsAdded).toBe(1);
        const cat = vm.runtime.getSpriteTargetByName('Cat');
        expect(Object.values(cat.blocks._blocks).some(b => b.opcode === 'control_forever')).toBe(true);

        await restoreSnapshot(vm, applied.snapshot);
        const restored = vm.runtime.getSpriteTargetByName('Cat');
        expect(Object.values(restored.blocks._blocks).some(b => b.opcode === 'control_forever')).toBe(false);
    });

    test('returns clarifying questions', async () => {
        const vm = await makeVM();
        const client = fakeClient([JSON.stringify({type: 'question', question: '要用鍵盤還是滑鼠控制？', options: ['鍵盤', '滑鼠']})]);
        const result = await generate({client, vm, catalog, request: '做一個遊戲'});
        expect(result).toMatchObject({type: 'question', options: ['鍵盤', '滑鼠']});
        expect(result.history).toHaveLength(2);
    });

    test('gives up after repeated errors', async () => {
        const vm = await makeVM();
        const client = fakeClient(['not json', 'still not json', '{"sprites": [{"name": "Cat", "scripts": [[{"opcode": "nope"}]]}]}']);
        await expect(generate({client, vm, catalog, request: 'x'})).rejects.toThrow(/修正 2 次/);
    });
});
