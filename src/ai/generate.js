/**
 * The "generate blocks" flow: prompt -> model -> JSON -> compile -> (repair) -> apply.
 */
import {extractJson} from './json.js';
import {compileProgram} from './ir/compile.js';
import {OP_NAMES, applyOps} from './apply/patch.js';
import {applyPlan, restoreSnapshot, snapshotProject} from './apply/apply.js';
import {applyViaWorkspace, canApplyViaWorkspace} from './apply/workspace.js';
import {blockIdSnapshot, recordUsage} from './provenance.js';
import {modelFromVM} from './project/model.js';
import {projectToText} from './project/serialize.js';
import {formatCatalog} from './catalog/format.js';
import {
    buildGenerateSystemPrompt, buildGenerateUserMessage, buildRepairMessage, buildTestFailureMessage
} from './prompts/generate.js';

const MAX_REPAIRS = 2;

const validateOps = ops => {
    const errors = [];
    if (typeof ops === 'undefined') return errors;
    if (!Array.isArray(ops)) return [{path: 'ops', message: 'ops 必須是陣列'}];
    ops.forEach((op, i) => {
        if (!op || !OP_NAMES.includes(op.op)) {
            errors.push({path: `ops[${i}]`, message: `未知的操作 ${op && op.op}，可用：${OP_NAMES.join(', ')}`});
        }
    });
    return errors;
};

/**
 * @param {object} options options
 * @param {object} options.client AI client (providers/runner.js)
 * @param {object} options.vm VM
 * @param {object} options.catalog block catalog
 * @param {string} options.request user request
 * @param {Array} [options.history] previous messages of this conversation
 * @param {object} [options.promptOptions] {spriteLibrary, backdropLibrary, imageGeneration, level, language}
 * @param {function(string): void} [options.onStatus] progress messages
 * @param {function(object): Promise<?object>} [options.verify] test a compiled program (run/verify.js);
 *     a failed test is sent back to the AI once
 * @param {AbortSignal} [options.signal] cancel
 * @returns {Promise<object>} {type: 'question'|'program', ...}
 */
export const generate = async ({
    client, vm, catalog, request, history = [], promptOptions = {}, onStatus = () => {}, signal,
    extraInstructions = '', onBeforeFallback, verify = null
}) => {
    const model = modelFromVM(vm);
    const {text: projectText, ids} = projectToText(model, {catalog});
    const system = buildGenerateSystemPrompt({
        catalogText: formatCatalog(catalog),
        selfTest: !!verify,
        ...promptOptions
    });
    const messages = [
        ...history,
        {
            role: 'user',
            content: buildGenerateUserMessage({
                projectText,
                editingTarget: vm.editingTarget && !vm.editingTarget.isStage ? vm.editingTarget.getName() : null,
                request,
                extra: extraInstructions
            })
        }
    ];

    let lastErrors = [];
    const usage = {inputTokens: 0, outputTokens: 0, cachedTokens: 0};
    let response = null;
    let testRepairs = verify ? 1 : 0;
    let failedTest = null;
    for (let attempt = 0; attempt <= MAX_REPAIRS + (verify ? 1 : 0); attempt++) {
        if (attempt === 0) onStatus('AI 思考中…');
        else onStatus('修正中（第 {0} 次）…', [attempt]);
        response = await client.complete({system, messages, json: true, maxTokens: 16000}, {signal, onBeforeFallback});
        usage.inputTokens += (response.usage && response.usage.inputTokens) || 0;
        usage.outputTokens += (response.usage && response.usage.outputTokens) || 0;
        usage.cachedTokens += (response.usage && response.usage.cachedTokens) || 0;
        messages.push({role: 'assistant', content: response.text});

        let ir;
        try {
            ir = extractJson(response.text);
        } catch (e) {
            lastErrors = [{path: '',
                message: response.truncated ?
                    '輸出太長被截斷了，請把程式寫得更精簡。' : '輸出不是有效的 JSON。'}];
            messages.push({role: 'user', content: buildRepairMessage(lastErrors)});
            continue;
        }

        if (ir.type === 'question') {
            return {
                type: 'question',
                question: String(ir.question || ''),
                options: Array.isArray(ir.options) ? ir.options.map(String) : [],
                history: messages,
                usage,
                model: response.model,
                provider: response.provider
            };
        }

        onStatus('檢查積木…');
        const compiled = compileProgram(ir, {catalog, model});
        const errors = [...compiled.errors, ...validateOps(ir.ops)];
        if (errors.length === 0) {
            const program = {
                type: 'program',
                request,
                ir,
                plan: compiled.plan,
                ops: Array.isArray(ir.ops) ? ir.ops : [],
                aliases: ids,
                warnings: compiled.warnings,
                explanation: compiled.plan.explanation,
                history: messages,
                usage,
                model: response.model,
                provider: response.provider,
                downgraded: response.downgraded,
                verification: null
            };
            if (verify) {
                onStatus('自動測試中…');
                try {
                    program.verification = await verify(program);
                } catch (e) {
                    program.verification = {error: e.message};
                }
                const verification = program.verification;
                if (verification && verification.pass === false && testRepairs > 0) {
                    testRepairs--;
                    failedTest = verification;
                    messages.push({role: 'user', content: buildTestFailureMessage(verification)});
                    onStatus('自動測試沒通過，AI 修正中…');
                    continue;
                }
                if (failedTest && verification) verification.repaired = true;
            }
            return program;
        }
        lastErrors = errors;
        messages.push({role: 'user', content: buildRepairMessage(errors)});
        // With the economy strategy a failed answer is a reason to try a stronger model.
        if (client.escalate && promptOptions.strategy === 'economy') client.escalate();
    }
    const error = new Error(`AI 產生的積木有錯誤，修正 ${MAX_REPAIRS} 次後仍無法使用。`);
    error.details = lastErrors;
    error.history = messages;
    throw error;
};

