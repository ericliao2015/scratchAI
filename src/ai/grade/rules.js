/**
 * Rule checks: deterministic, free grading items (docs/SPEC.md §7.1).
 */
import {findTarget, getStage, topBlocks} from '../project/model.js';

const LOOPS = ['control_repeat', 'control_forever', 'control_repeat_until', 'control_while', 'control_for_each'];
const CONDITIONS = ['control_if', 'control_if_else', 'control_wait_until', 'control_repeat_until', 'control_while'];
const BROADCAST_SENDERS = ['event_broadcast', 'event_broadcastandwait'];

const asList = value => (Array.isArray(value) ? value : [value]);

const targetsFor = (model, check) => {
    if (typeof check.sprite === 'undefined') return model.targets;
    const target = findTarget(model, check.sprite);
    return target ? [target] : [];
};

const blocksOf = targets => targets.flatMap(t => Object.values(t.blocks)
    .filter(b => !b.shadow)
    .map(b => ({block: b, target: t})));

/**
 * Blocks that are part of a script (loose blocks without a hat never run).
 * @param {Array} targets targets to search
 * @returns {Array<{block, target}>} blocks
 */
const reachableBlocks = targets => {
    const result = [];
    for (const target of targets) {
        const blocks = target.blocks;
        for (const top of topBlocks(target)) {
            const visit = id => {
                const block = blocks[id];
                if (!block) return;
                if (!block.shadow) result.push({block, target});
                for (const input of Object.values(block.inputs)) {
                    if (input.block) visit(input.block);
                }
                if (block.next) visit(block.next);
            };
            visit(top.id);
        }
    }
    return result;
};

const broadcastName = (target, model, block) => {
    if (block.fields.BROADCAST_OPTION) return block.fields.BROADCAST_OPTION.value;
    const input = block.inputs.BROADCAST_INPUT;
    const menu = input && target.blocks[input.block];
    if (menu && menu.fields.BROADCAST_OPTION) return menu.fields.BROADCAST_OPTION.value;
    return null;
};

const result = (pass, detail, matches = []) => ({
    pass,
    detail,
    evidence: matches.slice(0, 10).map(m => ({blockId: m.block.id, target: m.target.name}))
});

