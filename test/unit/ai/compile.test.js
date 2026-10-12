import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {compileProgram} from '../../../src/ai/ir/compile.js';
import {applyPlan} from '../../../src/ai/apply/apply.js';
import {modelFromVM, modelFromProjectJson} from '../../../src/ai/project/model.js';
import {projectToText} from '../../../src/ai/project/serialize.js';
import {makeVM, SVG} from '../../helpers/ai-vm.js';

const GAME = {
    type: 'program',
    broadcasts: ['開始遊戲'],
    stage: {variables: [{name: '分數', value: 0}]},
    sprites: [
        {
            name: 'Cat',
            scripts: [[
                {opcode: 'event_whenflagclicked'},
                {opcode: 'data_setvariableto', fields: {VARIABLE: '分數'}, inputs: {VALUE: 0}},
                {opcode: 'motion_goto', inputs: {TO: 'random position'}},
                {opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: '開始遊戲'}},
                {opcode: 'control_forever', substacks: {SUBSTACK: [
                    {opcode: 'motion_movesteps', inputs: {STEPS: {var: '速度'}}},
                    {opcode: 'motion_ifonedgebounce'},
                    {opcode: 'control_if', inputs: {CONDITION: {opcode: 'sensing_touchingobject', inputs: {TOUCHINGOBJECTMENU: 'Apple'}}},
                        substacks: {SUBSTACK: [
                            {opcode: 'data_changevariableby', fields: {VARIABLE: '分數'}, inputs: {VALUE: 1}},
                            {call: '跳 %s 次', args: [2]}
                        ]}}
                ]}}
            ]],
            variables: [{name: '速度', value: 5}],
            procedures: [{
                proccode: '跳 %s 次',
                args: [{name: '次數'}],
                body: [
                    {opcode: 'control_repeat', inputs: {TIMES: {arg: '次數'}}, substacks: {SUBSTACK: [
                        {opcode: 'motion_changeyby', inputs: {DY: 10}}
                    ]}}
                ]
            }]
        },
        {
            name: 'Apple',
            costumes: [{svg: SVG}],
            x: 100,
            y: -50,
            scripts: [[
                {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: '開始遊戲'}},
                {opcode: 'looks_sayforsecs', inputs: {MESSAGE: {opcode: 'operator_join', inputs: {STRING1: '分數:', STRING2: {var: '分數'}}}, SECS: 2}}
            ]]
        }
    ]
};

describe('compileProgram', () => {
    test('compiles a multi-sprite game without errors', () => {
        const {plan, errors} = compileProgram(GAME, {catalog});
        expect(errors).toEqual([]);
        expect(plan.broadcasts.map(b => b.name)).toEqual(['開始遊戲']);
        expect(plan.variables.map(v => v.name).sort()).toEqual(['分數', '速度']);
        expect(plan.sprites.map(s => s.name)).toEqual(['Cat', 'Apple']);
        const cat = plan.scripts.find(s => s.target === 'Cat');
        const opcodes = cat.blocks.map(b => b.opcode);
        expect(opcodes).toContain('procedures_definition');
        expect(opcodes).toContain('procedures_call');
        expect(opcodes).toContain('argument_reporter_string_number');
        const gotoMenu = cat.blocks.find(b => b.opcode === 'motion_goto_menu');
        expect(gotoMenu.fields.TO.value).toBe('_random_');
    });

    test('reports helpful errors', () => {
        const {errors} = compileProgram({sprites: [{name: 'A', scripts: [[
            {opcode: 'event_whenflagclicked'},
            {opcode: 'motion_movesteps', inputs: {STEPS: 'fast'}},
            {opcode: 'not_a_block'},
            {opcode: 'operator_add'},
            {opcode: 'control_if', inputs: {CONDITION: {opcode: 'operator_add'}}},
            {opcode: 'control_forever'},
            {opcode: 'motion_ifonedgebounce'},
            {opcode: 'event_whenflagclicked'},
            {opcode: 'control_stop', fields: {STOP_OPTION: 'everything'}}
        ]]}]}, {catalog});
        const messages = errors.map(e => `${e.path} ${e.message}`).join('\n');
        expect(messages).toMatch(/inputs.STEPS .*數字/);
        expect(messages).toMatch(/not_a_block/);
        expect(messages).toMatch(/operator_add 是圓形/);
        expect(messages).toMatch(/不是條件/);
        expect(messages).toMatch(/後面不能再接積木/);
        expect(messages).toMatch(/帽子/);
        expect(messages).toMatch(/選單值 "everything"/);
    });

    test('undeclared variables are created as globals with a warning', () => {
        const {plan, warnings, errors} = compileProgram({sprites: [{name: 'A', scripts: [[
            {opcode: 'data_changevariableby', fields: {VARIABLE: 'hits'}, inputs: {VALUE: 1}}
        ]]}]}, {catalog});
        expect(errors).toEqual([]);
        expect(warnings.join()).toMatch(/hits/);
        expect(plan.variables[0]).toMatchObject({name: 'hits', target: '__stage__'});
    });

    test('accepts inputs/fields in the wrong place and statement arrays in inputs', () => {
        const {errors} = compileProgram({sprites: [{name: 'A', scripts: [[
            {opcode: 'event_whenflagclicked'},
            {opcode: 'data_setvariableto', inputs: {VARIABLE: 'x', VALUE: 1}},
            {opcode: 'control_repeat', inputs: {TIMES: 3, SUBSTACK: [{opcode: 'motion_turnright', inputs: {DEGREES: 15}}]}}
        ]]}]}, {catalog});
        expect(errors).toEqual([]);
    });
});

