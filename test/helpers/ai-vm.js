import VM from 'scratch-vm';
import ScratchStorage from '@turbowarp/scratch-storage';
import JSZip from '@turbowarp/jszip';

export const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>';

/**
 * A headless VM with a small project: the stage and one sprite called "Cat".
 * @param {Function} [customize] receives the project json to modify before loading
 * @returns {Promise<VM>} vm
 */
export const makeVM = async customize => {
    // The VM logs a warning for every costume it cannot render headless.
    if (!console.warn.mock) jest.spyOn(console, 'warn').mockImplementation(() => {});
    const vm = new VM();
    vm.attachStorage(new ScratchStorage());
    const storage = vm.runtime.storage;
    const asset = storage.createAsset(storage.AssetType.ImageVector, 'svg', new TextEncoder().encode(SVG), null, true);
    const costume = {
        name: 'c1', dataFormat: 'svg', assetId: asset.assetId, md5ext: `${asset.assetId}.svg`,
        rotationCenterX: 20, rotationCenterY: 20, bitmapResolution: 1
    };
    const project = {
        targets: [
            {isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
                currentCostume: 0, costumes: [costume], sounds: [], volume: 100, layerOrder: 0, tempo: 60,
                videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null},
            {isStage: false, name: 'Cat', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
                currentCostume: 0, costumes: [costume], sounds: [], volume: 100, layerOrder: 1, visible: true,
                x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'}
        ],
        monitors: [],
        extensions: [],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: ''}
    };
    if (customize) customize(project);
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(project));
    zip.file(costume.md5ext, SVG);
    await vm.loadProject(await zip.generateAsync({type: 'arraybuffer'}));
    vm.setEditingTarget(vm.runtime.getSpriteTargetByName('Cat').id);
    return vm;
};
