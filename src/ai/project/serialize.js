/**
 * Turn a project model into compact text for the AI (and readable text for reports).
 * Every non-shadow block gets a short alias like #12 so the AI can point at blocks;
 * `ids` maps aliases back to real block ids.
 */
import {PRIMITIVE_SHADOWS} from '../catalog/catalog.js';
import {topBlocks} from './model.js';

const quote = value => {
    const text = String(value);
    return /^-?\d+(\.\d+)?$/.test(text) ? text : JSON.stringify(text);
};

const MENU_FIELD_PREFERENCE = ['BROADCAST_OPTION'];

const shadowValue = shadow => {
    const primitive = PRIMITIVE_SHADOWS[shadow.opcode];
    if (primitive && shadow.fields[primitive[0]]) return quote(shadow.fields[primitive[0]].value);
    const fields = Object.values(shadow.fields);
    const preferred = fields.find(f => MENU_FIELD_PREFERENCE.includes(f.name)) || fields[0];
    if (preferred) return quote(preferred.value);
    return '()';
};

const SPECIAL_REPORTERS = {
    data_variable: b => `(var ${quote(b.fields.VARIABLE.value)})`,
    data_listcontents: b => `(list ${quote(b.fields.LIST.value)})`,
    argument_reporter_string_number: b => `(arg ${quote(b.fields.VALUE.value)})`,
    argument_reporter_boolean: b => `<arg ${quote(b.fields.VALUE.value)}>`
};

export class ProjectSerializer {
    constructor ({catalog = null, human = false} = {}) {
        this.catalog = catalog;
        this.human = human;
        this.ids = {};
        this.aliases = {};
        this.counter = 0;
    }

    alias (id) {
        if (!this.aliases[id]) {
            this.counter += 1;
            const name = `#${this.counter}`;
            this.aliases[id] = name;
            this.ids[name] = id;
        }
        return this.aliases[id];
    }

    inputText (blocks, input) {
        if (!input) return '()';
        const block = input.block ? blocks[input.block] : null;
        if (!block) return '()';
        if (block.shadow) return shadowValue(block);
        return this.reporterText(blocks, block);
    }

    reporterText (blocks, block) {
        if (SPECIAL_REPORTERS[block.opcode]) return SPECIAL_REPORTERS[block.opcode](block);
        const entry = this.catalog && this.catalog.blocks[block.opcode];
        const boolean = entry ? entry.shape === 'boolean' : /^operator_(and|or|not|gt|lt|equals|contains)$|^sensing_(touching|keypressed|mousedown|coloristouching)/.test(block.opcode);
        const body = this.callText(blocks, block);
        return boolean ? `<${body}>` : `(${body})`;
    }

    argsText (blocks, block) {
        const parts = [];
        for (const [name, input] of Object.entries(block.inputs)) {
            const target = input.block ? blocks[input.block] : null;
            if (target && !target.shadow && this.isSubstack(block, name, target)) continue;
            if (name === 'custom_block') continue;
            parts.push(`${name}=${this.inputText(blocks, input)}`);
        }
        for (const [name, field] of Object.entries(block.fields)) {
            parts.push(`${name}=${quote(field.value)}`);
        }
        return parts;
    }

    callText (blocks, block) {
        if (block.opcode === 'procedures_call' && block.mutation) {
            const ids = JSON.parse(block.mutation.argumentids || '[]');
            const args = ids.map(id => this.inputText(blocks, block.inputs[id]));
            return `call ${quote(block.mutation.proccode)}${args.length ? ` ${args.join(' ')}` : ''}`;
        }
        if (this.human && this.catalog && this.catalog.blocks[block.opcode]) {
            return this.labelText(blocks, block, this.catalog.blocks[block.opcode]);
        }
        const args = this.argsText(blocks, block);
        return `${block.opcode}${args.length ? ` ${args.join(' ')}` : ''}`;
    }

    labelText (blocks, block, entry) {
        return entry.label.replace(/\((\w+)\)|<(\w+)>|\[(\w+)▾?\]|\{(\w+)\}/g, (match, value, bool, field, statement) => {
            if (value || bool) return this.inputText(blocks, block.inputs[value || bool]);
            if (field) return block.fields[field] ? `[${block.fields[field].value}]` : match;
            if (statement) return '';
            return match;
        }).replace(/\s+/g, ' ')
            .trim();
    }

