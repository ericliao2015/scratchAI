/**
 * Background run engine (P3). Runs a copy of a project in an invisible VM on a virtual
 * clock, simulating the green flag, keys, clicks and broadcasts, and records what
 * happens: sprite positions, costumes, variables and speech bubbles.
 *
 * Time is virtual: a few seconds of project time run in a fraction of a second, and
 * runs are repeatable. Collision blocks ("touching ...?") need a renderer, which is only
 * available in the browser; elsewhere they report false.
 */
import VM from 'scratch-vm';
import StageLayering from 'scratch-vm/src/engine/stage-layering';

const FPS = 30;
const FRAME_MS = 1000 / FPS;
const MAX_DURATION = 20;

const KEY_TO_JS = {
    'space': ' ',
    'left arrow': 'ArrowLeft',
    'right arrow': 'ArrowRight',
    'up arrow': 'ArrowUp',
    'down arrow': 'ArrowDown',
    'enter': 'Enter'
};

const jsKey = key => KEY_TO_JS[String(key).toLowerCase()] || String(key).slice(0, 1);

/**
 * Create a renderer for collision detection when running in a browser.
 * @returns {?object} renderer, or null when WebGL is not available
 */
const createRenderer = async () => {
    if (typeof document === 'undefined') return null;
    try {
        const {default: RenderWebGL} = await import(/* webpackChunkName: "scratch-render-sandbox" */ 'scratch-render');
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 360;
        const renderer = new RenderWebGL(canvas);
        return renderer;
    } catch (e) {
        return null;
    }
};

const disposeRenderer = renderer => {
    try {
        const gl = renderer && renderer.gl;
        const lose = gl && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
    } catch (e) {
        // ignore
    }
};

/**
 * Without a renderer, sprites never ask for a redraw, so a "forever" loop would run many
 * times per frame. Ask for one the way a rendered sprite does, for sandbox VMs only.
 * @param {object} target any target of the sandbox VM
 */
const patchRedraw = target => {
    const proto = Object.getPrototypeOf(target);
    if (proto.__scratchAIRedraw) return;
    proto.__scratchAIRedraw = true;
    for (const name of ['setXY', 'setDirection', 'setSize', 'setCostume', 'setVisible', 'setEffect']) {
        const original = proto[name];
        if (typeof original !== 'function') continue;
        proto[name] = function (...args) {
            const result = original.apply(this, args);
            if (!this.renderer && this.runtime && this.runtime.scratchAISandbox &&
                (this.visible || name === 'setVisible')) {
                this.runtime.requestRedraw();
            }
            return result;
        };
    }
};

/**
 * Load a project into a new invisible VM.
 * @param {object} options options
 * @param {ArrayBuffer} options.data .sb3 data
 * @param {object} options.storage storage (shared with the editor)
 * @param {boolean} [options.withRenderer] attach a renderer for collisions (browser only)
 * @returns {Promise<object>} {vm, dispose}
 */
export const createSandbox = async ({data, storage, withRenderer = true}) => {
    const vm = new VM();
    vm.runtime.scratchAISandbox = true;
    vm.attachStorage(storage);
    const renderer = withRenderer ? await createRenderer() : null;
    if (renderer) {
        renderer.setLayerGroupOrdering(StageLayering.LAYER_GROUPS);
        vm.attachRenderer(renderer);
    }
    // The interpreter is simpler to drive frame by frame than the compiler.
    if (vm.setCompilerOptions) vm.setCompilerOptions({enabled: false});
    await vm.loadProject(data);
    patchRedraw(vm.runtime.getTargetForStage());
    return {
        vm,
        hasRenderer: !!renderer,
        dispose () {
            vm.stopAll();
            disposeRenderer(renderer);
        }
    };
};

const spriteState = target => {
    const costume = target.getCostumes()[target.currentCostume];
    return {
        x: Math.round(target.x * 100) / 100,
        y: Math.round(target.y * 100) / 100,
        direction: Math.round(target.direction * 100) / 100,
        size: Math.round(target.size * 100) / 100,
        visible: target.visible,
        costume: costume ? costume.name : ''
    };
};

const sample = (vm, t) => {
    const sprites = {};
    const clones = {};
    for (const target of vm.runtime.targets) {
        if (target.isStage) continue;
        const name = target.sprite.name;
        if (target.isOriginal) sprites[name] = spriteState(target);
        else clones[name] = (clones[name] || 0) + 1;
    }
    for (const [name, count] of Object.entries(clones)) {
        if (sprites[name]) sprites[name].clones = count;
    }
    const vars = {};
    for (const target of vm.runtime.targets.filter(x => x.isOriginal)) {
        for (const variable of Object.values(target.variables)) {
            if (variable.type === 'broadcast_msg') continue;
            const key = target.isStage ? variable.name : `${target.getName()}.${variable.name}`;
            vars[key] = Array.isArray(variable.value) ? variable.value.slice(0, 20) : variable.value;
        }
    }
    const stage = vm.runtime.getTargetForStage();
    const backdrop = stage.getCostumes()[stage.currentCostume];
    return {t: Math.round(t * 1000) / 1000, sprites, vars, backdrop: backdrop ? backdrop.name : ''};
};

