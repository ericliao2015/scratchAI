import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {applyGenerated, generate} from '../../../src/ai/generate.js';
import {aiUsageSummary, readLog} from '../../../src/ai/provenance.js';
import {modelFromProjectJson, modelFromVM} from '../../../src/ai/project/model.js';
import {askTutor} from '../../../src/ai/tutor.js';
import {gradeProject} from '../../../src/ai/grade/grade.js';
import {makeVM} from '../../helpers/ai-vm.js';

const client = text => ({async complete () {
    return {text, usage: {}, model: 'fake'};
}});

const PROGRAM = JSON.stringify({type: 'program', sprites: [{name: 'Cat', scripts: [[
    {opcode: 'event_whenflagclicked'},
    {opcode: 'motion_movesteps', inputs: {STEPS: 5}}
]]}]});

describe('AI usage records', () => {
    test('generated blocks are logged, marked and counted', async () => {
        const vm = await makeVM(project => {
            // One block the student wrote themselves.
            project.targets[1].blocks = {own: {opcode: 'looks_nextcostume', next: null, parent: null, inputs: {}, fields: {},
                shadow: false, topLevel: true, x: 0, y: 0}};
        });
        const result = await generate({client: client(PROGRAM), vm, catalog, request: '讓貓咪移動'});
        const applied = await applyGenerated({vm, catalog, result});
        expect(applied.summary.aiBlocks).toBe(2);

        const log = readLog(vm);
        expect(log.entries).toHaveLength(1);
        expect(log.entries[0]).toMatchObject({mode: 'generate', prompt: '讓貓咪移動', blocks: 2});

        const cat = vm.runtime.getSpriteTargetByName('Cat');
        const marks = Object.values(cat.comments).filter(c => c.text.startsWith('🤖 AI'));
        expect(marks).toHaveLength(1);
        expect(marks[0].text).toMatch(/^🤖 AI · 2 · /);
        expect(cat.blocks.getBlock(marks[0].blockId).opcode).toBe('event_whenflagclicked');

        // The log survives saving: read it back from project.json.
        const json = JSON.parse(vm.toJSON());
        const stage = json.targets.find(t => t.isStage);
        expect(Object.values(stage.comments).some(c => c.text.includes('"mode":"generate"'))).toBe(true);
        const summary = aiUsageSummary(modelFromProjectJson(json));
        expect(summary).toMatchObject({aiBlocks: 2, totalBlocks: 3, generations: 1});
        expect(Math.round(summary.share * 100)).toBe(67);

        // Saving renames block ids; the share must survive a save and reload.
        const reloaded = await makeVM();
        await reloaded.loadProject(await vm.saveProjectSb3('arraybuffer'));
        expect(aiUsageSummary(modelFromVM(reloaded))).toMatchObject({aiBlocks: 2, totalBlocks: 3});

        // The student adds their own block under the AI script: it is not counted as AI made.
        const top = Object.values(reloaded.runtime.getSpriteTargetByName('Cat').blocks._blocks)
            .find(b => b.opcode === 'motion_movesteps');
        const target = reloaded.runtime.getSpriteTargetByName('Cat');
        target.blocks.createBlock({id: 'mine', opcode: 'looks_hide', next: null, parent: top.id, inputs: {}, fields: {},
            shadow: false, topLevel: false});
        top.next = 'mine';
        expect(aiUsageSummary(modelFromVM(reloaded))).toMatchObject({aiBlocks: 2, totalBlocks: 4});
    });

    test('tutor questions are logged and grading reports the share', async () => {
        const vm = await makeVM();
        const answer = JSON.stringify({message: '想想看用什麼積木可以一直重複？', question: '你知道哪個積木會重複嗎？', concepts: ['迴圈']});
        const reply = await askTutor({client: client(answer), vm, catalog, task: 'hint1', goal: '一直轉圈'});
        expect(reply).toMatchObject({message: '想想看用什麼積木可以一直重複？', concepts: ['迴圈'], skeleton: null});
        const result = await gradeProject({model: modelFromVM(vm), template: {items: []}, client: null});
        expect(result.ai).toMatchObject({generations: 0, tutorCount: 1, aiBlocks: 0});
    });

    test('hint 3 skeletons are compiled for the preview', async () => {
        const vm = await makeVM();
        const answer = JSON.stringify({message: '照這個骨架完成', skeleton: {sprite: 'Cat', scripts: [[
            {opcode: 'event_whenflagclicked'}, {opcode: 'control_forever'}
        ]]}, missing: ['迴圈裡要放轉動的積木']});
        const reply = await askTutor({client: client(answer), vm, catalog, task: 'hint3', goal: '一直轉圈', record: false});
        expect(reply.skeleton[0].blocks.map(b => b.opcode)).toEqual(['event_whenflagclicked', 'control_forever']);
        expect(reply.missing).toEqual(['迴圈裡要放轉動的積木']);
        expect(readLog(vm).entries).toHaveLength(0);
    });

    test('explain uses the script containing the clicked block', async () => {
        const vm = await makeVM(project => {
            project.targets[1].blocks = {
                hat: {opcode: 'event_whenflagclicked', next: 'move', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0},
                move: {opcode: 'motion_movesteps', next: null, parent: 'hat', inputs: {STEPS: [1, [4, '10']]}, fields: {}, shadow: false, topLevel: false}
            };
        });
        let seen = '';
        const spy = {async complete (request) {
            seen = request.messages[0].content;
            return {text: '{"message": "這段程式會讓貓咪移動"}', usage: {}, model: 'fake'};
        }};
        const reply = await askTutor({client: spy, vm, catalog, task: 'explain', blockId: 'move'});
        expect(reply.focus.text).toMatch(/when\s+clicked/);
        expect(reply.focus.text).toContain('move 10 steps');
        expect(seen).toContain('The script the student is asking about');
    });
});