export const RULES = {
    usesOpcode (model, check) {
        const opcodes = asList(check.usesOpcode);
        const found = reachableBlocks(targetsFor(model, check)).filter(m => opcodes.includes(m.block.opcode));
        const min = check.min || 1;
        return result(found.length >= min, found.length ? `找到 ${found.length} 個` : '沒有找到', found);
    },
    usesAllOpcodes (model, check) {
        const found = reachableBlocks(targetsFor(model, check));
        const missing = asList(check.usesAllOpcodes).filter(op => !found.some(m => m.block.opcode === op));
        return result(missing.length === 0, missing.length ? `缺少：${missing.join(', ')}` : '全部都有',
            found.filter(m => asList(check.usesAllOpcodes).includes(m.block.opcode)));
    },
    variableExists (model, check) {
        const names = asList(check.variableExists);
        const all = model.targets.flatMap(t => t.variables.filter(v => v.type === ''));
        const missing = names.filter(n => !all.some(v => v.name === n));
        return result(missing.length === 0, missing.length ? `找不到變數：${missing.join('、')}` : '變數存在');
    },
    listExists (model, check) {
        const names = asList(check.listExists);
        const all = model.targets.flatMap(t => t.variables.filter(v => v.type === 'list'));
        const missing = names.filter(n => !all.some(v => v.name === n));
        return result(missing.length === 0, missing.length ? `找不到清單：${missing.join('、')}` : '清單存在');
    },
    spriteCount (model, check) {
        const count = model.targets.filter(t => !t.isStage).length;
        const {min = 0, max = Infinity} = check.spriteCount || {};
        return result(count >= min && count <= max, `共有 ${count} 個角色`);
    },
    spriteExists (model, check) {
        const missing = asList(check.spriteExists).filter(name => !findTarget(model, name));
        return result(missing.length === 0, missing.length ? `找不到角色：${missing.join('、')}` : '角色存在');
    },
    costumeCount (model, check) {
        const targets = targetsFor(model, check).filter(t => !t.isStage);
        const min = (check.costumeCount && check.costumeCount.min) || Number(check.costumeCount) || 1;
        const ok = targets.length > 0 && targets.every(t => t.costumes.length >= min);
        return result(ok, targets.map(t => `${t.name}：${t.costumes.length} 個造型`).join('、') || '沒有角色');
    },
    backdropCount (model, check) {
        const stage = getStage(model);
        const min = Number(check.backdropCount) || 1;
        return result(stage.costumes.length >= min, `共有 ${stage.costumes.length} 個背景`);
    },
    broadcastUsed (model, check) {
        const wanted = check.broadcastUsed === true ? null : String(check.broadcastUsed);
        const found = reachableBlocks(model.targets);
        const sent = found.filter(m => BROADCAST_SENDERS.includes(m.block.opcode))
            .map(m => ({...m, name: broadcastName(m.target, model, m.block)}));
        const received = found.filter(m => m.block.opcode === 'event_whenbroadcastreceived')
            .map(m => ({...m, name: broadcastName(m.target, model, m.block)}));
        const pairs = sent.filter(s => received.some(r => r.name === s.name) && (!wanted || s.name === wanted));
        const ok = pairs.length > 0;
        return result(ok, ok ? `廣播「${pairs[0].name}」有送出也有接收` :
            (sent.length ? '有送出廣播，但沒有對應的「當收到訊息」' : '沒有使用廣播'),
        [...pairs, ...received.filter(r => pairs.some(p => p.name === r.name))]);
    },
    hasLoop (model, check) {
        const found = reachableBlocks(targetsFor(model, check)).filter(m => LOOPS.includes(m.block.opcode));
        return result(found.length > 0, found.length ? `使用了 ${found.length} 個迴圈` : '沒有使用迴圈', found);
    },
    hasCondition (model, check) {
        const found = reachableBlocks(targetsFor(model, check)).filter(m => CONDITIONS.includes(m.block.opcode));
        return result(found.length > 0, found.length ? `使用了 ${found.length} 個條件判斷` : '沒有使用條件判斷', found);
    },
    blockCount (model, check) {
        const count = reachableBlocks(targetsFor(model, check)).length;
        const min = (check.blockCount && check.blockCount.min) || Number(check.blockCount) || 1;
        return result(count >= min, `共有 ${count} 個積木`);
    },
    scriptCount (model, check) {
        // Scripts that can run: they start with an event (hat) block or define a custom block.
        const count = targetsFor(model, check).reduce((n, t) => n + topBlocks(t)
            .filter(b => /_when|start_as_clone|procedures_definition/i.test(b.opcode)).length, 0);
        const min = (check.scriptCount && check.scriptCount.min) || Number(check.scriptCount) || 1;
        return result(count >= min, `共有 ${count} 段腳本`);
    },
    customBlockDefined (model, check) {
        const found = blocksOf(targetsFor(model, check)).filter(m => m.block.opcode === 'procedures_definition');
        const ok = found.length > 0;
        return result(ok, ok ? `定義了 ${found.length} 個自訂積木` : '沒有自訂積木', found);
    },
    customBlockUsed (model, check) {
        const found = reachableBlocks(targetsFor(model, check)).filter(m => m.block.opcode === 'procedures_call');
        return result(found.length > 0, found.length ? `呼叫了 ${found.length} 次自訂積木` : '沒有呼叫自訂積木', found);
    },
    usesExtension (model, check) {
        const ids = asList(check.usesExtension);
        const found = reachableBlocks(model.targets).filter(m => ids.some(id => m.block.opcode.startsWith(`${id}_`)));
        return result(found.length > 0, found.length ? `使用了 ${ids.join('、')} 擴充` : `沒有使用 ${ids.join('、')} 擴充`, found);
    },
    usesClone (model) {
        const found = reachableBlocks(model.targets).filter(m => m.block.opcode === 'control_create_clone_of' ||
            m.block.opcode === 'control_start_as_clone');
        const ok = found.some(m => m.block.opcode === 'control_create_clone_of');
        return result(ok, ok ? '有建立分身' : '沒有建立分身', found);
    }
};

export const RULE_DESCRIPTIONS = {
    usesOpcode: '使用某個積木（opcode，可給陣列表示任一個）',
    usesAllOpcodes: '同時使用這些積木',
    variableExists: '有某個變數',
    listExists: '有某個清單',
    spriteCount: '角色數量 {min, max}',
    spriteExists: '有某個角色',
    costumeCount: '角色的造型數量 {min}',
    backdropCount: '背景數量（最少）',
    broadcastUsed: '廣播有送出也有接收（true 或訊息名稱）',
    hasLoop: '使用迴圈',
    hasCondition: '使用條件判斷',
    blockCount: '積木總數 {min}',
    scriptCount: '腳本數量 {min}',
    customBlockDefined: '定義自訂積木',
    customBlockUsed: '呼叫自訂積木',
    usesExtension: '使用某個擴充（如 pen、music）',
    usesClone: '使用分身'
};

/**
 * Run one rule check.
 * @param {object} model project model
 * @param {object} check rule object, e.g. {usesOpcode: 'event_whenflagclicked', sprite: 'Cat'}
 * @returns {{pass: boolean, detail: string, evidence: Array}} result
 */
export const runRule = (model, check) => {
    const name = Object.keys(check || {}).find(key => RULES[key]);
    if (!name) return {pass: false, detail: `不認得的規則：${JSON.stringify(check)}`, evidence: [], invalid: true};
    if (typeof check.sprite !== 'undefined' && !findTarget(model, check.sprite)) {
        return {pass: false, detail: `找不到角色「${check.sprite}」`, evidence: []};
    }
    return RULES[name](model, check);
};
