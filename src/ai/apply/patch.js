/**
 * Patch operations: modify an existing project (docs/SPEC.md §6.5). Used both when the
 * AI edits the open project and for batch modification of many files.
 *
 * Block references are either an alias from the project text ("#12"), a real block
 * id, or a matcher object {opcode, fields?, inputs?, index?} for edits that must work
 * on many different projects.
 */
import {PRIMITIVE_SHADOWS} from '../catalog/catalog.js';
import {compileStackForInsert, compileValue} from '../ir/compile.js';
import {modelFromVM} from '../project/model.js';
import {createDeclarations, targetResolver} from './apply.js';
import uid from '../util/uid.js';

export const OP_NAMES = [
    'deleteScript', 'deleteBlock', 'replaceBlock', 'insertAfter', 'insertInto',
    'setInput', 'setField', 'renameVariable', 'renameSprite', 'deleteSprite', 'setProperty'
];

class PatchError extends Error {}

const findTarget = (vm, name) => {
    if (typeof name === 'undefined' || name === null || name === 'Stage' || name === '舞台') {
        return vm.runtime.getTargetForStage();
    }
    const target = vm.runtime.targets.find(t => t.isOriginal && !t.isStage && t.getName() === name);
    if (!target) throw new PatchError(`找不到角色「${name}」`);
    return target;
};

const literalOf = (blocks, input) => {
    const shadow = input && input.block && blocks[input.block];
    if (!shadow || !shadow.shadow) return null;
    const primitive = PRIMITIVE_SHADOWS[shadow.opcode];
    const field = primitive ? shadow.fields[primitive[0]] : Object.values(shadow.fields)[0];
    return field ? field.value : null;
};

const matches = (blocks, block, matcher) => {
    if (matcher.opcode && block.opcode !== matcher.opcode) return false;
    for (const [name, value] of Object.entries(matcher.fields || {})) {
        if (!block.fields[name] || String(block.fields[name].value) !== String(value)) return false;
    }
    for (const [name, value] of Object.entries(matcher.inputs || {})) {
        if (String(literalOf(blocks, block.inputs[name])) !== String(value)) return false;
    }
    if (matcher.proccode && !(block.mutation && block.mutation.proccode === matcher.proccode)) return false;
    return true;
};

/**
 * Resolve a block reference to block ids in a target.
 * @param {object} target VM target
 * @param {string|object} ref reference
 * @param {object} aliases map of "#n" to block id
 * @returns {string[]} matching block ids (never empty)
 */
export const resolveBlockRef = (target, ref, aliases = {}) => {
    const blocks = target.blocks._blocks;
    if (typeof ref === 'string') {
        const id = aliases[ref] || ref;
        if (!blocks[id]) throw new PatchError(`在「${target.getName()}」找不到積木 ${ref}`);
        return [id];
    }
    if (ref && typeof ref === 'object') {
        const found = Object.values(blocks)
            .filter(b => !b.shadow && matches(blocks, b, ref))
            .sort((a, b) => (a.topLevel === b.topLevel ? 0 : (a.topLevel ? -1 : 1)))
            .map(b => b.id);
        if (found.length === 0) throw new PatchError(`在「${target.getName()}」找不到符合 ${JSON.stringify(ref)} 的積木`);
        if (ref.all) return found;
        return [found[Math.min(Number(ref.index) || 0, found.length - 1)]];
    }
    throw new PatchError('需要指定積木（#編號或比對條件）');
};

const topOf = (blocks, id) => {
    let block = blocks[id];
    while (block && block.parent) block = blocks[block.parent];
    return block;
};

const lastOf = (blocks, id) => {
    let block = blocks[id];
    while (block && block.next) block = blocks[block.next];
    return block;
};

/**
 * Where a block is attached: as next of a block, inside an input, or top level.
 * @param {object} blocks block map
 * @param {object} block block
 * @returns {object} {kind, parent?, input?}
 */
