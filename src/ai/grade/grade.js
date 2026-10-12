/**
 * Grade one project against a template: rule items locally, AI items with one model call.
 */
import {extractJson} from '../json.js';
import {projectToText, targetOfBlock} from '../project/serialize.js';
import {runRule} from './rules.js';
import {normalizeTemplate} from './template.js';
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
 * @param {object} options options
 * @param {object} options.model project model
 * @param {object} options.template grading template
 * @param {?object} options.client AI client (needed only for AI items)
 * @param {?object} [options.catalog] block catalog (for readable evidence)
 * @param {string} [options.language] feedback language
 * @param {function} [options.onBeforeFallback] passed to the client (batch "pause on downgrade")
 * @param {AbortSignal} [options.signal] cancel
 * @returns {Promise<object>} grading result
 */
export const gradeProject = async ({
    model, template: rawTemplate, client, catalog = null, language = '繁體中文', onBeforeFallback, signal
}) => {
    const template = normalizeTemplate(rawTemplate);
    const {text: projectText, ids} = projectToText(model, {catalog});
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
            evidence: outcome.evidence.map(e => ({...e, alias: null}))
        });
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
                        return blockId && target ? {alias, blockId, target: target.name} : null;
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
        template: {id: template.id, title: template.title, scoring: template.scoring, studentView: template.studentView},
        items,
        passedCount,
        itemCount: items.length,
        total,
        max,
        overallPass: passedCount >= threshold,
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
        items: result.items.map(item => ({...item, reason: '', evidence: []}))
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
