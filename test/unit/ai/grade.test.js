import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {compileProgram} from '../../../src/ai/ir/compile.js';
import {applyPlan} from '../../../src/ai/apply/apply.js';
import {modelFromVM} from '../../../src/ai/project/model.js';
import {runRule} from '../../../src/ai/grade/rules.js';
import {gradeProject, studentViewOf} from '../../../src/ai/grade/grade.js';
import {parseFileName, toCsv, toMarkdown} from '../../../src/ai/grade/report.js';
import {batchGrade, batchModify, readProjectFiles} from '../../../src/ai/batch.js';
import {makeVM} from '../../helpers/ai-vm.js';

const PROGRAM = {
    broadcasts: ['go'],
    stage: {variables: [{name: '分數'}]},
    sprites: [{name: 'Cat', scripts: [
        [
            {opcode: 'event_whenflagclicked'},
            {opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: 'go'}},
            {opcode: 'control_forever', substacks: {SUBSTACK: [
                {opcode: 'control_if', inputs: {CONDITION: {opcode: 'sensing_touchingobject', inputs: {TOUCHINGOBJECTMENU: '_edge_'}}},
                    substacks: {SUBSTACK: [{opcode: 'data_changevariableby', fields: {VARIABLE: '分數'}, inputs: {VALUE: 1}}]}}
            ]}}
        ],
        [{opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: 'go'}}, {opcode: 'looks_say', inputs: {MESSAGE: 'hi'}}],
        [{opcode: 'motion_movesteps'}]
    ]}]
};

const projectVM = async () => {
    const vm = await makeVM();
    const {plan} = compileProgram(PROGRAM, {catalog, model: modelFromVM(vm)});
    await applyPlan(vm, plan);
    return vm;
};

const TEMPLATE = {
    title: '測試',
    items: [
        {id: 'r1', type: 'rule', desc: '綠旗', points: 20, check: {usesOpcode: 'event_whenflagclicked'}},
        {id: 'r2', type: 'rule', desc: '迴圈', points: 20, check: {hasLoop: true}},
        {id: 'r3', type: 'rule', desc: '廣播', points: 20, check: {broadcastUsed: true}},
        {id: 'r4', type: 'rule', desc: '兩個角色', points: 20, check: {spriteCount: {min: 2}}},
        {id: 'a1', type: 'ai', desc: '碰到邊緣加分', points: 20}
    ]
};

const fakeClient = text => ({
    calls: 0,
    async complete () {
        this.calls += 1;
        return {text, model: 'fake-model', provider: 'fake', usage: {}};
    }
});

describe('rules', () => {
    test('checks code that can run', async () => {
        const model = modelFromVM(await projectVM());
        expect(runRule(model, {usesOpcode: 'event_whenflagclicked'}).pass).toBe(true);
        expect(runRule(model, {variableExists: '分數'}).pass).toBe(true);
        expect(runRule(model, {variableExists: 'lives'}).pass).toBe(false);
        expect(runRule(model, {hasCondition: true, sprite: 'Cat'}).pass).toBe(true);
        expect(runRule(model, {broadcastUsed: 'go'}).pass).toBe(true);
        expect(runRule(model, {scriptCount: {min: 2}}).detail).toBe('共有 2 段腳本');
        expect(runRule(model, {usesOpcode: 'motion_movesteps'}).pass).toBe(true);
        expect(runRule(model, {sprite: 'Dog', hasLoop: true}).pass).toBe(false);
        expect(runRule(model, {flies: true}).invalid).toBe(true);
    });
});