const attachment = (blocks, block) => {
    if (!block.parent) return {kind: 'top'};
    const parent = blocks[block.parent];
    if (parent.next === block.id) return {kind: 'next', parent};
    const input = Object.values(parent.inputs).find(i => i.block === block.id);
    return input ? {kind: 'input', parent, input} : {kind: 'top'};
};

const isReporterBlock = (catalog, block) => {
    if (/^(data_variable|data_listcontents|argument_reporter_)/.test(block.opcode)) return true;
    const entry = catalog.blocks[block.opcode];
    return !!entry && (entry.shape === 'reporter' || entry.shape === 'boolean');
};

/**
 * Remove one block from its stack, reconnecting the blocks after it.
 * @param {object} container target.blocks
 * @param {string} id block id
 */
const detachSingle = (container, id) => {
    const blocks = container._blocks;
    const block = blocks[id];
    const next = block.next ? blocks[block.next] : null;
    const where = attachment(blocks, block);
    if (where.kind === 'next') {
        where.parent.next = next ? next.id : null;
        if (next) next.parent = where.parent.id;
    } else if (where.kind === 'input') {
        where.input.block = next ? next.id : null;
        if (next) next.parent = where.parent.id;
    } else {
        container._deleteScript(id);
        if (next) {
            next.parent = null;
            next.topLevel = true;
            next.x = block.x;
            next.y = block.y;
            container._addScript(next.id);
        }
    }
    block.next = null;
    block.parent = null;
    block.topLevel = true;
};

const createCompiled = (container, blocks) => {
    for (const block of blocks) {
        container.createBlock({...block, topLevel: false});
    }
};

const insertStackAfter = (container, afterId, firstId) => {
    const blocks = container._blocks;
    const after = blocks[afterId];
    const oldNext = after.next;
    const last = lastOf(blocks, firstId);
    after.next = firstId;
    blocks[firstId].parent = afterId;
    last.next = oldNext;
    if (oldNext) blocks[oldNext].parent = last.id;
};

const insertStackInto = (container, parentId, inputName, firstId) => {
    const blocks = container._blocks;
    const parent = blocks[parentId];
    const input = parent.inputs[inputName] || {name: inputName, block: null, shadow: null};
    parent.inputs[inputName] = input;
    const oldFirst = input.block;
    const last = lastOf(blocks, firstId);
    input.block = firstId;
    blocks[firstId].parent = parentId;
    last.next = oldFirst;
    if (oldFirst) blocks[oldFirst].parent = last.id;
};

