/**
 * Grading templates (docs/SPEC.md §7.1).
 */
import uid from '../util/uid.js';

export const STUDENT_VIEWS = {
    full: '完整：結果、評語與積木標示',
    itemResult: '只看每一項的結果',
    countOnly: '只顯示通過幾項（或總分）',
    hidden: '不開放學生自我檢查'
};

export const ITEM_TYPES = {
    rule: '規則檢查',
    ai: 'AI 判斷',
    test: '執行測試'
};

export const SCORING = {
    points: '分數',
    passfail: '通過／不通過'
};

/**
 * @param {*} json template data
 * @returns {object} normalized template
 */
export const normalizeTemplate = json => {
    if (!json || typeof json !== 'object') throw new Error('範本格式不正確');
    const items = (Array.isArray(json.items) ? json.items : []).map((item, index) => {
        const type = ITEM_TYPES[item.type] ? item.type : 'ai';
        const normalized = {
            id: String(item.id || `item${index + 1}`),
            type,
            desc: String(item.desc || item.description || ''),
            points: Number.isFinite(Number(item.points)) ? Number(item.points) : 10,
            check: type === 'rule' ? (item.check || {}) : null
        };
        if (type === 'test') normalized.test = item.test && typeof item.test === 'object' ? item.test : {expect: []};
        return normalized;
    });
    const ids = new Set();
    items.forEach((item, index) => {
        if (ids.has(item.id)) item.id = `${item.id}-${index + 1}`;
        ids.add(item.id);
    });
    return {
        id: String(json.id || uid()),
        title: String(json.title || '未命名範本'),
        version: Number(json.version) || 1,
        items,
        scoring: json.scoring === 'passfail' ? 'passfail' : 'points',
        passThreshold: json.passThreshold !== null && json.passThreshold !== '' &&
            Number.isFinite(Number(json.passThreshold)) ? Number(json.passThreshold) : null,
        studentView: STUDENT_VIEWS[json.studentView] ? json.studentView : 'itemResult',
        feedbackStyle: json.feedbackStyle === 'teacher' ? 'teacher' : 'student',
        notes: String(json.notes || '')
    };
};

export const emptyTemplate = () => normalizeTemplate({
    title: '新範本',
    items: [{id: 'r1', type: 'rule', desc: '使用「當綠旗被點擊」', points: 20, check: {usesOpcode: 'event_whenflagclicked'}}]
});

const KEY = 'scratchai:templates';

export const loadTemplates = () => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) || '[]');
        return Array.isArray(saved) ? saved.map(normalizeTemplate) : [];
    } catch (e) {
        return [];
    }
};

export const saveTemplates = templates => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(templates));
    } catch (e) {
        // ignore
    }
};
