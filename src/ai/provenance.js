/**
 * AI usage records (docs/SPEC.md, P2). Two visible markers are kept inside the project:
 *  - a minimized "🤖 AI" comment on the top block of every script the AI created, and
 *  - a minimized comment on the Stage holding the usage log as JSON, including the ids of
 *    every block the AI created, so grading can compute how much of a project is AI made.
 * Both live in the project file, so they travel with it. They can be deleted by hand;
 * they are a reminder for honest use, not a security measure.
 */
import uid from './util/uid.js';
import {getStage} from './project/model.js';

export const LOG_COMMENT_ID = 'scratchai-usage-log';
const LOG_HEADER = '🤖 AI 使用紀錄（自動產生，請勿修改） / AI usage log (automatic, do not edit)';
export const SCRIPT_MARK = '🤖 AI';
const MAX_ENTRIES = 200;
const MAX_PROMPT = 200;

export const emptyLog = () => ({version: 2, entries: []});

const parseLogText = text => {
    if (typeof text !== 'string') return null;
    const start = text.indexOf('{');
    if (start === -1) return null;
    try {
        const log = JSON.parse(text.slice(start));
        if (!log || !Array.isArray(log.entries)) return null;
        return {...emptyLog(), entries: log.entries};
    } catch (e) {
        return null;
    }
};

/**
 * @param {object} model project model (with comments)
 * @returns {object} usage log (empty when the project has none)
 */
export const readLogFromModel = model => {
    const stage = getStage(model);
    const comment = stage && (stage.comments || []).find(c => c.id === LOG_COMMENT_ID ||
        (typeof c.text === 'string' && c.text.startsWith('🤖 AI 使用紀錄')));
    return (comment && parseLogText(comment.text)) || emptyLog();
};

const findLogComment = stage => stage.comments[LOG_COMMENT_ID] ||
    Object.values(stage.comments).find(c => typeof c.text === 'string' && c.text.startsWith('🤖 AI 使用紀錄'));

/**
 * @param {object} vm VM
 * @returns {object} usage log of the open project
 */
export const readLog = vm => {
    const stage = vm.runtime.getTargetForStage();
    const comment = stage && findLogComment(stage);
    return (comment && parseLogText(comment.text)) || emptyLog();
};

const writeLog = (vm, log) => {
    const stage = vm.runtime.getTargetForStage();
    if (!stage) return;
    log.entries = log.entries.slice(-MAX_ENTRIES);
    const text = `${LOG_HEADER}\n${JSON.stringify(log)}`;
    const comment = findLogComment(stage);
    if (comment) {
        comment.text = text;
    } else {
        stage.createComment(LOG_COMMENT_ID, null, text, -400, 0, 300, 200, true);
    }
    vm.runtime.emitProjectChanged();
};

/**
 * Remember which non-shadow blocks exist now, to find what an AI change added.
 * @param {object} vm VM
 * @returns {Map<string, Set<string>>} target name to block ids
 */
export const blockIdSnapshot = vm => {
    const result = new Map();
    for (const target of vm.runtime.targets.filter(t => t.isOriginal)) {
        const name = target.isStage ? '__stage__' : target.getName();
        result.set(name, new Set(Object.keys(target.blocks._blocks)));
    }
    return result;
};

/**
 * Text of the marker comment: "🤖 AI · 6 · 2026-10-12". The number is how many blocks
 * the AI made in this chunk, so the share can be computed later without block ids
 * (TurboWarp renames block ids when saving).
 * @param {number} count blocks in the chunk
 * @returns {string} comment text
 */
export const markerText = count => `${SCRIPT_MARK} · ${count} · ${new Date().toISOString()
    .slice(0, 10)}`;

const parseMarker = text => {
    if (typeof text !== 'string' || !text.startsWith(SCRIPT_MARK)) return null;
    const match = /·\s*(\d+)/.exec(text);
    return match ? Number(match[1]) : null;
};

/**
 * Non-shadow blocks reachable from a block through inputs and next.
 * @param {object} blocks block map
 * @param {string} rootId first block
 * @param {function(object): boolean} [accept] stop at blocks this rejects
 * @returns {Array<object>} blocks
 */
