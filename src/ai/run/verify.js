/**
 * Self-verification: apply a generated program to a copy of the project, run the test the
 * AI wrote for it, and report what happened. The student's project is not touched.
 */
import {ACTION_NAMES, createSandbox, runScenario} from './engine.js';
import {checkExpectations, summarizeTrace} from './expect.js';
import {applyOps} from '../apply/patch.js';
import {applyPlan} from '../apply/apply.js';
import {compileProgram} from '../ir/compile.js';
import {modelFromVM} from '../project/model.js';

const MAX_TEST_DURATION = 10;
const MAX_EXPECTATIONS = 10;

/**
 * Clean up a test written by the AI (or a teacher).
 * @param {*} test {duration, actions, expect}
 * @returns {?object} normalized test, or null when there is nothing to check
 */
export const normalizeTest = test => {
    if (!test || typeof test !== 'object' || !Array.isArray(test.expect) || !test.expect.length) return null;
    const actions = (Array.isArray(test.actions) ? test.actions : [])
        .filter(a => a && ACTION_NAMES.includes(a.do));
    return {
        duration: Math.min(Math.max(Number(test.duration) || 3, 0.5), MAX_TEST_DURATION),
        actions: actions.length ? actions : [{at: 0, do: 'greenFlag'}],
        expect: test.expect.filter(e => e && typeof e === 'object').slice(0, MAX_EXPECTATIONS)
    };
};

/**
 * The project as .sb3 data, keeping block IDs (normal saving renames them), so
 * aliases like #12 still point at the same blocks in the copy.
 * @param {object} vm VM
 * @returns {Promise<ArrayBuffer>} sb3
 */
export const projectDataWithIds = vm => {
    const zip = vm._saveProjectZip();
    zip.file('project.json', vm.toJSON(null, {allowOptimization: false}));
    return zip.generateAsync({type: 'arraybuffer'});
};

/**
 * Run a test on a project, optionally after changing it.
 * @param {object} options options
 * @param {ArrayBuffer} options.data .sb3
 * @param {object} options.storage storage
 * @param {object} options.test normalized test
 * @param {function(object): Promise} [options.prepare] change the sandbox VM before running
 * @param {boolean} [options.withRenderer] use a renderer when available
 * @returns {Promise<object>} {pass, passed, total, results, report, hasRenderer}
 */
export const runTest = async ({data, storage, test, prepare, withRenderer = true}) => {
    const sandbox = await createSandbox({data, storage, withRenderer});
    try {
        if (prepare) await prepare(sandbox.vm);
        const trace = runScenario(sandbox.vm, test);
        trace.hasRenderer = sandbox.hasRenderer;
        const results = checkExpectations(trace, test.expect);
        const passed = results.filter(r => r.pass).length;
        return {
            pass: passed === results.length,
            passed,
            total: results.length,
            results,
            report: summarizeTrace(trace),
            hasRenderer: sandbox.hasRenderer
        };
    } finally {
        sandbox.dispose();
    }
};

/**
 * Try a generated program on a copy of the project.
 * @param {object} options {vm, catalog, result (generate() program), libraries, withRenderer}
 * @returns {Promise<?object>} runTest() result plus {test}, or null when the AI wrote no test
 */
export const verifyProgram = async ({vm, catalog, result, libraries = null, withRenderer = true}) => {
    const test = normalizeTest(result.ir && result.ir.test);
    if (!test) return null;
    const data = await projectDataWithIds(vm);
    const outcome = await runTest({
        data,
        storage: vm.runtime.storage,
        test,
        withRenderer,
        prepare: async sandboxVM => {
            if (result.ops && result.ops.length) {
                await applyOps(sandboxVM, result.ops, {catalog, aliases: result.aliases});
            }
            const compiled = compileProgram(result.ir, {catalog, model: modelFromVM(sandboxVM)});
            // Images are not generated for a test run; placeholders are enough.
            await applyPlan(sandboxVM, compiled.plan, {libraries, generateImage: null});
        }
    });
    return {...outcome, test};
};

/**
 * Run the student's project for a few seconds and describe what happened (tutor "why doesn't it work").
 * @param {object} options {vm, scenario, withRenderer}
 * @returns {Promise<string>} run report
 */
export const describeRun = async ({vm, scenario = {duration: 3, actions: [{at: 0, do: 'greenFlag'}]}, withRenderer = true}) => {
    const data = await projectDataWithIds(vm);
    const sandbox = await createSandbox({data, storage: vm.runtime.storage, withRenderer});
    try {
        const trace = runScenario(sandbox.vm, scenario);
        trace.hasRenderer = sandbox.hasRenderer;
        return summarizeTrace(trace);
    } finally {
        sandbox.dispose();
    }
};