const ACTIONS = {
    greenFlag: vm => vm.greenFlag(),
    keyDown: (vm, action) => vm.postIOData('keyboard', {key: jsKey(action.key), isDown: true}),
    keyUp: (vm, action) => vm.postIOData('keyboard', {key: jsKey(action.key), isDown: false}),
    keyPress: (vm, action, state) => {
        vm.postIOData('keyboard', {key: jsKey(action.key), isDown: true});
        state.releases.push({at: state.time + 0.1, key: action.key});
    },
    click: (vm, action) => {
        const target = vm.runtime.targets.find(x => x.isOriginal && !x.isStage && x.getName() === action.sprite);
        if (target) vm.runtime.startHats('event_whenthisspriteclicked', null, target);
    },
    clickStage: vm => vm.runtime.startHats('event_whenstageclicked', null, vm.runtime.getTargetForStage()),
    broadcast: (vm, action) => {
        vm.runtime.startHats('event_whenbroadcastreceived', {BROADCAST_OPTION: String(action.message)});
    },
    mouse: (vm, action) => vm.postIOData('mouse', {
        x: Number(action.x) + 240,
        y: 180 - Number(action.y),
        canvasWidth: 480,
        canvasHeight: 360,
        isDown: !!action.down
    }),
    answer: (vm, action) => vm.runtime.emit('ANSWER', String(action.text || ''))
};

export const ACTION_NAMES = Object.keys(ACTIONS);

/**
 * Run a scenario on a sandbox VM.
 * @param {object} vm sandbox VM (from createSandbox)
 * @param {object} scenario {duration, actions: [{at, do, ...}], sampleEvery}
 * @returns {object} trace {samples, said, duration, actions}
 */
export const runScenario = (vm, scenario = {}) => {
    const duration = Math.min(Math.max(Number(scenario.duration) || 3, 0.1), MAX_DURATION);
    const sampleEvery = Math.max(Number(scenario.sampleEvery) || 0.1, 1 / FPS);
    const listed = Array.isArray(scenario.actions) && scenario.actions.length ?
        scenario.actions : [{at: 0, do: 'greenFlag'}];
    // Stable sort by time: actions at the same moment keep their order.
    const actions = listed
        .map((action, index) => [{...action, at: Number(action.at) || 0}, index])
        .sort((a, b) => a[0].at - b[0].at || a[1] - b[1])
        .map(pair => pair[0]);

    const said = [];
    const state = {time: 0, releases: []};
    const onSay = (target, type, text) => {
        if (text !== '') said.push({t: state.time, sprite: target.sprite ? target.sprite.name : '', type, text: String(text)});
    };
    vm.runtime.on('SAY', onSay);
    vm.runtime.currentStepTime = FRAME_MS;

    // Virtual clock: every read advances a little, so loops that never yield still finish a frame.
    const realNow = Date.now;
    const start = realNow();
    let virtual = start;
    const clock = () => {
        virtual += 0.25;
        return Math.floor(virtual);
    };

    // State before anything runs, so reports can say where things started.
    const samples = [sample(vm, 0)];
    let nextSample = sampleEvery;
    let nextAction = 0;
    try {
        for (let frame = 0; state.time <= duration + 1e-9; frame++) {
            state.time = frame / FPS;
            virtual = Math.max(virtual, start + (frame * FRAME_MS));
            Date.now = clock;
            try {
                while (nextAction < actions.length && actions[nextAction].at <= state.time + 1e-9) {
                    const action = actions[nextAction++];
                    const run = ACTIONS[action.do];
                    if (run) run(vm, action, state);
                }
                state.releases = state.releases.filter(release => {
                    if (release.at > state.time) return true;
                    vm.postIOData('keyboard', {key: jsKey(release.key), isDown: false});
                    return false;
                });
                vm.runtime._step();
            } finally {
                Date.now = realNow;
            }
            if (state.time + 1e-9 >= nextSample) {
                samples.push(sample(vm, state.time));
                nextSample += sampleEvery;
            }
        }
    } finally {
        Date.now = realNow;
        vm.runtime.removeListener('SAY', onSay);
        vm.stopAll();
    }
    return {duration, samples, said, actions};
};

/**
 * Convenience: load a project, run a scenario and clean up.
 * @param {object} options {data, storage, scenario, prepare: async vm => {}, withRenderer}
 * @returns {Promise<object>} trace (with hasRenderer)
 */
export const runProject = async ({data, storage, scenario, prepare, withRenderer = true}) => {
    const sandbox = await createSandbox({data, storage, withRenderer});
    try {
        if (prepare) await prepare(sandbox.vm);
        const trace = runScenario(sandbox.vm, scenario);
        trace.hasRenderer = sandbox.hasRenderer;
        return trace;
    } finally {
        sandbox.dispose();
    }
};
