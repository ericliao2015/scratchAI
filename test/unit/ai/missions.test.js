import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {makeVM} from '../../helpers/ai-vm.js';
import {samplePack} from '../../../src/ai/missions/sample.js';
import {missionTemplate, normalizeMissionPack} from '../../../src/ai/missions/pack.js';
import {generateMission, piecesOf, shuffle, startMission} from '../../../src/ai/missions/exercise.js';
import {gradeProject} from '../../../src/ai/grade/grade.js';
import {modelFromVM} from '../../../src/ai/project/model.js';
import {projectDataWithIds, runTest} from '../../../src/ai/run/verify.js';
import {applyGenerated, generate} from '../../../src/ai/generate.js';

const check = (vm, mission) => gradeProject({
    model: modelFromVM(vm),
    template: missionTemplate(mission),
    client: null,
    runTest: async test => runTest({data: await projectDataWithIds(vm), storage: vm.runtime.storage, test, withRenderer: false})
});

const fakeClient = replies => {
    const calls = [];
    return {
        calls,
        async complete (request) {
            calls.push(JSON.parse(JSON.stringify(request)));
            return {text: replies.shift(), usage: {}, model: 'fake', provider: 'fake'};
        }
    };
};

// Build a solution into the Cat sprite through the normal generate path.
const solve = async (vm, scripts, variables = []) => {
    const ir = {type: 'program', stage: {variables}, sprites: [{name: 'Cat', scripts}]};
    const result = await generate({client: fakeClient([JSON.stringify(ir)]), vm, catalog, request: 'x'});
    await applyGenerated({vm, catalog, result, record: false});
};

describe('missions', () => {
    test('pieces and shuffle', () => {
        const pieces = piecesOf([[{opcode: 'a'}, {opcode: 'b', substacks: {SUBSTACK: [{opcode: 'c'}]}}]]);
        expect(pieces.map(p => p[0].opcode)).toEqual(['a', 'b', 'c']);
        expect(pieces[1][0].substacks).toBeUndefined();
        const shuffled = shuffle(pieces, 'seed');
        expect(shuffled).toHaveLength(3);
        expect(shuffled).not.toEqual(pieces);
        expect(shuffle(pieces, 'seed')).toEqual(shuffled);
    });

    test('the sample pack: an empty project fails, solutions pass', async () => {
        const pack = samplePack('zh-tw');
        expect(pack.missions.map(m => m.kind)).toEqual(['build', 'build', 'build', 'parsons', 'bugfix']);
        const walk = pack.missions[0];
        const vm = await makeVM();
        expect((await check(vm, walk)).overallPass).toBe(false);
        await solve(vm, [[{opcode: 'event_whenflagclicked'}, {opcode: 'motion_movesteps', inputs: {STEPS: 10}}]]);
        expect((await check(vm, walk)).overallPass).toBe(true);

        const keys = pack.missions[1];
        const vm2 = await makeVM();
        await solve(vm2, [
            [{opcode: 'event_whenkeypressed', fields: {KEY_OPTION: 'right arrow'}}, {opcode: 'motion_changexby', inputs: {DX: 10}}],
            [{opcode: 'event_whenkeypressed', fields: {KEY_OPTION: 'left arrow'}}, {opcode: 'motion_changexby', inputs: {DX: -10}}]
        ]);
        expect((await check(vm2, keys)).items.map(i => i.pass)).toEqual([true, true]);
    });

    test('parsons: shuffled pieces fail until assembled', async () => {
        const mission = samplePack('zh-tw').missions[3];
        const vm = await makeVM();
        await startMission({vm, catalog, mission});
        const cat = vm.runtime.getSpriteTargetByName('Cat');
        const tops = Object.values(cat.blocks._blocks).filter(b => b.topLevel);
        expect(tops).toHaveLength(5);
        expect(vm.runtime.getTargetForStage().lookupVariableByNameAndType('分數', '')).toBeTruthy();
        const before = await check(vm, mission);
        expect(before.items.map(i => i.pass)).toEqual([false, false]);
        // A student who assembles the solution (here: a fresh project with the solution) passes.
        const solved = await makeVM();
        await solve(solved, mission.scripts, mission.variables);
        expect((await check(solved, mission)).overallPass).toBe(true);
    });

    test('bugfix: the given program fails, the fixed one passes', async () => {
        const mission = samplePack('en').missions[4];
        const vm = await makeVM();
        await startMission({vm, catalog, mission});
        expect((await check(vm, mission)).overallPass).toBe(false);
        const fixed = await makeVM();
        await solve(fixed, [[{opcode: 'event_whenflagclicked'},
            {opcode: 'control_forever', substacks: {SUBSTACK: [{opcode: 'motion_turnright', inputs: {DEGREES: 15}}]}}]]);
        expect((await check(fixed, mission)).overallPass).toBe(true);
    });

    test('AI-made missions are validated and repaired', async () => {
        const vm = await makeVM();
        const bad = {title: '跳', goal: '按空白鍵跳一下', scripts: [], checks: [{type: 'test', desc: 'x', test: {}}]};
        const good = {...bad, checks: [{type: 'test', desc: '會往上', points: 1, test: {duration: 1,
            actions: [{at: 0, do: 'keyPress', key: 'space'}], expect: [{prop: 'y', op: 'changed', at: 0.3}]}}],
        hints: ['想一想', '用 y 改變']};
        const client = fakeClient([JSON.stringify(bad), JSON.stringify(good)]);
        const mission = await generateMission({client, vm, catalog, topic: '跳躍'});
        expect(client.calls).toHaveLength(2);
        expect(client.calls[1].messages[2].content).toContain('the test needs "expect"');
        expect(mission).toMatchObject({kind: 'build', title: '跳', generated: true});
        expect(() => normalizeMissionPack({title: 'p', missions: [mission]})).not.toThrow();
    });
});

test('re-normalizing a template keeps "all items must pass"', () => {
    const {normalizeTemplate} = require('../../../src/ai/grade/template.js');
    expect(normalizeTemplate(normalizeTemplate({items: []})).passThreshold).toBe(null);
    expect(normalizeTemplate({items: [], passThreshold: 2}).passThreshold).toBe(2);
});
