import {makeVM} from '../../helpers/ai-vm.js';
import {createSandbox, runScenario} from '../../../src/ai/run/engine.js';
import {checkExpectations, summarizeTrace} from '../../../src/ai/run/expect.js';

const sb = (opcode, extra = {}) => ({opcode, next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false, ...extra});

const project = json => {
    const stage = json.targets[0];
    stage.variables = {vScore: ['score', 0]};
    const cat = json.targets[1];
    cat.blocks = {
        flag: sb('event_whenflagclicked', {next: 'set', topLevel: true, x: 0, y: 0}),
        set: sb('data_setvariableto', {parent: 'flag', next: 'say', inputs: {VALUE: [1, [10, '0']]}, fields: {VARIABLE: ['score', 'vScore']}}),
        say: sb('looks_say', {parent: 'set', next: 'rep', inputs: {MESSAGE: [1, [10, 'hi']]}}),
        rep: sb('control_repeat', {parent: 'say', next: 'wait', inputs: {TIMES: [1, [6, '10']], SUBSTACK: [2, 'chx']}}),
        chx: sb('motion_changexby', {parent: 'rep', inputs: {DX: [1, [4, '10']]}}),
        wait: sb('control_wait', {parent: 'rep', next: 'done', inputs: {DURATION: [1, [5, '1']]}}),
        done: sb('looks_say', {parent: 'wait', inputs: {MESSAGE: [1, [10, 'done']]}}),
        key: sb('event_whenkeypressed', {next: 'inc', topLevel: true, x: 0, y: 300, fields: {KEY_OPTION: ['right arrow', null]}}),
        inc: sb('data_changevariableby', {parent: 'key', inputs: {VALUE: [1, [4, '1']]}, fields: {VARIABLE: ['score', 'vScore']}}),
        fl2: sb('event_whenflagclicked', {next: 'fe', topLevel: true, x: 0, y: 600}),
        fe: sb('control_forever', {parent: 'fl2', inputs: {SUBSTACK: [2, 'turn']}}),
        turn: sb('motion_turnright', {parent: 'fe', inputs: {DEGREES: [1, [4, '1']]}})
    };
};

describe('run engine', () => {
    let vm;
    let data;
    beforeAll(async () => {
        vm = await makeVM(project);
        data = await vm.saveProjectSb3('arraybuffer');
    });

    test('runs the green flag, keys and waits on a virtual clock', async () => {
        const sandbox = await createSandbox({data, storage: vm.runtime.storage, withRenderer: false});
        const started = Date.now();
        const trace = runScenario(sandbox.vm, {
            duration: 2,
            actions: [{at: 0, do: 'greenFlag'}, {at: 0.5, do: 'keyPress', key: 'right arrow'}]
        });
        sandbox.dispose();
        expect(Date.now() - started).toBeLessThan(1500);
        const last = trace.samples[trace.samples.length - 1];
        expect(last.sprites.Cat.x).toBe(100);
        expect(last.vars.score).toBe(1);
        expect(trace.said.map(s => s.text)).toEqual(['hi', 'done']);
        const done = trace.said.find(s => s.text === 'done');
        expect(done.t).toBeGreaterThan(1.2);
        expect(done.t).toBeLessThan(1.5);
        // forever turn right 1: one turn per frame, not hundreds
        expect(last.sprites.Cat.direction).toBeGreaterThan(110);
        expect(last.sprites.Cat.direction).toBeLessThan(160);

        const results = checkExpectations(trace, [
            {sprite: 'Cat', prop: 'x', op: '=', value: 100},
            {sprite: 'Cat', prop: 'x', op: 'increased'},
            {var: 'score', op: '>=', value: 1},
            {var: 'score', op: '=', value: 0, at: 0.4},
            {said: 'done', sprite: 'Cat'},
            {said: 'bye'},
            {sprite: 'Dog', prop: 'x', op: '=', value: 0}
        ]);
        expect(results.map(r => r.pass)).toEqual([true, true, true, true, true, false, false]);
        const report = summarizeTrace(trace);
        expect(report).toContain('Sprite "Cat": position (0, 0) → (100, 0)');
        expect(report).toContain('Variable "score": 0 → 1');
        expect(report).toContain('"done"');
    });

    test('the editor VM is untouched', () => {
        expect(vm.runtime.getSpriteTargetByName('Cat').x).toBe(0);
    });
});
