/**
 * Executes a compiled plan (ir/compile.js) against a VM.
 */
import JSZip from '@turbowarp/jszip';
import {STAGE_KEY} from '../ir/scope.js';
import {placeholderCostume, resolveCostume} from './costumes.js';

const SCRIPT_X_GAP = 450;

const assetTypeFor = (storage, dataFormat) => (dataFormat === 'svg' ?
    storage.AssetType.ImageVector : storage.AssetType.ImageBitmap);

const createCostumeAsset = (storage, costume) => {
    const asset = storage.createAsset(
        assetTypeFor(storage, costume.dataFormat),
        costume.dataFormat,
        costume.data,
        null,
        true
    );
    return asset;
};

const costumeJson = (costume, assetId) => ({
    name: costume.name,
    bitmapResolution: costume.bitmapResolution || 1,
    dataFormat: costume.dataFormat,
    assetId,
    md5ext: `${assetId}.${costume.dataFormat}`,
    rotationCenterX: costume.rotationCenterX,
    rotationCenterY: costume.rotationCenterY
});

const uniqueNames = costumes => {
    const used = new Set();
    return costumes.map(costume => {
        let name = costume.name || 'costume';
        let n = 2;
        while (used.has(name)) name = `${costume.name}${n++}`;
        used.add(name);
        return {...costume, name};
    });
};

/**
 * Build a .sprite3 file in memory and add it to the VM.
 * @param {object} vm VM
 * @param {string} name sprite name
 * @param {Array} costumes resolved costumes
 * @returns {Promise<object>} the new target
 */
const addSprite = async (vm, name, costumes) => {
    const storage = vm.runtime.storage;
    const zip = new JSZip();
    const costumeEntries = uniqueNames(costumes).map(costume => {
        const asset = createCostumeAsset(storage, costume);
        zip.file(`${asset.assetId}.${costume.dataFormat}`, costume.data);
        return costumeJson(costume, asset.assetId);
    });
    const sprite = {
        isStage: false,
        name,
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: costumeEntries,
        sounds: [],
        volume: 100,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around'
    };
    zip.file('sprite.json', JSON.stringify(sprite));
    const data = await zip.generateAsync({type: 'arraybuffer'});
    await vm.addSprite(data);
    // addSprite renames on conflict, so take the most recently added original target.
    const originals = vm.runtime.targets.filter(t => t.isOriginal && !t.isStage);
    return originals[originals.length - 1];
};

const addCostumes = async (vm, target, costumes) => {
    const storage = vm.runtime.storage;
    for (const costume of costumes) {
        const asset = createCostumeAsset(storage, costume);
        const json = costumeJson(costume, asset.assetId);
        await vm.addCostume(json.md5ext, {...json, md5: json.md5ext, asset}, target.id);
    }
};

const setProps = (target, props) => {
    if (typeof props.x !== 'undefined' || typeof props.y !== 'undefined') {
        target.setXY(Number(typeof props.x === 'undefined' ? target.x : props.x), Number(typeof props.y === 'undefined' ? target.y : props.y));
    }
    if (typeof props.size !== 'undefined') target.setSize(Number(props.size));
    if (typeof props.direction !== 'undefined') target.setDirection(Number(props.direction));
    if (typeof props.visible !== 'undefined') target.setVisible(!!props.visible);
    if (typeof props.rotationStyle !== 'undefined') target.setRotationStyle(String(props.rotationStyle));
    if (typeof props.draggable !== 'undefined') target.setDraggable(!!props.draggable);
};

const rightmostScriptX = target => {
    let max = null;
    for (const block of Object.values(target.blocks._blocks)) {
        if (block.topLevel && typeof block.x === 'number') max = max === null ? block.x : Math.max(max, block.x);
    }
    return max;
};

/**
 * Create the variables, lists and broadcasts a plan needs.
 * @param {object} vm VM
 * @param {object} plan compiled plan
 * @param {function(string): ?object} targetFor maps a plan target key to a VM target
 * @param {Array<string>} warnings collects warnings
 * @returns {number} number of variables created
 */
export const createDeclarations = (vm, plan, targetFor, warnings) => {
    const stage = vm.runtime.getTargetForStage();
    let created = 0;
    for (const broadcast of plan.broadcasts || []) {
        if (!stage.lookupBroadcastMsg(broadcast.id, broadcast.name)) {
            stage.createVariable(broadcast.id, broadcast.name, 'broadcast_msg');
        }
    }
    for (const variable of plan.variables || []) {
        const target = targetFor(variable.target);
        if (!target) {
            warnings.push(`找不到角色「${variable.target}」，變數「${variable.name}」未建立。`);
            continue;
        }
        if (!target.variables[variable.id]) {
            target.createVariable(variable.id, variable.name, variable.type);
            target.variables[variable.id].value = variable.type === 'list' ?
                (Array.isArray(variable.value) ? variable.value : []) : variable.value;
            created += 1;
        }
    }
    return created;
};

