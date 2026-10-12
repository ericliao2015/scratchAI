/**
 * Tracks existing and planned targets, variables, broadcasts and procedures while an
 * IR program is compiled, so names resolve to ids consistently.
 */
import uid from '../util/uid.js';
import {getStage, proceduresOf} from '../project/model.js';

export const STAGE_KEY = '__stage__';

const emptyModel = () => ({
    targets: [{id: 'stage', name: 'Stage', isStage: true, variables: [], costumes: [], sounds: [], blocks: {}}]
});

export class Scope {
    constructor (model) {
        this.model = model || emptyModel();
        this.targets = new Map();
        this.newVariables = [];
        this.newBroadcasts = [];
        this.warnings = [];
        const stage = getStage(this.model);
        this.targets.set(STAGE_KEY, this.makeInfo(STAGE_KEY, stage, true));
    }

    makeInfo (key, existing, isStage) {
        return {
            key,
            name: isStage ? 'Stage' : key,
            isStage,
            existing: existing || null,
            variables: existing ? existing.variables.map(v => ({...v})) : [],
            procedures: existing ? proceduresOf(existing) : []
        };
    }

    get stage () {
        return this.targets.get(STAGE_KEY);
    }

    /**
     * @param {?string} name sprite name, or null/'Stage' for the stage
     * @returns {object} target info (created on first use)
     */
    target (name) {
        if (name === null || name === undefined || name === 'Stage' || name === '舞台' || name === STAGE_KEY) {
            return this.stage;
        }
        if (!this.targets.has(name)) {
            const existing = this.model.targets.find(t => !t.isStage && t.name === name) || null;
            this.targets.set(name, this.makeInfo(name, existing, false));
        }
        return this.targets.get(name);
    }

    spriteNames () {
        const names = new Set(this.model.targets.filter(t => !t.isStage).map(t => t.name));
        for (const key of this.targets.keys()) if (key !== STAGE_KEY) names.add(key);
        return Array.from(names);
    }

    findVariable (info, name, type = '') {
        const local = info.variables.find(v => v.name === name && v.type === type);
        if (local) return local;
        if (info.isStage) return null;
        return this.stage.variables.find(v => v.name === name && v.type === type) || null;
    }

    /**
     * Declare a variable; returns the existing one when the name is already taken.
     * @param {object} info target info
     * @param {string} name name
     * @param {string} type '' or 'list'
     * @param {*} value initial value
     * @returns {object} variable
     */
    declareVariable (info, name, type = '', value) {
        const existing = this.findVariable(info, name, type);
        if (existing) return existing;
        const variable = {
            id: uid(),
            name,
            type,
            value: value === undefined ? (type === 'list' ? [] : 0) : value
        };
        info.variables.push(variable);
        this.newVariables.push({target: info.key, ...variable});
        return variable;
    }

    /**
     * Resolve a variable used by a block, creating a global one when it was never declared.
     * @param {object} info target info
     * @param {string} name name
     * @param {string} type '' or 'list'
     * @returns {object} variable
     */
    useVariable (info, name, type = '') {
        const found = this.findVariable(info, name, type);
        if (found) return found;
        this.warnings.push(`${type === 'list' ? '清單' : '變數'}「${name}」沒有宣告，已自動建立為全域${type === 'list' ? '清單' : '變數'}。`);
        return this.declareVariable(this.stage, name, type);
    }

    broadcast (name) {
        const stage = this.stage;
        const found = stage.variables.find(v => v.type === 'broadcast_msg' && v.name === name);
        if (found) return found;
        const variable = {id: uid(), name, type: 'broadcast_msg', value: name};
        stage.variables.push(variable);
        this.newBroadcasts.push(variable);
        return variable;
    }

    addProcedure (info, procedure) {
        info.procedures.push(procedure);
    }

    findProcedure (info, proccode) {
        const exact = info.procedures.find(p => p.proccode === proccode);
        if (exact) return exact;
        const strip = text => String(text).replace(/%[snb]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const wanted = strip(proccode);
        return info.procedures.find(p => strip(p.proccode) === wanted) || null;
    }
}