describe('gradeProject', () => {
    test('combines rule and AI items', async () => {
        const vm = await projectVM();
        const model = modelFromVM(vm);
        const client = fakeClient(JSON.stringify({
            results: [{id: 'a1', pass: true, score: 15, reason: '有判斷碰到邊緣', evidence: ['#4', '#999']}],
            summary: '做得很好'
        }));
        const result = await gradeProject({model, template: TEMPLATE, client, catalog});
        expect(result.items.map(i => i.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'a1']);
        expect(result.items.find(i => i.id === 'r4').pass).toBe(false);
        expect(result.total).toBe(75);
        expect(result.max).toBe(100);
        expect(result.passedCount).toBe(4);
        const ai = result.items.find(i => i.id === 'a1');
        expect(ai.evidence).toHaveLength(1);
        expect(ai.evidence[0].target).toBe('Cat');
        expect(result.model.model).toBe('fake-model');

        // Same project and template: answered from cache.
        await gradeProject({model, template: TEMPLATE, client, catalog});
        expect(client.calls).toBe(1);

        const hidden = studentViewOf({...result, template: {...result.template, studentView: 'countOnly'}});
        expect(hidden.items).toEqual([]);
        const partial = studentViewOf(result);
        expect(partial.items[0].reason).toBe('');
    });

    test('rule-only templates need no AI', async () => {
        const model = modelFromVM(await projectVM());
        const result = await gradeProject({
            model,
            template: {...TEMPLATE, items: TEMPLATE.items.slice(0, 2), scoring: 'passfail'},
            client: null
        });
        expect(result.overallPass).toBe(true);
    });
});

describe('reports', () => {
    test('file names, markdown and csv', async () => {
        expect(parseFileName('05_王小明.sb3')).toEqual({seat: '05', name: '王小明', base: '05_王小明'});
        expect(parseFileName('作業.sb3')).toEqual({seat: '', name: '作業', base: '作業'});
        const model = modelFromVM(await projectVM());
        const result = await gradeProject({model, template: {...TEMPLATE, items: TEMPLATE.items.slice(0, 4)}, client: null});
        const md = toMarkdown({fileName: '05_王小明.sb3', result});
        expect(md).toContain('- 座號：05');
        expect(md).toContain('總分：60/80');
        const csv = toCsv([{fileName: '05_王小明.sb3', result}, {fileName: '06_李.sb3', result: null, error: '壞掉'}]);
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        expect(csv).toContain('05,王小明,05_王小明.sb3,60,3/4');
        expect(csv).toContain('壞掉');
    });
});

describe('batch', () => {
    const fileOf = async (name, vm) => {
        const data = await vm.saveProjectSb3('arraybuffer');
        return {name, arrayBuffer: async () => data};
    };

    test('grades and modifies many files without touching the originals', async () => {
        const vm1 = await projectVM();
        const vm2 = await makeVM();
        const files = [await fileOf('02_b.sb3', vm2), await fileOf('01_a.sb3', vm1), {name: 'notes.txt', arrayBuffer: async () => new ArrayBuffer(1)}];
        const projects = await readProjectFiles(files);
        expect(projects.map(p => p.fileName)).toEqual(['01_a.sb3', '02_b.sb3']);

        const graded = await batchGrade({projects, template: {...TEMPLATE, items: TEMPLATE.items.slice(0, 2)}, client: null});
        expect(graded.map(e => e.result.passedCount)).toEqual([2, 0]);

        const answer = JSON.stringify({
            type: 'program',
            sprites: [{name: 'Cat', scripts: [[{opcode: 'event_whenkeypressed', fields: {KEY_OPTION: 'space'}}, {opcode: 'motion_changeyby', inputs: {DY: 20}}]]}],
            ops: [{op: 'deleteScript', sprite: 'Cat', block: {opcode: 'motion_movesteps'}}]
        });
        const client = fakeClient(answer);
        const before = projects[0].data.byteLength;
        const modified = await batchModify({
            projects, mode: 'unified', instruction: '加跳躍', client, catalog, storage: vm1.runtime.storage
        });
        expect(client.calls).toBe(1);
        expect(modified.map(e => e.error)).toEqual([null, null]);
        expect(projects[0].data.byteLength).toBe(before);
        expect(modified[0].log).toContain('修改既有積木：成功 1 處');
        // File 2 has no motion_movesteps: the op fails there but the new script is still added.
        expect(modified[1].log).toContain('失敗 1 處');

        const regraded = await batchGrade({
            projects: modified.map(e => ({fileName: e.fileName, data: e.data.buffer})),
            template: {items: [{id: 'k', type: 'rule', desc: '空白鍵', points: 1, check: {usesOpcode: 'event_whenkeypressed'}},
                {id: 'm', type: 'rule', desc: '移動', points: 1, check: {usesOpcode: 'motion_movesteps'}}]},
            client: null
        });
        expect(regraded.map(e => e.result.items.map(i => i.pass))).toEqual([[true, false], [true, false]]);
    });
});