/**
 * Summarise what a program will change, for the confirmation step.
 * @param {object} result generate() result of type 'program'
 * @returns {object} counts
 */
export const summarizeProgram = result => {
    const plan = result.plan;
    const scripts = plan.scripts.reduce((n, group) => n + group.blocks.filter(b => b.topLevel).length, 0);
    const blocks = plan.scripts.reduce((n, group) => n + group.blocks.filter(b => !b.shadow).length, 0);
    return {
        newSprites: plan.sprites.filter(s => s.isNew).map(s => s.name),
        changedSprites: plan.sprites.filter(s => !s.isNew).map(s => s.name),
        scripts,
        blocks,
        variables: plan.variables.map(v => v.name),
        broadcasts: plan.broadcasts.map(b => b.name),
        costumes: plan.sprites.reduce((n, s) => n + s.costumes.length, 0) + plan.stage.backdrops.length,
        sounds: plan.sprites.reduce((n, s) => n + s.sounds.length, 0) + (plan.stage.sounds || []).length,
        ops: result.ops.length
    };
};

/**
 * Apply a generated program to the VM. Takes a snapshot first so it can be undone.
 * @param {object} options options
 * @returns {Promise<object>} {snapshot, summary, opErrors, warnings}
 */
export const applyGenerated = async ({
    vm, catalog, result, libraries, generateImage, onStatus = () => {}, record = true
}) => {
    onStatus('儲存復原點…');
    const snapshot = await snapshotProject(vm);
    const before = blockIdSnapshot(vm);
    try {
        const warnings = [...result.warnings];
        let opErrors = [];
        if (result.ops.length) {
            onStatus('修改既有積木…');
            const opResult = await applyOps(vm, result.ops, {catalog, aliases: result.aliases});
            opErrors = opResult.errors;
            warnings.push(...opResult.warnings);
        }
        // Compile again against the project as it is now (ops may have renamed things).
        const compiled = compileProgram(result.ir, {catalog, model: modelFromVM(vm)});
        // Simple additions go through the block editor so Ctrl+Z can undo them.
        const summary = canApplyViaWorkspace(vm, compiled.plan, result.ops) ?
            await applyViaWorkspace(vm, compiled.plan) :
            await applyPlan(vm, compiled.plan, {libraries, generateImage, onProgress: onStatus});
        warnings.push(...summary.warnings);
        if (record) {
            summary.aiBlocks = recordUsage(vm, {mode: 'generate', prompt: result.request, model: result.model}, before,
                {markScripts: !summary.undoable});
        }
        return {snapshot, summary, opErrors, warnings};
    } catch (e) {
        await restoreSnapshot(vm, snapshot);
        throw e;
    }
};

export {restoreSnapshot};
