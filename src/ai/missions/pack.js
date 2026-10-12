/**
 * Mission packs (P4): a sequence of small exercises for self-study, each with a goal,
 * optional starting blocks (Parsons puzzle or bug to fix), hints and automatic checks.
 *
 * {
 *   version: 1, id, title, description,
 *   missions: [{
 *     id, title, goal,
 *     kind: 'build' | 'parsons' | 'bugfix',
 *     scripts: [ <IR script> ],        parsons: the solution (shown shuffled); bugfix: the broken code
 *     variables: [{name, value}],      global variables the starting blocks use
 *     hints: ['...', '...'],           written hints, shown before AI hints
 *     checks: [ <grading item> ],      rule / test / ai items (grade/template.js)
 *     concepts: ['loop', ...]
 *   }]
 * }
 */
import uid from '../util/uid.js';
import {normalizeTemplate} from '../grade/template.js';

export const MISSION_KINDS = {
    build: '自己完成',
    parsons: '積木排序（把打散的積木拼回去）',
    bugfix: '找錯誤（修好有問題的程式）'
};

/**
 * @param {*} json mission data
 * @param {number} index position in the pack (for default ids)
 * @returns {object} mission
 */
export const normalizeMission = (json, index = 0) => {
    const mission = json && typeof json === 'object' ? json : {};
    const kind = MISSION_KINDS[mission.kind] ? mission.kind : 'build';
    return {
        id: String(mission.id || `m${index + 1}`),
        title: String(mission.title || `任務 ${index + 1}`),
        goal: String(mission.goal || ''),
        kind,
        scripts: Array.isArray(mission.scripts) ? mission.scripts.filter(Array.isArray) : [],
        variables: (Array.isArray(mission.variables) ? mission.variables : [])
            .filter(v => v && v.name)
            .map(v => ({name: String(v.name), value: typeof v.value === 'undefined' ? 0 : v.value})),
        hints: (Array.isArray(mission.hints) ? mission.hints : []).map(String)
            .filter(Boolean),
        checks: normalizeTemplate({items: Array.isArray(mission.checks) ? mission.checks : []}).items,
        concepts: (Array.isArray(mission.concepts) ? mission.concepts : []).map(String)
    };
};

/**
 * @param {*} json pack data
 * @returns {object} pack
 */
export const normalizeMissionPack = json => {
    if (!json || typeof json !== 'object' || !Array.isArray(json.missions)) throw new Error('任務包格式不正確');
    const missions = json.missions.map(normalizeMission);
    const ids = new Set();
    missions.forEach((mission, index) => {
        if (ids.has(mission.id)) mission.id = `${mission.id}-${index + 1}`;
        ids.add(mission.id);
    });
    return {
        version: 1,
        id: String(json.id || uid()),
        title: String(json.title || '未命名任務包'),
        description: String(json.description || ''),
        missions
    };
};

/**
 * Grading template for checking one mission.
 * @param {object} mission mission
 * @returns {object} template
 */
export const missionTemplate = mission => normalizeTemplate({
    id: `mission-${mission.id}`,
    title: mission.title,
    items: mission.checks,
    scoring: 'passfail',
    studentView: 'full',
    feedbackStyle: 'student'
});

// ---- Progress (per browser) ----

const PROGRESS_KEY = 'scratchai:mission-progress';
const PACKS_KEY = 'scratchai:mission-packs';

const readJson = (key, fallback) => {
    try {
        const value = JSON.parse(window.localStorage.getItem(key) || 'null');
        return value === null ? fallback : value;
    } catch (e) {
        return fallback;
    }
};

const writeJson = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        // ignore
    }
};

/** @returns {object} {packId: {missionId: {done, hints, aiHints, checks, doneAt}}} */
export const loadProgress = () => readJson(PROGRESS_KEY, {});

/**
 * Update the progress of one mission.
 * @param {string} packId pack
 * @param {string} missionId mission
 * @param {function(object): object} change receives the old record, returns the new one
 * @returns {object} all progress
 */
export const updateProgress = (packId, missionId, change) => {
    const all = loadProgress();
    const pack = all[packId] || {};
    pack[missionId] = change(pack[missionId] || {done: false, hints: 0, aiHints: 0, checks: 0});
    all[packId] = pack;
    writeJson(PROGRESS_KEY, all);
    return all;
};

/**
 * Packs the student added (imported or made with AI).
 * @returns {object[]} packs
 */
export const loadSavedPacks = () => {
    const packs = readJson(PACKS_KEY, []);
    if (!Array.isArray(packs)) return [];
    return packs.map(pack => {
        try {
            return normalizeMissionPack(pack);
        } catch (e) {
            return null;
        }
    }).filter(Boolean);
};

export const savePacks = packs => writeJson(PACKS_KEY, packs);

export const PRACTICE_PACK_ID = 'my-practice';