const OPS = {
    deleteScript (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        for (const id of resolveBlockRef(target, op.block || op.match, ctx.aliases)) {
            const top = topOf(target.blocks._blocks, id);
            if (top) target.blocks.deleteBlock(top.id);
        }
    },

    deleteBlock (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        for (const id of resolveBlockRef(target, op.block || op.match, ctx.aliases)) {
            const block = target.blocks._blocks[id];
            if (!block) continue;
            if (block.shadow || isReporterBlock(ctx.catalog, block)) {
                throw new PatchError(`${JSON.stringify(op.block || op.match)} 不是堆疊積木，請改用 setInput`);
            }
            detachSingle(target.blocks, id);
            target.blocks.deleteBlock(id);
        }
    },

    replaceBlock (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        const [id] = resolveBlockRef(target, op.block || op.match, ctx.aliases);
        const blocks = target.blocks._blocks;
        const old = blocks[id];
        const where = attachment(blocks, old);
        const compiled = ctx.compileStack(target, op.with || op.blocks);
        createCompiled(target.blocks, compiled.blocks);
        const first = blocks[compiled.firstId];
        if (where.kind === 'top') {
            first.topLevel = true;
            first.x = old.x;
            first.y = old.y;
            first.parent = null;
            const last = lastOf(blocks, compiled.firstId);
            last.next = old.next;
            if (old.next) blocks[old.next].parent = last.id;
            old.next = null;
            target.blocks._deleteScript(id);
            target.blocks._addScript(compiled.firstId);
            target.blocks.deleteBlock(id);
            return;
        }
        detachSingle(target.blocks, id);
        if (where.kind === 'next') {
            insertStackAfter(target.blocks, where.parent.id, compiled.firstId);
        } else {
            insertStackInto(target.blocks, where.parent.id, where.input.name, compiled.firstId);
        }
        target.blocks.deleteBlock(id);
    },

    insertAfter (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        const [id] = resolveBlockRef(target, op.block || op.match, ctx.aliases);
        const compiled = ctx.compileStack(target, op.blocks);
        createCompiled(target.blocks, compiled.blocks);
        insertStackAfter(target.blocks, id, compiled.firstId);
    },

    insertInto (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        const [id] = resolveBlockRef(target, op.block || op.match, ctx.aliases);
        const input = op.input || 'SUBSTACK';
        const compiled = ctx.compileStack(target, op.blocks);
        createCompiled(target.blocks, compiled.blocks);
        if (op.position === 'end') {
            const parent = target.blocks._blocks[id];
            const existing = parent.inputs[input] && parent.inputs[input].block;
            if (existing) {
                insertStackAfter(target.blocks, lastOf(target.blocks._blocks, existing).id, compiled.firstId);
                return;
            }
        }
        insertStackInto(target.blocks, id, input, compiled.firstId);
    },

    setInput (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        const blocks = target.blocks._blocks;
        for (const id of resolveBlockRef(target, op.block || op.match, ctx.aliases)) {
            const block = blocks[id];
            const input = block.inputs[op.input];
            if (!input) throw new PatchError(`${block.opcode} 沒有輸入 ${op.input}`);
            const value = op.value;
            const isLiteral = ['string', 'number', 'boolean'].includes(typeof value);
            // Remove whatever covers the shadow.
            if (input.block && input.block !== input.shadow) {
                target.blocks.deleteBlock(input.block);
                input.block = input.shadow;
            }
            if (isLiteral) {
                const shadow = input.shadow && blocks[input.shadow];
                if (!shadow) throw new PatchError(`${block.opcode}.${op.input} 不能直接填值`);
                const primitive = PRIMITIVE_SHADOWS[shadow.opcode];
                const field = primitive ? shadow.fields[primitive[0]] : Object.values(shadow.fields)[0];
                if (!field) throw new PatchError(`${block.opcode}.${op.input} 不能直接填值`);
                if (field.variableType === 'broadcast_msg') {
                    const broadcast = ctx.broadcast(String(value));
                    field.id = broadcast.id;
                }
                field.value = String(value);
                continue;
            }
            const compiled = ctx.compileValueFor(target, value, !input.shadow, block.id);
            createCompiled(target.blocks, compiled.plan.scripts[0].blocks);
            input.block = compiled.rootId;
            blocks[compiled.rootId].parent = block.id;
        }
    },

    setField (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        for (const id of resolveBlockRef(target, op.block || op.match, ctx.aliases)) {
            const block = target.blocks._blocks[id];
            const field = block.fields[op.field];
            if (!field) throw new PatchError(`${block.opcode} 沒有欄位 ${op.field}`);
            if (typeof field.variableType !== 'undefined' && field.id) {
                throw new PatchError('變數欄位請用 renameVariable 或 replaceBlock 修改');
            }
            field.value = String(op.value);
        }
    },

    renameVariable (ctx, op) {
        const stage = ctx.vm.runtime.getTargetForStage();
        const target = op.sprite ? findTarget(ctx.vm, op.sprite) : null;
        const type = op.type === 'list' ? 'list' : '';
        const candidates = [target, stage].filter(Boolean);
        let owner = null;
        let variable = null;
        for (const candidate of candidates) {
            variable = Object.values(candidate.variables).find(v => v.name === op.from && v.type === type);
            if (variable) {
                owner = candidate;
                break;
            }
        }
        if (!variable) throw new PatchError(`找不到變數「${op.from}」`);
        owner.renameVariable(variable.id, String(op.to));
        const targets = owner.isStage ? ctx.vm.runtime.targets : [owner];
        targets.forEach(t => t.blocks.updateBlocksAfterVarRename(variable.id, String(op.to)));
    },

    renameSprite (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        ctx.vm.renameSprite(target.id, String(op.to));
    },

    deleteSprite (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        if (target.isStage) throw new PatchError('不能刪除舞台');
        return ctx.vm.deleteSprite(target.id);
    },

    setProperty (ctx, op) {
        const target = findTarget(ctx.vm, op.sprite);
        if (typeof op.x !== 'undefined' || typeof op.y !== 'undefined') {
            target.setXY(Number(typeof op.x === 'undefined' ? target.x : op.x), Number(typeof op.y === 'undefined' ? target.y : op.y));
        }
        if (typeof op.size !== 'undefined') target.setSize(Number(op.size));
        if (typeof op.direction !== 'undefined') target.setDirection(Number(op.direction));
        if (typeof op.visible !== 'undefined') target.setVisible(!!op.visible);
        if (typeof op.rotationStyle !== 'undefined') target.setRotationStyle(String(op.rotationStyle));
    }
};