/**
 * Map a plan target key (sprite name or STAGE_KEY) to a VM target.
 * @param {object} vm VM
 * @returns {function(string): ?object} resolver
 */
export const targetResolver = vm => key => {
    if (key === STAGE_KEY) return vm.runtime.getTargetForStage();
    return vm.runtime.targets.find(t => t.isOriginal && !t.isStage && t.getName() === key) || null;
};

/**
 * @param {object} vm VM
 * @param {object} plan compiled plan
 * @param {object} [options] {libraries, generateImage, onProgress}
 * @returns {Promise<object>} summary {spritesCreated, scriptsAdded, variablesCreated, warnings}
 */
export const applyPlan = async (vm, plan, {libraries = null, generateImage = null, onProgress = () => {}} = {}) => {
    const runtime = vm.runtime;
    const storage = runtime.storage;
    const stage = runtime.getTargetForStage();
    const warnings = [];
    const summary = {spritesCreated: [], scriptsAdded: 0, variablesCreated: 0, costumesAdded: 0, warnings};
    const targetsByKey = new Map([[STAGE_KEY, stage]]);
    const resolveOptions = {storage, libraries, generateImage};

    const resolveAll = async (specs, {isBackdrop, fallbackName}) => {
        const result = [];
        for (const spec of specs) {
            try {
                const costumes = await resolveCostume(spec, {...resolveOptions, isBackdrop, fallbackName});
                if (costumes.length === 0) warnings.push(`找不到造型「${JSON.stringify(spec).slice(0, 60)}」，已略過。`);
                result.push(...costumes);
            } catch (e) {
                warnings.push(`造型載入失敗：${e.message}`);
            }
        }
        return result;
    };

    // 1. Sprites
    for (const sprite of plan.sprites) {
        onProgress(`準備角色「${sprite.name}」`);
        let target = runtime.targets.find(t => t.isOriginal && !t.isStage && t.getName() === sprite.name);
        const costumes = await resolveAll(sprite.costumes, {isBackdrop: false, fallbackName: sprite.name});
        if (!target) {
            target = await addSprite(vm, sprite.name, costumes.length ? costumes : [placeholderCostume(sprite.name)]);
            summary.spritesCreated.push(target.getName());
            summary.costumesAdded += costumes.length;
        } else if (costumes.length) {
            await addCostumes(vm, target, costumes);
            summary.costumesAdded += costumes.length;
        }
        setProps(target, sprite.props || {});
        targetsByKey.set(sprite.name, target);
    }

    // 2. Backdrops
    if (plan.stage && plan.stage.backdrops && plan.stage.backdrops.length) {
        const backdrops = await resolveAll(plan.stage.backdrops, {isBackdrop: true, fallbackName: 'backdrop'});
        await addCostumes(vm, stage, backdrops);
        summary.costumesAdded += backdrops.length;
    }

    const targetFor = key => {
        if (targetsByKey.has(key)) return targetsByKey.get(key);
        const target = runtime.targets.find(t => t.isOriginal && !t.isStage && t.getName() === key);
        if (target) targetsByKey.set(key, target);
        return target || null;
    };

    // 3. Variables, lists and broadcasts
    summary.variablesCreated += createDeclarations(vm, plan, targetFor, warnings);

    // 4. Scripts
    for (const group of plan.scripts) {
        const target = targetFor(group.target);
        if (!target) {
            warnings.push(`找不到角色「${group.target}」，腳本未加入。`);
            continue;
        }
        onProgress(`加入「${target.getName()}」的腳本`);
        const existingX = rightmostScriptX(target);
        const offsetX = existingX === null ? 0 : existingX + SCRIPT_X_GAP;
        const blocks = group.blocks.map(block => (block.topLevel ?
            {...block, x: (block.x || 0) + offsetX, y: block.y || 0} : block));
        await vm.shareBlocksToTarget(blocks, target.id);
        summary.scriptsAdded += blocks.filter(b => b.topLevel).length;
    }

    vm.emitTargetsUpdate();
    if (vm.editingTarget) vm.emitWorkspaceUpdate();
    return summary;
};

/**
 * Snapshot of the whole project, for undo.
 * @param {object} vm VM
 * @returns {Promise<ArrayBuffer>} sb3 data
 */
export const snapshotProject = vm => vm.saveProjectSb3('arraybuffer');

/**
 * Restore a snapshot made by snapshotProject.
 * @param {object} vm VM
 * @param {ArrayBuffer} snapshot sb3 data
 * @returns {Promise} resolves when loaded
 */
export const restoreSnapshot = async (vm, snapshot) => {
    const editingName = vm.editingTarget ? vm.editingTarget.getName() : null;
    await vm.loadProject(snapshot);
    const target = editingName && vm.runtime.targets.find(t => t.isOriginal && t.getName() === editingName);
    if (target) vm.setEditingTarget(target.id);
};
