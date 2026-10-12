/**
 * A plain, read-only description of a project, built either from the live VM or from
 * a project.json file. Blocks use the VM's internal format:
 *   {id, opcode, next, parent, inputs: {NAME: {name, block, shadow}},
 *    fields: {NAME: {name, value, id?, variableType?}}, shadow, topLevel, x, y, mutation?}
 */
import sb3 from 'scratch-vm/src/serialization/sb3';

const clone = value => JSON.parse(JSON.stringify(value));

const variablesFromVM = target => Object.values(target.variables).map(v => ({
    id: v.id,
    name: v.name,
    type: v.type,
    value: v.type === 'list' ? (Array.isArray(v.value) ? v.value.slice(0, 50) : []) : v.value
}));

/**
 * @param {object} vm the VM
 * @returns {object} project model
 */
export const modelFromVM = vm => ({
    targets: vm.runtime.targets
        .filter(t => t.isOriginal)
        .map(t => ({
            id: t.id,
            name: t.getName(),
            isStage: t.isStage,
            variables: variablesFromVM(t),
            costumes: t.getCostumes().map(c => ({name: c.name, assetId: c.assetId, dataFormat: c.dataFormat})),
            sounds: t.getSounds().map(s => ({name: s.name})),
            currentCostume: t.currentCostume,
            x: t.x,
            y: t.y,
            size: t.size,
            direction: t.direction,
            visible: t.visible,
            blocks: clone(t.blocks._blocks),
            comments: Object.values(t.comments || {}).map(c => ({id: c.id, blockId: c.blockId || null, text: c.text}))
        })),
    extensions: Array.from(vm.extensionManager._loadedExtensions ? vm.extensionManager._loadedExtensions.keys() : [])
});

/**
 * @param {object} json parsed project.json (sb3 format)
 * @returns {object} project model
 */
export const modelFromProjectJson = json => {
    if (!json || !Array.isArray(json.targets)) {
        throw new Error('不是 Scratch 3 專案（找不到 targets）');
    }
    return {
        targets: json.targets.map((t, index) => {
            const variables = [];
            for (const [id, [name, value]] of Object.entries(t.variables || {})) {
                variables.push({id, name, type: '', value});
            }
            for (const [id, [name, value]] of Object.entries(t.lists || {})) {
                variables.push({id, name, type: 'list', value: Array.isArray(value) ? value.slice(0, 50) : []});
            }
            for (const [id, name] of Object.entries(t.broadcasts || {})) {
                variables.push({id, name, type: 'broadcast_msg', value: name});
            }
            return {
                id: t.id || `target-${index}`,
                name: t.name,
                isStage: !!t.isStage,
                variables,
                costumes: (t.costumes || []).map(c => ({name: c.name, assetId: c.assetId, dataFormat: c.dataFormat})),
                sounds: (t.sounds || []).map(s => ({name: s.name})),
                currentCostume: t.currentCostume || 0,
                x: t.x,
                y: t.y,
                size: t.size,
                direction: t.direction,
                visible: t.visible,
                blocks: sb3.deserializeBlocks(clone(t.blocks || {})),
                comments: Object.entries(t.comments || {})
                    .map(([id, c]) => ({id, blockId: c.blockId || null, text: c.text}))
            };
        }),
        extensions: json.extensions || []
    };
};

export const getStage = model => model.targets.find(t => t.isStage);

export const findTarget = (model, name) => {
    if (typeof name === 'undefined' || name === null || name === '' || name === 'Stage' || name === '舞台') {
        return getStage(model);
    }
    return model.targets.find(t => !t.isStage && t.name === name) || null;
};

/**
 * Top level scripts of a target (excluding loose shadows).
 * @param {object} target model target
 * @returns {Array<object>} top blocks
 */
export const topBlocks = target => Object.values(target.blocks)
    .filter(b => b.topLevel && !b.shadow);

/**
 * Procedure prototypes defined in a target.
 * @param {object} target model target
 * @returns {Array<object>} {proccode, argumentids, argumentnames, argumentdefaults, warp}
 */
export const proceduresOf = target => Object.values(target.blocks)
    .filter(b => b.opcode === 'procedures_prototype' && b.mutation)
    .map(b => {
        const parse = text => {
            try {
                return JSON.parse(text || '[]');
            } catch (e) {
                return [];
            }
        };
        return {
            proccode: b.mutation.proccode,
            argumentids: parse(b.mutation.argumentids),
            argumentnames: parse(b.mutation.argumentnames),
            argumentdefaults: parse(b.mutation.argumentdefaults),
            warp: String(b.mutation.warp) === 'true'
        };
    });

/**
 * Find a variable visible from a target: local first, then global (stage).
 * @param {object} model project model
 * @param {object} target target
 * @param {string} name variable name
 * @param {string} type '' | 'list' | 'broadcast_msg'
 * @returns {?object} variable
 */
export const lookupVariable = (model, target, name, type = '') => {
    const local = target.variables.find(v => v.name === name && v.type === type);
    if (local) return local;
    const stage = getStage(model);
    return stage.variables.find(v => v.name === name && v.type === type) || null;
};

/**
 * Count blocks by opcode across the project (shadows excluded).
 * @param {object} model project model
 * @returns {object} opcode to count
 */
export const opcodeCounts = model => {
    const counts = {};
    for (const target of model.targets) {
        for (const block of Object.values(target.blocks)) {
            if (block.shadow) continue;
            counts[block.opcode] = (counts[block.opcode] || 0) + 1;
        }
    }
    return counts;
};