/**
 * Apply patch operations to a VM.
 * @param {object} vm VM
 * @param {Array} ops operations
 * @param {object} options {catalog, aliases}
 * @returns {Promise<{applied: number, errors: Array<{index, op, message}>, warnings: string[]}>} result
 */
export const applyOps = async (vm, ops, {catalog, aliases = {}}) => {
    const errors = [];
    const warnings = [];
    let applied = 0;
    const resolveTarget = targetResolver(vm);

    const declare = plan => {
        createDeclarations(vm, plan, resolveTarget, warnings);
    };

    const ctx = {
        vm,
        aliases,
        catalog,
        broadcast (name) {
            const stage = vm.runtime.getTargetForStage();
            const found = Object.values(stage.variables).find(v => v.type === 'broadcast_msg' && v.name === name);
            if (found) return found;
            stage.createVariable(uid(), name, 'broadcast_msg');
            return Object.values(stage.variables).find(v => v.type === 'broadcast_msg' && v.name === name);
        },
        compileStack (target, nodes) {
            const result = compileStackForInsert(nodes, {
                catalog, model: modelFromVM(vm), target: target.isStage ? null : target.getName()
            });
            if (result.errors.length) throw new PatchError(result.errors.map(e => `${e.path} ${e.message}`).join('；'));
            if (!result.firstId) throw new PatchError('沒有要插入的積木');
            const first = result.plan.scripts[0].blocks.find(b => b.id === result.firstId);
            const entry = catalog.blocks[first.opcode];
            if (entry && entry.shape === 'hat') throw new PatchError('不能把事件（帽子）積木插入腳本中間');
            warnings.push(...result.warnings);
            declare(result.plan);
            return {blocks: result.plan.scripts[0].blocks, firstId: result.firstId};
        },
        compileValueFor (target, node, boolean, parentId) {
            const result = compileValue(node, {
                catalog, model: modelFromVM(vm), target: target.isStage ? null : target.getName(), boolean, parentId
            });
            if (result.errors.length || !result.rootId) {
                throw new PatchError(result.errors.map(e => `${e.path} ${e.message}`).join('；') || '無法建立積木');
            }
            warnings.push(...result.warnings);
            declare(result.plan);
            return result;
        }
    };

    for (let index = 0; index < ops.length; index++) {
        const op = ops[index];
        const handler = op && OPS[op.op];
        if (!handler) {
            errors.push({index, op, message: `未知的操作：${op && op.op}`});
            continue;
        }
        try {
            await handler(ctx, op);
            applied += 1;
        } catch (e) {
            errors.push({index, op, message: e.message});
        }
    }
    for (const target of vm.runtime.targets) target.blocks.resetCache();
    vm.runtime.emitProjectChanged();
    vm.emitTargetsUpdate();
    if (vm.editingTarget) vm.emitWorkspaceUpdate();
    return {applied, errors, warnings};
};