    stackLines (blocks, firstId, indent, lines) {
        let block = blocks[firstId];
        while (block) {
            if (block.opcode === 'procedures_definition') {
                const proto = blocks[block.inputs.custom_block && block.inputs.custom_block.block];
                const mutation = proto && proto.mutation || {};
                let names = [];
                try {
                    names = JSON.parse(mutation.argumentnames || '[]');
                } catch (e) {
                    names = [];
                }
                lines.push(`${indent}${this.alias(block.id)} define ${quote(mutation.proccode)}` +
                    `${names.length ? ` args=${JSON.stringify(names)}` : ''}${String(mutation.warp) === 'true' ? ' warp' : ''}`);
            } else {
                lines.push(`${indent}${this.alias(block.id)} ${this.callText(blocks, block)}`);
            }
            for (const [name, input] of Object.entries(block.inputs)) {
                const child = input.block ? blocks[input.block] : null;
                if (!child || child.shadow || name === 'custom_block') continue;
                if (child.parent === block.id && this.isSubstack(block, name, child)) {
                    lines.push(`${indent}  ${name}:`);
                    this.stackLines(blocks, child.id, `${indent}    `, lines);
                }
            }
            block = block.next ? blocks[block.next] : null;
        }
    }

    isSubstack (block, inputName, child) {
        const entry = this.catalog && this.catalog.blocks[block.opcode];
        if (entry) {
            const input = entry.inputs.find(i => i.name === inputName);
            if (input) return input.kind === 'statement';
        }
        // Without a catalog: statement inputs are conventionally SUBSTACK, SUBSTACK2, ...
        return /^SUBSTACK\d*$/.test(inputName) || !!child.next;
    }

    targetText (target) {
        const lines = [];
        lines.push(target.isStage ? '## 舞台 (Stage)' : `## 角色 ${quote(target.name)}`);
        const vars = target.variables.filter(v => v.type === '');
        const lists = target.variables.filter(v => v.type === 'list');
        const broadcasts = target.variables.filter(v => v.type === 'broadcast_msg');
        if (!target.isStage) {
            lines.push(`位置 x=${Math.round(target.x)} y=${Math.round(target.y)} 大小=${Math.round(target.size)} ` +
                `方向=${Math.round(target.direction)}${target.visible === false ? ' 隱藏' : ''}`);
        }
        lines.push(`${target.isStage ? '背景' : '造型'}: ${target.costumes.map(c => quote(c.name)).join(', ') || '（無）'}`);
        if (target.sounds.length) lines.push(`音效: ${target.sounds.map(s => quote(s.name)).join(', ')}`);
        if (vars.length) {
            lines.push(`${target.isStage ? '全域' : '區域'}變數: ${vars.map(v => `${quote(v.name)}=${quote(v.value)}`).join(', ')}`);
        }
        if (lists.length) lines.push(`${target.isStage ? '全域' : '區域'}清單: ${lists.map(v => quote(v.name)).join(', ')}`);
        if (broadcasts.length) lines.push(`廣播訊息: ${broadcasts.map(v => quote(v.name)).join(', ')}`);
        const scripts = topBlocks(target)
            .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
        if (scripts.length === 0) {
            lines.push('腳本: （無）');
        } else {
            lines.push(`腳本 (${scripts.length}):`);
            scripts.forEach(script => this.stackLines(target.blocks, script.id, '  ', lines));
        }
        return lines.join('\n');
    }

    projectText (model) {
        const stage = model.targets.filter(t => t.isStage);
        const sprites = model.targets.filter(t => !t.isStage);
        return [...stage, ...sprites].map(t => this.targetText(t)).join('\n\n');
    }
}

/**
 * @param {object} model project model
 * @param {object} [options] {catalog, human}
 * @returns {{text: string, ids: object, aliases: object}} text and alias maps
 */
export const projectToText = (model, options) => {
    const serializer = new ProjectSerializer(options);
    const text = serializer.projectText(model);
    return {text, ids: serializer.ids, aliases: serializer.aliases};
};

/** Find which target a block id belongs to. */
export const targetOfBlock = (model, blockId) => model.targets.find(t => t.blocks[blockId]) || null;
