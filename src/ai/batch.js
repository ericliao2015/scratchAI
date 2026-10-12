/**
 * Batch grading and batch modification of many .sb3 files (docs/SPEC.md §7.3, §7.6).
 * Originals are never changed: modified projects are returned as new files.
 */
import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';
import {modelFromProjectJson, modelFromVM} from './project/model.js';
import {gradeProject} from './grade/grade.js';
import {generate} from './generate.js';
import {compileProgram} from './ir/compile.js';
import {applyOps} from './apply/patch.js';
import {applyPlan} from './apply/apply.js';
import {BATCH_INSTRUCTIONS} from './prompts/generate.js';
import {parseFileName} from './grade/report.js';

/**
 * Expand the user's selection: .sb3 files as they are, .zip files into the .sb3 files inside.
 * @param {Array<File>} files selected files
 * @returns {Promise<Array<{fileName: string, data: ArrayBuffer}>>} projects
 */
export const readProjectFiles = async files => {
    const projects = [];
    for (const file of files) {
        const data = await file.arrayBuffer();
        if (/\.zip$/i.test(file.name)) {
            const zip = await JSZip.loadAsync(data);
            const entries = Object.values(zip.files).filter(f => !f.dir && /\.sb3$/i.test(f.name) && !f.name.startsWith('__MACOSX'));
            for (const entry of entries) {
                projects.push({fileName: entry.name.replace(/^.*\//, ''), data: await entry.async('arraybuffer')});
            }
        } else if (/\.sb3$/i.test(file.name)) {
            projects.push({fileName: file.name, data});
        }
    }
    return projects.sort((a, b) => a.fileName.localeCompare(b.fileName, 'zh-Hant', {numeric: true}));
};

/**
 * @param {ArrayBuffer} data .sb3 file
 * @returns {Promise<object>} project model
 */
export const modelFromSb3 = async data => {
    const zip = await JSZip.loadAsync(data);
    const file = zip.file('project.json');
    if (!file) throw new Error('檔案裡沒有 project.json，可能不是 Scratch 3 專案');
    return modelFromProjectJson(JSON.parse(await file.async('string')));
};

/**
 * A VM without renderer or audio, for editing a project file in the background.
 * @param {object} storage storage shared with the editor (for library assets)
 * @param {ArrayBuffer} data .sb3 file
 * @returns {Promise<object>} vm
 */
export const loadHeadlessVM = async (storage, data) => {
    const vm = new VM();
    vm.attachStorage(storage);
    try {
        await vm.loadProject(data);
    } catch (e) {
        const message = String(e && e.message || e);
        throw new Error(/extension/i.test(message) ?
            '專案使用了自訂擴充，無法在背景開啟' : `無法開啟專案：${message.slice(0, 120)}`);
    }
    const sprite = vm.runtime.targets.find(t => t.isOriginal && !t.isStage);
    if (sprite) vm.setEditingTarget(sprite.id);
    return vm;
};

const runPool = async (items, concurrency, worker, signal) => {
    let next = 0;
    const runners = Array.from({length: Math.min(concurrency, items.length)}, async () => {
        while (next < items.length) {
            if (signal && signal.aborted) return;
            const index = next++;
            await worker(items[index], index);
        }
    });
    await Promise.all(runners);
};

/**
 * @param {object} options options
 * @param {Array} options.projects from readProjectFiles
 * @param {object} options.template grading template
 * @param {?object} options.client AI client
 * @param {?object} options.catalog block catalog
 * @param {number} [options.concurrency] parallel requests
 * @param {function(object): void} [options.onResult] called with each entry as soon as it is done
 * @param {function} [options.onBeforeFallback] return false to pause on model downgrade
 * @param {AbortSignal} [options.signal] cancel
 * @returns {Promise<Array<{fileName, result, error}>>} entries in file order
 */
export const batchGrade = async ({
    projects, template, client, catalog, language, concurrency = 2, onResult = () => {}, onBeforeFallback, signal
}) => {
    const entries = new Array(projects.length);
    let paused = false;
    await runPool(projects, concurrency, async (project, index) => {
        if (paused) return;
        let entry;
        try {
            const model = await modelFromSb3(project.data);
            const result = await gradeProject({model, template, client, catalog, language, onBeforeFallback, signal});
            entry = {fileName: project.fileName, result, error: null};
        } catch (e) {
            if (e.kind === 'aborted' && !(signal && signal.aborted)) paused = true;
            entry = {fileName: project.fileName, result: null, error: e.message || String(e), paused};
        }
        entries[index] = entry;
        onResult(entry, index);
    }, signal);
    return entries.filter(Boolean);
};

const changeLog = ({fileName, summary, opResult, warnings, error}) => {
    const {name} = parseFileName(fileName);
    const lines = [`# 變更紀錄：${name}`, '', `- 原始檔案：${fileName}`, `- 時間：${new Date().toLocaleString('zh-TW')}`];
    if (error) {
        lines.push('', `**未修改：${error}**`);
        return lines.join('\n');
    }
    lines.push('', '## 變更');
    if (opResult) lines.push(`- 修改既有積木：成功 ${opResult.applied} 處，失敗 ${opResult.errors.length} 處`);
    if (summary) {
        if (summary.spritesCreated.length) lines.push(`- 新增角色：${summary.spritesCreated.join('、')}`);
        if (summary.scriptsAdded) lines.push(`- 新增腳本：${summary.scriptsAdded} 段`);
        if (summary.variablesCreated) lines.push(`- 新增變數／清單：${summary.variablesCreated} 個`);
        if (summary.costumesAdded) lines.push(`- 新增造型／背景：${summary.costumesAdded} 個`);
    }
    const problems = [...(opResult ? opResult.errors.map(e => e.message) : []), ...(warnings || [])];
    if (problems.length) lines.push('', '## 注意', ...problems.map(p => `- ${p}`));
    return lines.join('\n');
};

/**
 * Apply one generated answer (ir + ops) to a headless VM.
 * @param {object} vm headless VM
 * @param {object} answer {ir, ops}
 * @param {object} options {catalog, libraries, aliases}
 * @returns {Promise<object>} {summary, opResult, warnings}
 */
const applyAnswer = async (vm, answer, {catalog, libraries, aliases = {}}) => {
    const opResult = answer.ops.length ? await applyOps(vm, answer.ops, {catalog, aliases}) : null;
    const compiled = compileProgram(answer.ir, {catalog, model: modelFromVM(vm)});
    if (compiled.errors.length) {
        throw new Error(compiled.errors.slice(0, 3).map(e => `${e.path} ${e.message}`)
            .join('；'));
    }
    const summary = await applyPlan(vm, compiled.plan, {libraries});
    return {summary, opResult, warnings: [...compiled.warnings, ...(opResult ? opResult.warnings : []), ...summary.warnings]};
};

/**
 * @param {object} options options
 * @param {Array} options.projects from readProjectFiles
 * @param {string} options.mode 'unified' (one AI answer for all files) | 'individual' (one per file)
 * @param {string} options.instruction what to change
 * @param {object} options.client AI client
 * @param {object} options.catalog block catalog
 * @param {object} options.storage storage for headless VMs
 * @param {object} [options.libraries] costume libraries
 * @param {object} [options.promptOptions] see generate()
 * @param {?object} [options.preparedAnswer] reuse an answer previewed on the first file (unified mode)
 * @param {function(object, number): void} [options.onResult] progress callback
 * @param {function(string): void} [options.onStatus] status callback
 * @param {AbortSignal} [options.signal] cancel
 * @returns {Promise<Array<{fileName, data, log, error}>>} modified files
 */
export const batchModify = async ({
    projects, mode, instruction, client, catalog, storage, libraries = null, promptOptions = {},
    preparedAnswer = null, onResult = () => {}, onStatus = () => {}, onBeforeFallback, signal
}) => {
    let answer = preparedAnswer;
    if (mode === 'unified' && !answer) {
        onStatus('以第一份作業為範例，請 AI 產生修改方式…');
        answer = await prepareUnifiedAnswer({
            project: projects[0], instruction, client, catalog, storage, promptOptions, signal, onBeforeFallback
        });
    }
    const entries = [];
    for (let index = 0; index < projects.length; index++) {
        if (signal && signal.aborted) break;
        const project = projects[index];
        onStatus(`處理 ${index + 1}/${projects.length}：${project.fileName}`);
        let entry;
        try {
            const vm = await loadHeadlessVM(storage, project.data);
            let applied;
            if (mode === 'unified') {
                applied = await applyAnswer(vm, answer, {catalog, libraries});
            } else {
                const result = await generate({
                    client, vm, catalog, request: instruction, promptOptions: {...promptOptions, level: 'advanced'},
                    signal, onBeforeFallback
                });
                if (result.type !== 'program') throw new Error(`AI 需要更多資訊：${result.question}`);
                applied = await applyAnswer(vm, result, {catalog, libraries, aliases: result.aliases});
            }
            const data = new Uint8Array(await vm.saveProjectSb3('arraybuffer'));
            entry = {fileName: project.fileName, data, log: changeLog({fileName: project.fileName, ...applied}), error: null};
        } catch (e) {
            entry = {fileName: project.fileName, data: null, log: changeLog({fileName: project.fileName, error: e.message}),
                error: e.message || String(e)};
        }
        entries.push(entry);
        onResult(entry, index);
    }
    return entries;
};

/**
 * Ask the AI once for a change that works on every file (unified mode), using the
 * first project as the example.
 * @param {object} options options
 * @returns {Promise<object>} generate() result of type 'program'
 */
export const prepareUnifiedAnswer = async ({
    project, instruction, client, catalog, storage, promptOptions = {}, signal, onBeforeFallback
}) => {
    const vm = await loadHeadlessVM(storage, project.data);
    const result = await generate({
        client,
        vm,
        catalog,
        request: instruction,
        promptOptions: {...promptOptions, level: 'advanced'},
        extraInstructions: BATCH_INSTRUCTIONS,
        signal,
        onBeforeFallback
    });
    if (result.type !== 'program') throw new Error(`AI 需要更多資訊：${result.question}`);
    return result;
};

/**
 * @param {Array<{fileName, data, log, error}>} entries batchModify results
 * @returns {Promise<Blob>} zip with modified projects, change logs and a CSV summary
 */
export const buildModifyZip = async entries => {
    const zip = new JSZip();
    const csv = [['檔案', '狀態', '說明']];
    for (const entry of entries) {
        const {base} = parseFileName(entry.fileName);
        if (entry.data) zip.file(`projects/${entry.fileName}`, entry.data);
        zip.file(`logs/${base}_變更紀錄.md`, entry.log);
        csv.push([entry.fileName, entry.error ? '失敗' : '完成', entry.error || '']);
    }
    const text = csv.map(row => row.map(cell => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
        .join('\r\n');
    zip.file('changes.csv', `﻿${text}\r\n`);
    return zip.generateAsync({type: 'blob'});
};

export const modifyZipName = () => {
    const date = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `修改結果_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}.zip`;
};
