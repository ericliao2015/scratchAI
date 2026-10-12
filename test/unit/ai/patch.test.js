import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {compileProgram} from '../../../src/ai/ir/compile.js';
import {applyPlan} from '../../../src/ai/apply/apply.js';
import {applyOps} from '../../../src/ai/apply/patch.js';
import {modelFromVM} from '../../../src/ai/project/model.js';
import {projectToText} from '../../../src/ai/project/serialize.js';
import {makeVM} from '../../helpers/ai-vm.js';

const setup = async () => {
    const vm = await makeVM();
    const {plan, errors} = compileProgram({
        stage: {variables: [{name: 'score'}]},
        sprites: [{name: 'Cat', scripts: [
            [
                {opcode: 'event_whenflagclicked'},
                {opcode: 'motion_movesteps', inputs: {STEPS: 10}},
                {opcode: 'motion_turnright', inputs: {DEGREES: 15}},
                {opcode: 'looks_say', inputs: {MESSAGE: 'hi'}}
            ],
            [
                {opcode: 'event_whenkeypressed', fields: {KEY_OPTION: 'space'}},
                {opcode: 'control_repeat', inputs: {TIMES: 3}, substacks: {SUBSTACK: [
                    {opcode: 'motion_changeyby', inputs: {DY: 10}}
                ]}}
            ]
        ]}]
    }, {catalog, model: modelFromVM(vm)});
    expect(errors).toEqual([]);
    await applyPlan(vm, plan);
    return vm;
};

const text = vm => projectToText(modelFromVM(vm), {catalog});
const catText = vm => text(vm).text.split('## 角色 "Cat"')[1];

describe('applyOps', () => {
    test('deleteBlock keeps the blocks after it', async () => {
        const vm = await setup();
        const result = await applyOps(vm, [
            {op: 'deleteBlock', sprite: 'Cat', block: {opcode: 'motion_turnright'}}
        ], {catalog});
        expect(result.errors).toEqual([]);
        const t = catText(vm);
        expect(t).not.toContain('motion_turnright');
        expect(t).toMatch(/motion_movesteps STEPS=10\n\s+#\d+ looks_say MESSAGE="hi"/);
    });

    test('aliases from the project text resolve to blocks', async () => {
        const vm = await setup();
        const {text: before, aliases} = text(vm);
        const alias = aliases[Object.keys(aliases).find(id => vm.runtime.getSpriteTargetByName('Cat')
            .blocks._blocks[id].opcode === 'looks_say')];
        expect(before).toContain(`${alias} looks_say`);
        const {ids} = text(vm);
        const result = await applyOps(vm, [
            {op: 'setInput', sprite: 'Cat', block: alias, input: 'MESSAGE', value: {opcode: 'operator_join', inputs: {STRING1: 'score: ', STRING2: {var: 'score'}}}}
        ], {catalog, aliases: ids});
        expect(result.errors).toEqual([]);
        expect(catText(vm)).toContain('looks_say MESSAGE=(operator_join STRING1="score: " STRING2=(var "score"))');
    });

    test('insertAfter, insertInto and replaceBlock', async () => {
        const vm = await setup();
        const result = await applyOps(vm, [
            {op: 'insertAfter', sprite: 'Cat', block: {opcode: 'motion_movesteps'}, blocks: [{opcode: 'looks_nextcostume'}]},
            {op: 'insertInto', sprite: 'Cat', block: {opcode: 'control_repeat'}, input: 'SUBSTACK', position: 'end', blocks: [{opcode: 'control_wait', inputs: {DURATION: 0.1}}]},
            {op: 'replaceBlock', sprite: 'Cat', block: {opcode: 'motion_turnright'}, with: [{opcode: 'motion_turnleft', inputs: {DEGREES: 90}}]}
        ], {catalog});
        expect(result.errors).toEqual([]);
        const t = catText(vm);
        expect(t).toMatch(/motion_movesteps STEPS=10\n\s+#\d+ looks_nextcostume\n\s+#\d+ motion_turnleft DEGREES=90\n\s+#\d+ looks_say/);
        expect(t).toMatch(/motion_changeyby DY=10\n\s+#\d+ control_wait DURATION=0.1/);
    });

    test('deleteScript by matcher, setField, renameVariable, setProperty', async () => {
        const vm = await setup();
        const result = await applyOps(vm, [
            {op: 'setField', sprite: 'Cat', block: {opcode: 'event_whenkeypressed'}, field: 'KEY_OPTION', value: 'a'},
            {op: 'deleteScript', sprite: 'Cat', block: {opcode: 'motion_movesteps'}},
            {op: 'renameVariable', from: 'score', to: '分數'},
            {op: 'setProperty', sprite: 'Cat', x: 50, size: 80}
        ], {catalog});
        expect(result.errors).toEqual([]);
        const t = catText(vm);
        expect(t).not.toContain('event_whenflagclicked');
        expect(t).toContain('KEY_OPTION="a"');
        const cat = vm.runtime.getSpriteTargetByName('Cat');
        expect(cat.x).toBe(50);
        expect(cat.size).toBe(80);
        expect(text(vm).text).toContain('"分數"=0');
    });

    test('errors are reported per operation and do not stop others', async () => {
        const vm = await setup();
        const result = await applyOps(vm, [
            {op: 'deleteBlock', sprite: 'Dog', block: '#1'},
            {op: 'teleport'},
            {op: 'insertAfter', sprite: 'Cat', block: {opcode: 'motion_movesteps'}, blocks: [{opcode: 'event_whenflagclicked'}]},
            {op: 'setProperty', sprite: 'Cat', y: 20}
        ], {catalog});
        expect(result.applied).toBe(1);
        expect(result.errors.map(e => e.index)).toEqual([0, 1, 2]);
        expect(vm.runtime.getSpriteTargetByName('Cat').y).toBe(20);
    });
});
