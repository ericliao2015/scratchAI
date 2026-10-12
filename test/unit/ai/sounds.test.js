import catalog from '../../fixtures/ai/catalog-sprite-en.json';
import {compileProgram} from '../../../src/ai/ir/compile.js';
import {applyPlan} from '../../../src/ai/apply/apply.js';
import {modelFromVM} from '../../../src/ai/project/model.js';
import {makeVM} from '../../helpers/ai-vm.js';

// A valid 8 sample mono 16-bit WAV file.
const wav = () => {
    const samples = 8;
    const buffer = new ArrayBuffer(44 + (samples * 2));
    const view = new DataView(buffer);
    const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + (samples * 2), true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 22050, true); view.setUint32(28, 44100, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples * 2, true);
    return new Uint8Array(buffer);
};

test('library sounds are added to new sprites, existing sprites and the stage', async () => {
    const vm = await makeVM();
    const storage = vm.runtime.storage;
    const asset = storage.createAsset(storage.AssetType.Sound, 'wav', wav(), null, true);
    const libraries = {
        costumes: [], sprites: [], backdrops: [],
        sounds: [{name: 'Pop', assetId: asset.assetId, dataFormat: '', md5ext: `${asset.assetId}.wav`, rate: 22050, sampleCount: 8}]
    };
    const realLoad = storage.load.bind(storage);
    storage.load = (type, id, ext) => (id === asset.assetId ? Promise.resolve(asset) : realLoad(type, id, ext));

    const {plan, errors} = compileProgram({
        stage: {sounds: [{library: 'pop'}]},
        sprites: [
            {name: 'Cat', sounds: ['Pop', {library: 'Nope'}]},
            {name: 'Ball', sounds: [{library: 'Pop', name: 'boing'}], scripts: [[
                {opcode: 'event_whenflagclicked'},
                {opcode: 'sound_play', inputs: {SOUND_MENU: 'boing'}}
            ]]}
        ]
    }, {catalog, model: modelFromVM(vm)});
    expect(errors).toEqual([]);
    const summary = await applyPlan(vm, plan, {libraries});
    expect(summary.soundsAdded).toBe(3);
    expect(summary.warnings.join()).toMatch(/Nope/);
    expect(vm.runtime.getSpriteTargetByName('Cat').getSounds().map(s => s.name)).toEqual(['Pop']);
    expect(vm.runtime.getSpriteTargetByName('Ball').getSounds().map(s => s.name)).toEqual(['boing']);
    expect(vm.runtime.getTargetForStage().getSounds()).toHaveLength(1);

    // The sounds survive saving.
    const json = JSON.parse(vm.toJSON());
    expect(json.targets.find(t => t.name === 'Ball').sounds[0].md5ext).toBe(`${asset.assetId}.wav`);
});
