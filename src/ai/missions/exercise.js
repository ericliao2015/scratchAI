/**
 * Setting up missions in the editor (Parsons puzzles, bugs to fix) and making new
 * exercises with AI.
 */
import {extractJson} from '../json.js';
import {compileProgram} from '../ir/compile.js';
import {applyPlan} from '../apply/apply.js';
import {applyViaWorkspace, canApplyViaWorkspace} from '../apply/workspace.js';
import {modelFromVM} from '../project/model.js';
import {formatCatalog} from '../catalog/format.js';
import {normalizeTest} from '../run/verify.js';
import {runRule} from '../grade/rules.js';
import {normalizeMission} from './pack.js';
import {buildMissionSystemPrompt, buildMissionUserMessage} from '../prompts/mission.js';

/**
 * Split scripts into single blocks (C blocks lose their contents, which become pieces too).
 * @param {Array} scripts IR scripts
 * @returns {Array} one-block IR scripts
 */
export const piecesOf = scripts => {
    const pieces = [];
    const visit = nodes => {
        for (const node of nodes || []) {
            if (!node || typeof node !== 'object') continue;
            const {substacks, ...rest} = node;
            pieces.push([rest]);
            if (substacks) Object.values(substacks).forEach(visit);
        }
    };
    scripts.forEach(visit);
    return pieces;
};

/**
 * Deterministic shuffle (the same puzzle looks the same every time), never the solved order.
 * @param {Array} list items
 * @param {string} seedText seed
 * @returns {Array} shuffled copy
 */
export const shuffle = (list, seedText = '') => {
    let seed = 0;
    for (const ch of String(seedText)) seed = ((seed * 31) + ch.charCodeAt(0)) >>> 0;
    const random = () => {
        seed = ((seed * 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    if (copy.length > 1 && copy.every((item, i) => item === list[i])) copy.push(copy.shift());
    return copy;
};

const spriteForMission = vm => {
    if (vm.editingTarget && !vm.editingTarget.isStage) return vm.editingTarget;
    return vm.runtime.targets.find(t => t.isOriginal && !t.isStage) || null;
};

/**
 * Put a mission's starting blocks into the project: shuffled pieces for Parsons, the broken
 * program for bug fixing. Build missions only get their variables.
 * @param {object} options {vm, catalog, mission}
 * @returns {Promise<object>} apply summary (undoable when added through the editor)
 */
export const startMission = ({vm, catalog, mission}) => {
    const sprite = spriteForMission(vm);
    if (!sprite) throw new Error('專案裡沒有角色，請先新增一個角色。');
    if (vm.editingTarget !== sprite) vm.setEditingTarget(sprite.id);
    const scripts = mission.kind === 'parsons' ? shuffle(piecesOf(mission.scripts), mission.id) :
        (mission.kind === 'bugfix' ? mission.scripts : []);
    const ir = {
        type: 'program',
        stage: {variables: mission.variables},
        sprites: [{name: sprite.getName(), scripts}]
    };
    const compiled = compileProgram(ir, {catalog, model: modelFromVM(vm)});
    if (compiled.errors.length) {
        throw new Error(`任務的積木無法建立：${compiled.errors.slice(0, 3).map(e => e.message)
            .join('；')}`);
    }
    return canApplyViaWorkspace(vm, compiled.plan, []) ?
        applyViaWorkspace(vm, compiled.plan, {marker: false}) :
        applyPlan(vm, compiled.plan);
};

/**
 * Problems in an AI-made mission, to send back for repair.
 * @param {object} mission normalized mission
 * @param {object} options {catalog, vm}
 * @returns {string[]} problems
 */
export const missionProblems = (mission, {catalog, vm}) => {
    const problems = [];
    if (!mission.goal) problems.push('"goal" is empty');
    if (!mission.checks.length) problems.push('add at least one item in "checks"');
    if (mission.kind !== 'build' && !mission.scripts.length) problems.push(`a ${mission.kind} mission needs "scripts"`);
    if (mission.scripts.length) {
        const model = modelFromVM(vm);
        const sprite = spriteForMission(vm);
        // Declare the mission's variables so the scripts can use them.
        const withVars = compileProgram({
            type: 'program',
            stage: {variables: mission.variables},
            sprites: [{name: sprite ? sprite.getName() : 'Sprite1', scripts: mission.scripts}]
        }, {catalog, model});
        withVars.errors.slice(0, 10).forEach(e => problems.push(`scripts${e.path ? ` ${e.path}` : ''}: ${e.message}`));
    }
    mission.checks.forEach((item, i) => {
        if (item.type === 'test' && !normalizeTest(item.test)) problems.push(`checks[${i}]: the test needs "expect"`);
        if (item.type === 'rule' && runRule({targets: []}, item.check).invalid) {
            problems.push(`checks[${i}]: unknown rule ${JSON.stringify(item.check)}`);
        }
    });
    return problems;
};

/**
 * Ask the AI for a new exercise.
 * @param {object} options options
 * @param {object} options.client AI client
 * @param {object} options.vm VM (its project gives context, e.g. sprite names)
 * @param {object} options.catalog block catalog
 * @param {string} options.topic what to practise
 * @param {string} [options.kind] build | parsons | bugfix
 * @param {object} [options.promptOptions] {level, language}
 * @param {AbortSignal} [options.signal] cancel
 * @returns {Promise<object>} normalized mission
 */
export const generateMission = async ({client, vm, catalog, topic, kind = 'build', promptOptions = {}, signal}) => {
    const system = buildMissionSystemPrompt({catalogText: formatCatalog(catalog), ...promptOptions});
    const messages = [{role: 'user', content: buildMissionUserMessage({topic, kind})}];
    let problems = [];
    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await client.complete({system, messages, json: true, maxTokens: 8000}, {signal});
        messages.push({role: 'assistant', content: response.text});
        let mission;
        try {
            mission = normalizeMission({...extractJson(response.text), kind, id: `ai-${Date.now()}`});
        } catch (e) {
            problems = ['the answer is not valid JSON'];
            messages.push({role: 'user', content: `Fix these problems and return the complete JSON:\n- ${problems[0]}`});
            continue;
        }
        problems = missionProblems(mission, {catalog, vm});
        if (!problems.length) return {...mission, generated: true, model: response.model};
        messages.push({role: 'user',
            content: `Fix these problems and return the complete JSON:\n${
                problems.map(p => `- ${p}`).join('\n')}`});
    }
    const error = new Error('AI 出的題目有問題，請再試一次或換個主題。');
    error.details = problems.map(message => ({message}));
    throw error;
};