describe('applyPlan', () => {
    test('creates sprites, variables, broadcasts and runnable scripts', async () => {
        const vm = await makeVM();
        const {plan, errors} = compileProgram(GAME, {catalog, model: modelFromVM(vm)});
        expect(errors).toEqual([]);
        const summary = await applyPlan(vm, plan);
        expect(summary.spritesCreated).toEqual(['Apple']);
        expect(summary.warnings).toEqual([]);

        const apple = vm.runtime.getSpriteTargetByName('Apple');
        expect(apple.x).toBe(100);
        const stage = vm.runtime.getTargetForStage();
        expect(Object.values(stage.variables).map(v => v.name)
            .sort()).toEqual(['分數', '開始遊戲']);

        // Round trip through sb3 and check the scripts survive.
        const json = JSON.parse(vm.toJSON());
        const model = modelFromProjectJson(json);
        const {text} = projectToText(model, {catalog});
        expect(text).toContain('event_whenflagclicked');
        expect(text).toContain('define "跳 %s 次" args=["次數"]');
        expect(text).toContain('call "跳 %s 次" 2');
        expect(text).toContain('motion_movesteps STEPS=(var "速度")');
        expect(text).toContain('event_whenbroadcastreceived BROADCAST_OPTION="開始遊戲"');

        // The project runs: start the green flag and step the runtime a few frames.
        vm.runtime.greenFlag();
        for (let i = 0; i < 5; i++) vm.runtime._step();
        expect(vm.runtime.getSpriteTargetByName('Cat').variables).toBeDefined();
        const score = Object.values(stage.variables).find(v => v.name === '分數');
        expect(Number(score.value)).toBeGreaterThanOrEqual(0);

        const loaded = await makeVM();
        await loaded.loadProject(await vm.saveProjectSb3('arraybuffer'));
        expect(loaded.runtime.getSpriteTargetByName('Apple')).toBeTruthy();
    });

    test('adding scripts to an existing sprite does not overlap old scripts', async () => {
        const vm = await makeVM();
        const first = compileProgram({sprites: [{name: 'Cat', scripts: [[{opcode: 'event_whenflagclicked'}]]}]},
            {catalog, model: modelFromVM(vm)});
        await applyPlan(vm, first.plan);
        const second = compileProgram({sprites: [{name: 'Cat', scripts: [[{opcode: 'event_whenkeypressed'}]]}]},
            {catalog, model: modelFromVM(vm)});
        await applyPlan(vm, second.plan);
        const tops = Object.values(vm.runtime.getSpriteTargetByName('Cat').blocks._blocks).filter(b => b.topLevel);
        expect(tops).toHaveLength(2);
        expect(new Set(tops.map(b => b.x)).size).toBe(2);
    });
});