const chunkBlocks = (blocks, rootId, accept = () => true) => {
    const result = [];
    const visit = id => {
        const block = blocks[id];
        if (!block || !accept(block)) return;
        if (!block.shadow) result.push(block);
        for (const input of Object.values(block.inputs || {})) {
            if (input.block) visit(input.block);
        }
        if (block.next) visit(block.next);
    };
    visit(rootId);
    return result;
};

/**
 * Add a minimized marker comment to the first block of every chunk the AI added.
 * @param {object} target VM target
 * @param {Set<string>} newIds ids of blocks the AI added to this target
 */
const markNewChunks = (target, newIds) => {
    const blocks = target.blocks._blocks;
    for (const id of newIds) {
        const block = blocks[id];
        if (!block || block.shadow || block.comment) continue;
        if (block.parent && newIds.has(block.parent)) continue;
        const count = chunkBlocks(blocks, id, b => newIds.has(b.id)).length;
        const x = (block.x || 0) + 220;
        target.createComment(uid(), id, markerText(count), x, block.y || 0, 160, 32, true);
    }
};

/**
 * Record one AI interaction. For changes to the project pass the snapshot taken before
 * the change; new blocks are then attributed to the AI and marked.
 * @param {object} vm VM
 * @param {object} entry {mode, prompt, model, provider}
 * @param {?Map<string, Set<string>>} before result of blockIdSnapshot() before the change
 * @param {object} [options] {markScripts: add "🤖 AI" comments (false when the editor already did)}
 * @returns {number} number of blocks attributed to the AI
 */
export const recordUsage = (vm, entry, before = null, {markScripts = true} = {}) => {
    const log = readLog(vm);
    let added = 0;
    if (before) {
        for (const target of vm.runtime.targets.filter(t => t.isOriginal)) {
            const name = target.isStage ? '__stage__' : target.getName();
            const previous = before.get(name) || new Set();
            const newIds = Object.values(target.blocks._blocks)
                .filter(b => !previous.has(b.id))
                .map(b => b.id);
            const counted = newIds.filter(id => !target.blocks._blocks[id].shadow);
            if (counted.length) {
                added += counted.length;
                if (markScripts) markNewChunks(target, new Set(newIds));
            }
        }
    }
    log.entries.push({
        t: new Date().toISOString(),
        mode: entry.mode,
        prompt: String(entry.prompt || '').slice(0, MAX_PROMPT),
        model: entry.model || '',
        blocks: added
    });
    writeLog(vm, log);
    // Reloading the workspace clears its undo history, so only do it when the editor
    // would otherwise show stale comments.
    const editing = vm.editingTarget;
    if (editing && (editing.isStage || (markScripts && added))) vm.emitWorkspaceUpdate();
    return added;
};

/**
 * How much of a project was made by the AI, from the marker comments.
 * @param {object} model project model
 * @returns {object} {share, aiBlocks, totalBlocks, generations, tutorCount, lastUsed, entries}
 */
export const aiUsageSummary = model => {
    let total = 0;
    let ai = 0;
    for (const target of model.targets) {
        total += Object.values(target.blocks).filter(b => !b.shadow).length;
        for (const comment of target.comments || []) {
            const count = parseMarker(comment.text);
            if (count === null || !comment.blockId || !target.blocks[comment.blockId]) continue;
            // Blocks the student removed no longer count; blocks they added are not AI made.
            ai += Math.min(count, chunkBlocks(target.blocks, comment.blockId).length);
        }
    }
    ai = Math.min(ai, total);
    const entries = readLogFromModel(model).entries || [];
    return {
        share: total ? ai / total : 0,
        aiBlocks: ai,
        totalBlocks: total,
        generations: entries.filter(e => e.mode === 'generate').length,
        tutorCount: entries.filter(e => e.mode !== 'generate' && !String(e.mode).startsWith('mission')).length,
        lastUsed: entries.length ? entries[entries.length - 1].t : null,
        entries
    };
};
