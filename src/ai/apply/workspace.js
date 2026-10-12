/**
 * Apply simple plans through the block editor instead of the VM, so the change becomes
 * one entry in the editor's undo history (Ctrl+Z removes it).
 */
import {STAGE_KEY} from '../ir/scope.js';
import {blocksToWorkspaceXml} from '../preview.js';

const GAP = 60;

/**
 * Only plans that add scripts and variables to the sprite being edited qualify.
 * @param {object} vm VM
 * @param {object} plan compiled plan
 * @param {Array} ops patch operations
 * @returns {boolean} true if the workspace path can be used
 */
export const canApplyViaWorkspace = (vm, plan, ops) => {
    const editing = vm.editingTarget;
    const SB = typeof window !== 'undefined' && window.ScratchBlocks;
    if (!editing || !SB || !SB.getMainWorkspace || (ops && ops.length)) return false;
    const key = editing.isStage ? STAGE_KEY : editing.getName();
    const hasMedia = plan.sprites.some(s => s.costumes.length || (s.sounds || []).length ||
        Object.keys(s.props || {}).length);
    if (hasMedia || plan.stage.backdrops.length || (plan.stage.sounds || []).length) return false;
    if (plan.sprites.some(s => s.isNew || s.name !== key)) return false;
    if (plan.scripts.some(group => group.target !== key)) return false;
    return plan.variables.every(v => v.target === key || v.target === STAGE_KEY);
};

/**
 * @param {object} vm VM
 * @param {object} plan compiled plan (must pass canApplyViaWorkspace)
 * @returns {Promise<object>} summary like applyPlan's
 */
export const applyViaWorkspace = async (vm, plan) => {
    const SB = window.ScratchBlocks;
    const workspace = SB.getMainWorkspace();
    const box = workspace.getBlocksBoundingBox();
    const offsetX = box && box.width ? box.x + box.width + GAP : 0;
    const offsetY = box ? box.y : 0;
    const blocks = plan.scripts.flatMap(group => group.blocks)
        .map(block => (block.topLevel ? {...block, x: (block.x || 0) + offsetX, y: (block.y || 0) + offsetY} : block));

    SB.Events.setGroup(true);
    try {
        for (const variable of plan.variables) {
            if (!workspace.getVariableById(variable.id)) {
                const isLocal = variable.target !== STAGE_KEY;
                workspace.createVariable(variable.name, variable.type, variable.id, isLocal, false);
            }
        }
        for (const broadcast of plan.broadcasts) {
            if (!workspace.getVariableById(broadcast.id)) {
                workspace.createVariable(broadcast.name, 'broadcast_msg', broadcast.id);
            }
        }
        if (blocks.length) {
            const xml = blocksToWorkspaceXml(vm, blocks).replace(/<variables>[\s\S]*?<\/variables>/, '');
            SB.Xml.domToWorkspace(SB.Xml.textToDom(xml), workspace);
        }
    } finally {
        SB.Events.setGroup(false);
    }
    // Blockly delivers its events to the VM asynchronously; wait for them before setting values.
    await new Promise(resolve => setTimeout(resolve, 50));
    // Set initial values the editor does not know about.
    for (const variable of plan.variables) {
        const owner = variable.target === STAGE_KEY ? vm.runtime.getTargetForStage() : vm.editingTarget;
        const created = owner && owner.variables[variable.id];
        if (created) created.value = variable.type === 'list' ? (variable.value || []) : variable.value;
    }
    return {
        spritesCreated: [],
        scriptsAdded: blocks.filter(b => b.topLevel).length,
        variablesCreated: plan.variables.length,
        costumesAdded: 0,
        soundsAdded: 0,
        warnings: [],
        undoable: true
    };
};
