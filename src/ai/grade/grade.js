/**
 * Grade one project against a template: rule items locally, AI items with one model call.
 */
import {extractJson} from '../json.js';
import {ProjectSerializer, projectToText, targetOfBlock} from '../project/serialize.js';
import {runRule} from './rules.js';
import {aiUsageSummary} from '../provenance.js';
import {normalizeTemplate} from './template.js';
import {normalizeTest} from '../run/verify.js';
import {buildGradeSystemPrompt, buildGradeUserMessage, buildTemplateDraftPrompt} from '../prompts/grade.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const hashText = async text => {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

const cache = new Map();

/**
 * Run a "test" item: points in proportion to the expectations that hold.
 * @param {object} item template item with .test
 * @param {?function} runTest runner
 * @returns {Promise<object>} {pass, score, reason, evidence, run}
 */
const gradeTestItem = async (item, runTest) => {
    const test = normalizeTest(item.test);
    if (!test) return {pass: false, score: 0, reason: '這個測試項目沒有設定檢查條件', evidence: []};
    if (!runTest) return {pass: false, score: 0, reason: '無法在這裡執行測試', evidence: []};
    try {
        const run = await runTest(test);
        const failed = run.results.filter(r => !r.pass);
        const reason = failed.length ?
            failed.map(r => `✗ ${r.label}（實際：${r.actual}）`).join('；') :
            run.results.map(r => `✓ ${r.label}`).join('；');
        return {
            pass: run.pass,
            score: Math.round(item.points * run.passed / Math.max(run.total, 1) * 10) / 10,
            reason,
            evidence: [],
            run: {passed: run.passed, total: run.total, results: run.results, report: run.report}
        };
    } catch (e) {
        return {pass: false, score: 0, reason: `執行測試失敗：${e.message}`, evidence: []};
    }
};

/**
 * @param {object} options options
 * @param {object} options.model project model
 * @param {object} options.template grading template
 * @param {?object} options.client AI client (needed only for AI items)
 * @param {?object} [options.catalog] block catalog (for readable evidence)
 * @param {string} [options.language] feedback language
 * @param {function} [options.onBeforeFallback] passed to the client (batch "pause on downgrade")
 * @param {function(object): Promise<object>} [options.runTest] runs a "test" item (run/verify.js runTest)
 * @param {AbortSignal} [options.signal] cancel
 * @returns {Promise<object>} grading result
 */
export const gradeProject = async ({
    model, template: rawTemplate, client, catalog = null, language = '繁體中文', onBeforeFallback, signal,
    runTest = null
}) => {
    const template = normalizeTemplate(rawTemplate);
    const {text: projectText, ids, aliases} = projectToText(model, {catalog});
    // Readable text of a block for reports, e.g. "when green flag clicked" or its opcode.
    const human = new ProjectSerializer({catalog, human: true});
    const describe = (targetName, blockId) => {
        const target = model.targets.find(t => t.name === targetName && t.blocks[blockId]) ||
            targetOfBlock(model, blockId);
        const block = target && target.blocks[blockId];
        if (!block) return '';
        try {
            return human.callText(target.blocks, block).slice(0, 80);
        } catch (e) {
            return block.opcode;
        }
    };
    const evidenceOf = (blockId, targetName) => ({
        alias: aliases[blockId] || null,
        blockId,
        target: targetName,
        text: describe(targetName, blockId)
    });
    const items = [];
    let summary = '';
    let modelInfo = null;

    for (const item of template.items) {
        if (item.type !== 'rule') continue;
        const outcome = runRule(model, item.check);
        items.push({
            ...item,
            pass: outcome.pass,
            score: outcome.pass ? item.points : 0,
            reason: outcome.detail,
            evidence: outcome.evidence.map(e => evidenceOf(e.blockId, e.target))
        });
    }

    for (const item of template.items) {
        if (item.type !== 'test') continue;
        items.push({...item, ...await gradeTestItem(item, runTest)});
    }

    const aiItems = template.items.filter(item => item.type === 'ai');
    if (aiItems.length) {
        if (!client) throw new Error('這個範本有 AI 判斷項目，需要先設定 AI 模型。');
        const system = buildGradeSystemPrompt({feedbackStyle: template.feedbackStyle, language});
        const user = buildGradeUserMessage({projectText, items: aiItems, notes: template.notes});
        const key = await hashText(`${system}\n${user}`);
        let parsed = key && cache.get(key);
        if (!parsed) {
            const response = await client.complete({
                system, messages: [{role: 'user', content: user}], json: true, maxTokens: 8000
            }, {signal, onBeforeFallback});
            parsed = extractJson(response.text);
            parsed.__model = {model: response.model, provider: response.provider, downgraded: response.downgraded};
            if (key) cache.set(key, parsed);
        }
        modelInfo = parsed.__model || null;
        summary = typeof parsed.summary === 'string' ? parsed.summary : '';
        const answers = Array.isArray(parsed.results) ? parsed.results : [];
        for (const item of aiItems) {
            const answer = answers.find(a => String(a.id) === item.id) || null;
            const pass = !!(answer && answer.pass);
            const score = answer && Number.isFinite(Number(answer.score)) ?
                clamp(Number(answer.score), 0, item.points) : (pass ? item.points : 0);
            items.push({
                ...item,
                pass,
                score,
                reason: answer ? String(answer.reason || '') : 'AI 沒有回覆這一項',
                evidence: (answer && Array.isArray(answer.evidence) ? answer.evidence : [])
                    .map(alias => {
                        const blockId = ids[alias];
                        const target = blockId && targetOfBlock(model, blockId);
                        return blockId && target ? evidenceOf(blockId, target.name) : null;
                    })
                    .filter(Boolean)
            });
        }
    }

    // Keep the template's order.
    items.sort((a, b) => template.items.findIndex(i => i.id === a.id) - template.items.findIndex(i => i.id === b.id));
    const passedCount = items.filter(i => i.pass).length;
    const total = items.reduce((n, i) => n + i.score, 0);
    const max = items.reduce((n, i) => n + i.points, 0);
    const threshold = template.passThreshold === null ? items.length : template.passThreshold;
    return {
        template: {
            id: template.id,
            title: template.title,
            scoring: template.scoring,
            studentView: template.studentView
        },
        items,
        passedCount,
        itemCount: items.length,
        total,
        max,
        overallPass: passedCount >= threshold,
        ai: (({share, aiBlocks, totalBlocks, generations, tutorCount}) => ({
            share, aiBlocks, totalBlocks, generations, tutorCount
        }))(aiUsageSummary(model)),
        summary,
        model: modelInfo
    };
};

/**
 * Hide details according to the template's studentView setting.
 * @param {object} result grading result
 * @returns {object} what the student may see
 */
export const studentViewOf = result => {
    const view = result.template.studentView;
    if (view === 'full') return result;
    if (view === 'countOnly') {
        return {...result, items: [], summary: ''};
    }
    return {
        ...result,
        summary: '',
        items: result.items.map(item => ({...item, reason: '', evidence: [], run: null}))
    };
};

/**
 * Turn free-text criteria into a template draft.
 * @param {object} options {client, text, language}
 * @returns {Promise<object>} normalized template
 */
export const draftTemplate = async ({client, text, language = '繁體中文', signal}) => {
    const response = await client.complete({
        system: buildTemplateDraftPrompt({language}),
        messages: [{role: 'user', content: text}],
        json: true,
        maxTokens: 8000
    }, {signal});
    const draft = extractJson(response.text);
    return normalizeTemplate({...draft, notes: text});
};
