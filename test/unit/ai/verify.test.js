import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {generate} from '../../../src/ai/generate.js';
import {normalizeTest, verifyProgram} from '../../../src/ai/run/verify.js';
import {makeVM} from '../../helpers/ai-vm.js';

const fakeClient = replies => {
    const calls = [];
    return {
        calls,
        async complete (request) {
            calls.push(JSON.parse(JSON.stringify(request)));
            return {text: replies.shift(), usage: {inputTokens: 10, outputTokens: 5}, model: 'fake', provider: 'fake'};
        }
    };
};

const program = (steps, test) => JSON.stringify({
    type: 'program',
    explanation: '按右鍵往右走',
    stage: {variables: [{name: 'moves', value: 0}]},
    sprites: [{name: 'Cat', scripts: [
        [{opcode: 'event_whenflagclicked'}, {opcode: 'motion_gotoxy', inputs: {X: 0, Y: 0}}],
        [{opcode: 'event_whenkeypressed', fields: {KEY_OPTION: 'right arrow'}},
            {opcode: 'motion_changexby', inputs: {DX: steps}},
            {opcode: 'data_changevariableby', fields: {VARIABLE: 'moves'}, inputs: {VALUE: 1}}]
    ]}],
    test
});

const TEST = {
    duration: 2,
    actions: [{at: 0, do: 'greenFlag'}, {at: 0.5, do: 'keyPress', key: 'right arrow'}],
    expect: [{sprite: 'Cat', prop: 'x', op: 'increased'}, {var: 'moves', op: '=', value: 1}]
};

describe('self-verification', () => {
    test('normalizeTest drops unknown actions and empty tests', () => {
        expect(normalizeTest(null)).toBe(null);
        expect(normalizeTest({expect: []})).toBe(null);
        const test = normalizeTest({duration: 99, actions: [{do: 'explode'}], expect: [{said: 'hi'}]});
        expect(test.duration).toBe(10);
        expect(test.actions).toEqual([{at: 0, do: 'greenFlag'}]);
    });

    test('a failing test is sent back once and the repaired program passes', async () => {
        const vm = await makeVM();
        const client = fakeClient([program(-10, TEST), program(10, TEST)]);
        const verify = result => verifyProgram({vm, catalog, result, withRenderer: false});
        const result = await generate({client, vm, catalog, request: '按右鍵往右走', verify});
        expect(client.calls).toHaveLength(2);
        expect(client.calls[0].system).toContain('# Self-test');
        const feedback = client.calls[1].messages[client.calls[1].messages.length - 1].content;
        expect(feedback).toContain('FAIL');
        expect(feedback).toContain('Sprite "Cat"');
        expect(result.verification).toMatchObject({pass: true, passed: 2, total: 2, repaired: true});
        // the student's project is untouched
        const cat = vm.runtime.getSpriteTargetByName('Cat');
        expect(Object.keys(cat.blocks._blocks)).toHaveLength(0);
        expect(vm.runtime.getTargetForStage().lookupVariableByNameAndType('moves', '')).toBeFalsy();
    });

    test('programs without a test are not run', async () => {
        const vm = await makeVM();
        const client = fakeClient([program(10)]);
        const verify = jest.fn(result => verifyProgram({vm, catalog, result, withRenderer: false}));
        const result = await generate({client, vm, catalog, request: 'x', verify});
        expect(verify).toHaveBeenCalledTimes(1);
        expect(result.verification).toBe(null);
    });

    test('ops on existing blocks are applied to the copy', async () => {
        const vm = await makeVM();
        const client = fakeClient([program(10, TEST)]);
        const first = await generate({client, vm, catalog, request: 'x'});
        const {applyGenerated} = require('../../../src/ai/generate.js');
        await applyGenerated({vm, catalog, result: first});
        const cat = vm.runtime.getSpriteTargetByName('Cat');
        const change = Object.values(cat.blocks._blocks).find(b => b.opcode === 'motion_changexby');
        // Make the existing script walk left; the AI fixes it with a setInput op.
        const second = fakeClient([JSON.stringify({
            type: 'program',
            ops: [{op: 'setInput', sprite: 'Cat', block: {opcode: 'motion_changexby'}, input: 'DX', value: 25}],
            test: {duration: 1, actions: [{at: 0, do: 'greenFlag'}, {at: 0.2, do: 'keyPress', key: 'right arrow'}],
                expect: [{sprite: 'Cat', prop: 'x', op: '=', value: 25}]}
        })]);
        const verify = result => verifyProgram({vm, catalog, result, withRenderer: false});
        const result = await generate({client: second, vm, catalog, request: '一次走 25 步', verify});
        expect(result.verification).toMatchObject({pass: true});
        expect(change).toBeTruthy();
    });
});

describe('tutor debug run', () => {
    test('"why doesn\'t it work" runs the project and sends the report', async () => {
        const {askTutor} = require('../../../src/ai/tutor.js');
        const vm = await makeVM();
        const client = fakeClient([program(10, TEST)]);
        const result = await generate({client, vm, catalog, request: 'x'});
        const {applyGenerated} = require('../../../src/ai/generate.js');
        await applyGenerated({vm, catalog, result});
        const flag = Object.values(vm.runtime.getSpriteTargetByName('Cat').blocks._blocks)
            .find(b => b.opcode === 'event_whenflagclicked');
        const tutor = fakeClient([JSON.stringify({message: '你的程式只有在按右鍵時才會動喔', missing: [], concepts: []})]);
        const answer = await askTutor({client: tutor, vm, catalog, task: 'debug', blockId: flag.id, withRenderer: false});
        expect(answer.runReport).toContain('Sprite "Cat"');
        expect(answer.runReport).toContain('never moved');
        expect(tutor.calls[0].messages[0].content).toContain('# What happened when the project ran');
    });
});

describe('test items in grading', () => {
    test('points in proportion to passed expectations', async () => {
        const {gradeProject} = require('../../../src/ai/grade/grade.js');
        const {modelFromVM} = require('../../../src/ai/project/model.js');
        const {projectDataWithIds, runTest} = require('../../../src/ai/run/verify.js');
        const vm = await makeVM();
        const {applyGenerated} = require('../../../src/ai/generate.js');
        const result = await generate({client: fakeClient([program(10, TEST)]), vm, catalog, request: 'x'});
        await applyGenerated({vm, catalog, result});
        const template = {
            title: 't',
            items: [
                {id: 't1', type: 'test', desc: '按右鍵往右走', points: 20, test: {
                    duration: 1.5,
                    actions: [{at: 0, do: 'greenFlag'}, {at: 0.5, do: 'keyPress', key: 'right arrow'}],
                    expect: [{sprite: 'Cat', prop: 'x', op: '=', value: 10}, {var: 'moves', op: '=', value: 5}]
                }},
                {id: 'r1', type: 'rule', desc: '綠旗', points: 10, check: {usesOpcode: 'event_whenflagclicked'}}
            ]
        };
        const graded = await gradeProject({
            model: modelFromVM(vm),
            template,
            client: null,
            runTest: async test => runTest({data: await projectDataWithIds(vm), storage: vm.runtime.storage, test,
                withRenderer: false})
        });
        const item = graded.items.find(i => i.id === 't1');
        expect(item).toMatchObject({pass: false, score: 10});
        expect(item.reason).toContain('moves');
        expect(item.run.report).toContain('Variable "moves"');
        expect(graded.total).toBe(20);
        const withoutRunner = await gradeProject({model: modelFromVM(vm), template, client: null});
        expect(withoutRunner.items[0]).toMatchObject({pass: false, score: 0});
    });
});
