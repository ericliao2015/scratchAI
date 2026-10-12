/**
 * Tutor mode: explanations, hints and debugging help without writing the program.
 */
import {extractJson} from './json.js';
import {compileScripts} from './ir/compile.js';
import {modelFromVM, topBlocks} from './project/model.js';
import {ProjectSerializer, projectToText} from './project/serialize.js';
import {formatCatalog} from './catalog/format.js';
import {buildTutorSystemPrompt, buildTutorUserMessage} from './prompts/tutor.js';
import {recordUsage} from './provenance.js';

/**
 * Text of the script that contains a block, for "explain this" and "why doesn't this work".
 * @param {object} vm VM
 * @param {string} blockId any block in the script
 * @param {?object} catalog block catalog (for readable labels)
 * @returns {?{targetName: string, text: string, topId: string}} script text
 */
export const scriptTextForBlock = (vm, blockId, catalog = null) => {
    const model = modelFromVM(vm);
    const target = model.targets.find(t => t.blocks[blockId]);
    if (!target) return null;
    let block = target.blocks[blockId];
    while (block && block.parent) block = target.blocks[block.parent];
    if (!block) return null;
    const serializer = new ProjectSerializer({catalog, human: true});
    const lines = [];
    serializer.stackLines(target.blocks, block.id, '', lines);
    return {targetName: target.isStage ? 'Stage' : target.name, text: lines.join('\n'), topId: block.id};
};

/**
 * @param {object} options options
 * @param {object} options.client AI client
 * @param {object} options.vm VM
 * @param {object} options.catalog block catalog
 * @param {string} options.task one of TUTOR_TASKS
 * @param {string} [options.goal] what the student wants to make
 * @param {string} [options.question] the student's question
 * @param {?string} [options.blockId] block the student right-clicked
 * @param {string} [options.runReport] description of a test run (debug)
 * @param {object} [options.promptOptions] {level, language}
 * @param {boolean} [options.record] write the interaction to the usage log
 * @param {AbortSignal} [options.signal] cancel
 * @returns {Promise<object>} {message, question, skeleton (compiled plan scripts), missing, concepts, focus}
 */
export const askTutor = async ({
    client, vm, catalog, task, goal = '', question = '', blockId = null, runReport = '',
    promptOptions = {}, record = true, signal
}) => {
    const model = modelFromVM(vm);
    const focus = blockId ? scriptTextForBlock(vm, blockId, catalog) : null;
    const {text: projectText} = projectToText(model, {catalog, human: true});
    const response = await client.complete({
        system: buildTutorSystemPrompt({...promptOptions, catalogText: task === 'hint3' ? formatCatalog(catalog) : ''}),
        messages: [{
            role: 'user',
            content: buildTutorUserMessage({
                task,
                goal,
                question,
                projectText,
                focusText: focus ? `(${focus.targetName})\n${focus.text}` : '',
                runReport
            })
        }],
        json: true,
        maxTokens: 6000
    }, {signal});
    let answer;
    try {
        answer = extractJson(response.text);
    } catch (e) {
        answer = {message: response.text};
    }
    let skeleton = null;
    if (answer.skeleton && Array.isArray(answer.skeleton.scripts)) {
        const editing = vm.editingTarget && !vm.editingTarget.isStage ? vm.editingTarget.getName() : null;
        const compiled = compileScripts(answer.skeleton.scripts, {
            catalog, model, target: answer.skeleton.sprite || editing
        });
        // A broken skeleton is simply not shown; the written hint still helps.
        if (compiled.errors.length === 0) skeleton = compiled.plan.scripts;
    }
    if (record) {
        const prompt = question || goal || (focus ? focus.text.split('\n')[0] : '');
        recordUsage(vm, {mode: task, prompt, model: response.model});
    }
    return {
        message: String(answer.message || ''),
        question: answer.question ? String(answer.question) : '',
        skeleton,
        missing: Array.isArray(answer.missing) ? answer.missing.map(String) : [],
        concepts: Array.isArray(answer.concepts) ? answer.concepts.map(String) : [],
        focus,
        model: response.model,
        downgraded: response.downgraded
    };
};

export const hasScripts = vm => vm.runtime.targets
    .some(t => t.isOriginal && topBlocks({blocks: t.blocks._blocks}).length);
