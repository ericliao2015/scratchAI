/**
 * Compiles the AI's intermediate representation (see docs/SPEC.md §6) into VM blocks.
 * Compilation is pure: it reads the catalog and a project model and returns a plan
 * that apply.js executes against a VM.
 */
import uid from '../util/uid.js';
import {Scope, STAGE_KEY} from './scope.js';

const CORE_CATEGORIES = ['motion', 'looks', 'sound', 'events', 'control', 'sensing', 'operators', 'variables'];

// Menus whose valid values depend on the project (sprite, costume, sound names).
const DYNAMIC_MENUS = new Set([
    'motion_goto_menu', 'motion_glideto_menu', 'motion_pointtowards_menu',
    'looks_costume', 'looks_backdrops', 'sound_sounds_menu',
    'sensing_touchingobjectmenu', 'sensing_distancetomenu', 'sensing_of_object_menu',
    'control_create_clone_of_menu', 'videoSensing_menu_SUBJECT'
]);
const DYNAMIC_FIELDS = new Set(['sensing_of.PROPERTY', 'event_whenbackdropswitchesto.BACKDROP']);

const NUMBER_TYPES = new Set(['number', 'positive_number', 'whole_number', 'integer', 'angle', 'note']);

const SCRIPT_GAP = 48;
const BLOCK_HEIGHT = 48;

const isLiteral = value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const describe = value => {
    try {
        return JSON.stringify(value).slice(0, 80);
    } catch (e) {
        return String(value);
    }
};

class Compiler {
    constructor ({catalog, model}) {
        this.catalog = catalog;
        this.scope = new Scope(model);
        this.errors = [];
        this.plan = {sprites: [], scripts: [], stage: {backdrops: []}, explanation: ''};
    }

    error (path, message) {
        this.errors.push({path, message});
    }

    // ---- values -------------------------------------------------------------

    matchOption (options, value) {
        const text = String(value);
        const byValue = options.find(o => o.value === text);
        if (byValue) return byValue.value;
        const lower = text.toLowerCase();
        const byText = options.find(o => o.text.toLowerCase() === lower);
        return byText ? byText.value : null;
    }

    coerceMenu (value, {options, opcode, entry, acceptsText}, path) {
        if (!options || options.length === 0) return String(value);
        const matched = this.matchOption(options, value);
        if (matched !== null) return matched;
        if (acceptsText || DYNAMIC_MENUS.has(opcode)) return String(value);
        const list = options.slice(0, 25).map(o => o.value)
            .join(', ');
        if (entry && !CORE_CATEGORIES.includes(entry.category)) {
            this.scope.warnings.push(`${path}: 選單值 ${describe(value)} 不在清單中（${list}），已照原樣保留。`);
            return String(value);
        }
        this.error(path, `選單值 ${describe(value)} 不正確，可用的值：${list}`);
        return null;
    }

    coerceLiteral (value, shadow, path, entry) {
        switch (shadow.valueType) {
        case 'menu':
            return this.coerceMenu(value, {...shadow, entry}, path);
        case 'color': {
            const text = String(value).trim();
            if (/^#[0-9a-f]{6}$/i.test(text)) return text;
            this.error(path, `顏色必須是 #RRGGBB 格式，收到 ${describe(value)}`);
            return null;
        }
        case 'matrix': {
            const text = String(value);
            if (/^[01]{25}$/.test(text)) return text;
            this.error(path, `矩陣必須是 25 個 0/1 字元，收到 ${describe(value)}`);
            return null;
        }
        default:
            if (NUMBER_TYPES.has(shadow.valueType)) {
                const number = Number(value);
                if (typeof value === 'boolean' || value === '' || !Number.isFinite(number)) {
                    this.error(path, `這裡需要數字，收到 ${describe(value)}。若要放變數請用 {"var": "名稱"}。`);
                    return null;
                }
                return String(value);
            }
            return String(value);
        }
    }

    // ---- block construction --------------------------------------------------

    newBlock (opcode, parent, {shadow = false} = {}) {
        const block = {
            id: uid(),
            opcode,
            inputs: {},
            fields: {},
            next: null,
            parent: parent || null,
            shadow,
            topLevel: !parent
        };
        this.ctx.blocks.push(block);
        return block;
    }

    makeShadow (shadowDesc, parentId, value) {
        const shadow = this.newBlock(shadowDesc.opcode, parentId, {shadow: true});
        if (shadowDesc.valueType === 'broadcast') {
            const variable = this.scope.broadcast(String(typeof value === 'undefined' || value === null ? shadowDesc.value : value));
            shadow.fields[shadowDesc.field] = {
                name: shadowDesc.field, value: variable.name, id: variable.id, variableType: 'broadcast_msg'
            };
        } else if (shadowDesc.field) {
            shadow.fields[shadowDesc.field] = {
                name: shadowDesc.field,
                value: typeof value === 'undefined' || value === null ? String(shadowDesc.value) : value
            };
        }
        return shadow;
    }

    compileValueInput (block, entry, inputDesc, spec, path) {
        const shadowDesc = inputDesc.shadow && inputDesc.shadow.field ? inputDesc.shadow : null;
        const name = inputDesc.name;
        if (typeof spec === 'undefined' || spec === null) {
            if (shadowDesc) {
                const shadow = this.makeShadow(shadowDesc, block.id);
                block.inputs[name] = {name, block: shadow.id, shadow: shadow.id};
            }
            return;
        }
        if (isLiteral(spec)) {
            if (!shadowDesc) {
                this.error(path, inputDesc.valueType === 'boolean' ?
                    '這個輸入只能放六角形的條件積木，不能直接填值。' :
                    '這個輸入不能直接填值，只能放積木。');
                return;
            }
            if (shadowDesc.valueType === 'broadcast') {
                const shadow = this.makeShadow(shadowDesc, block.id, String(spec));
                block.inputs[name] = {name, block: shadow.id, shadow: shadow.id};
                return;
            }
            const value = this.coerceLiteral(spec, shadowDesc, path, entry);
            if (value === null) return;
            const shadow = this.makeShadow(shadowDesc, block.id, value);
            block.inputs[name] = {name, block: shadow.id, shadow: shadow.id};
            return;
        }
        if (Array.isArray(spec)) {
            this.error(path, '這個輸入是數值輸入，不能放一串積木。');
            return;
        }
        const childId = this.compileNode(spec, block.id, path, {
            position: 'value',
            boolean: inputDesc.valueType === 'boolean'
        });
        if (!childId) return;
        const shadow = shadowDesc ? this.makeShadow(shadowDesc, block.id) : null;
        block.inputs[name] = {name, block: childId, shadow: shadow ? shadow.id : null};
    }

    compileField (block, entry, fieldDesc, spec, path) {
        const name = fieldDesc.name;
        if (fieldDesc.kind === 'variable') {
            const type = fieldDesc.variableType || '';
            if (typeof spec === 'undefined' || spec === null || spec === '') {
                this.error(path, `需要指定${type === 'list' ? '清單' : (type === 'broadcast_msg' ? '廣播訊息' : '變數')}名稱。`);
                return;
            }
            const variableName = typeof spec === 'object' ? (spec.var || spec.list || spec.name) : String(spec);
            const variable = type === 'broadcast_msg' ?
                this.scope.broadcast(String(variableName)) :
                this.scope.useVariable(this.ctx.info, String(variableName), type);
            block.fields[name] = {name, value: variable.name, id: variable.id, variableType: type};
            return;
        }
        if (typeof spec === 'undefined' || spec === null) {
            block.fields[name] = {name, value: typeof fieldDesc.value === 'undefined' ? '' : String(fieldDesc.value)};
            return;
        }
        if (!isLiteral(spec)) {
            this.error(path, `欄位 ${name} 只能填文字或數字。`);
            return;
        }
        let value = String(spec);
        if (fieldDesc.kind === 'dropdown' && fieldDesc.options && fieldDesc.options.length) {
            const lenient = DYNAMIC_FIELDS.has(`${entry.opcode}.${name}`);
            value = this.coerceMenu(spec, {
                options: fieldDesc.options,
                opcode: entry.opcode,
                entry,
                acceptsText: lenient
            }, path);
            if (value === null) return;
        }
        block.fields[name] = {name, value};
    }

    // ---- nodes --------------------------------------------------------------

    compileSpecialReporter (node, parentId, path, {boolean}) {
        if (typeof node.var !== 'undefined') {
            if (boolean) this.error(path, '六角形的條件輸入不能直接放變數，請用比較積木（例如 operator_equals）。');
            const variable = this.scope.useVariable(this.ctx.info, String(node.var), '');
            const block = this.newBlock('data_variable', parentId);
            block.fields.VARIABLE = {name: 'VARIABLE', value: variable.name, id: variable.id, variableType: ''};
            return block.id;
        }
        if (typeof node.list !== 'undefined') {
            const variable = this.scope.useVariable(this.ctx.info, String(node.list), 'list');
            const block = this.newBlock('data_listcontents', parentId);
            block.fields.LIST = {name: 'LIST', value: variable.name, id: variable.id, variableType: 'list'};
            return block.id;
        }
        // {arg: name}
        const argName = String(node.arg);
        const args = this.ctx.procArgs;
        if (!args || !args.has(argName)) {
            this.error(path, `參數「${argName}」只能在定義它的自訂積木裡使用。`);
            return null;
        }
        const isBool = args.get(argName) === 'boolean';
        if (boolean && !isBool) this.error(path, `參數「${argName}」不是布林參數，不能放在六角形輸入。`);
        const block = this.newBlock(isBool ? 'argument_reporter_boolean' : 'argument_reporter_string_number', parentId);
        block.fields.VALUE = {name: 'VALUE', value: argName};
        return block.id;
    }

    compileCall (node, parentId, path) {
        const proccode = node.call || node.proccode;
        const procedure = this.scope.findProcedure(this.ctx.info, proccode);
        if (!procedure) {
            const known = this.ctx.info.procedures.map(p => p.proccode).join(', ') || '（無）';
            this.error(path, `找不到自訂積木「${proccode}」。這個角色的自訂積木：${known}`);
            return null;
        }
        const args = Array.isArray(node.args) ? node.args : [];
        if (args.length !== procedure.argumentids.length) {
            this.error(path, `自訂積木「${procedure.proccode}」需要 ${procedure.argumentids.length} 個參數，收到 ${args.length} 個。`);
        }
        const block = this.newBlock('procedures_call', parentId);
        block.mutation = {
            tagName: 'mutation',
            children: [],
            proccode: procedure.proccode,
            argumentids: JSON.stringify(procedure.argumentids),
            warp: String(!!procedure.warp)
        };
        const types = (procedure.proccode.match(/%[snb]/g) || []);
        procedure.argumentids.forEach((argId, index) => {
            const spec = args[index];
            const isBool = types[index] === '%b';
            const argPath = `${path}.args[${index}]`;
            if (isBool) {
                if (typeof spec !== 'undefined' && spec !== null) {
                    if (isLiteral(spec)) {
                        this.error(argPath, '布林參數只能放條件積木。');
                    } else {
                        const childId = this.compileNode(spec, block.id, argPath, {position: 'value', boolean: true});
                        if (childId) block.inputs[argId] = {name: argId, block: childId, shadow: null};
                    }
                }
                return;
            }
            const shadowDesc = {opcode: 'text', field: 'TEXT', valueType: 'text', value: ''};
            if (typeof spec === 'undefined' || spec === null || isLiteral(spec)) {
                const shadow = this.makeShadow(shadowDesc, block.id, typeof spec === 'undefined' || spec === null ? '' : String(spec));
                block.inputs[argId] = {name: argId, block: shadow.id, shadow: shadow.id};
            } else {
                const childId = this.compileNode(spec, block.id, argPath, {position: 'value', boolean: false});
                const shadow = this.makeShadow(shadowDesc, block.id, '');
                if (childId) block.inputs[argId] = {name: argId, block: childId, shadow: shadow.id};
            }
        });
        return block.id;
    }

    /**
     * @param {object} node IR block node
     * @param {?string} parentId parent block id
     * @param {string} path path used in error messages
     * @param {object} options {position: 'stack'|'value', boolean}
     * @returns {?string} id of the compiled block
     */
    compileNode (node, parentId, path, {position, boolean = false}) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
            this.error(path, `應該是一個積木物件，收到 ${describe(node)}`);
            return null;
        }
        if (typeof node.var !== 'undefined' || typeof node.list !== 'undefined' || typeof node.arg !== 'undefined') {
            if (position === 'stack') {
                this.error(path, '變數／清單／參數是圓形積木，不能單獨放在腳本裡。');
                return null;
            }
            return this.compileSpecialReporter(node, parentId, path, {boolean});
        }
        if (typeof node.call !== 'undefined' || node.opcode === 'procedures_call') {
            if (position === 'value') {
                this.error(path, '自訂積木是堆疊積木，不能放在輸入裡。');
                return null;
            }
            return this.compileCall(node, parentId, path);
        }
        const opcode = node.opcode;
        const entry = opcode && this.catalog.blocks[opcode];
        if (!entry) {
            this.error(path, `沒有這個積木：${describe(opcode)}。請只使用積木清單中的 opcode。`);
            return null;
        }
        const kind = this.ctx.info.isStage ? 'stage' : 'sprite';
        if (entry.targets && !entry.targets.includes(kind)) {
            this.error(path, `${opcode} 不能用在${kind === 'stage' ? '舞台' : '角色'}上。`);
        }
        const isReporter = entry.shape === 'reporter' || entry.shape === 'boolean';
        if (position === 'value' && !isReporter) {
            this.error(path, `${opcode} 是堆疊積木，不能放在輸入裡。`);
            return null;
        }
        if (position === 'stack' && isReporter) {
            this.error(path, `${opcode} 是圓形/六角形積木，只能放在其他積木的輸入裡。`);
            return null;
        }
        if (boolean && entry.shape !== 'boolean') {
            this.error(path, `${opcode} 不是條件（六角形）積木，不能放在條件輸入裡。`);
            return null;
        }

        const block = this.newBlock(opcode, parentId);
        const inputs = {...(node.inputs || {})};
        const fields = {...(node.fields || {})};
        const substacks = {...(node.substacks || {})};
        // Be forgiving about where the AI put things.
        for (const field of entry.fields) {
            if (typeof fields[field.name] === 'undefined' && typeof inputs[field.name] !== 'undefined') {
                fields[field.name] = inputs[field.name];
                delete inputs[field.name];
            }
        }
        for (const input of entry.inputs) {
            if (input.kind === 'statement' && Array.isArray(inputs[input.name])) {
                substacks[input.name] = inputs[input.name];
                delete inputs[input.name];
            }
            if (input.kind === 'value' && typeof inputs[input.name] === 'undefined' && typeof fields[input.name] !== 'undefined') {
                inputs[input.name] = fields[input.name];
                delete fields[input.name];
            }
        }
        const knownInputs = new Set(entry.inputs.map(i => i.name));
        const knownFields = new Set(entry.fields.map(f => f.name));
        for (const name of [...Object.keys(inputs), ...Object.keys(substacks)]) {
            if (!knownInputs.has(name)) {
                this.error(`${path}.inputs.${name}`, `${opcode} 沒有輸入 ${name}。可用的輸入：${Array.from(knownInputs).join(', ') || '（無）'}`);
            }
        }
        for (const name of Object.keys(fields)) {
            if (!knownFields.has(name)) {
                this.error(`${path}.fields.${name}`, `${opcode} 沒有欄位 ${name}。可用的欄位：${Array.from(knownFields).join(', ') || '（無）'}`);
            }
        }

        for (const fieldDesc of entry.fields) {
            this.compileField(block, entry, fieldDesc, fields[fieldDesc.name], `${path}.fields.${fieldDesc.name}`);
        }
        for (const inputDesc of entry.inputs) {
            if (inputDesc.kind === 'statement') {
                const stack = substacks[inputDesc.name];
                if (typeof stack === 'undefined' || stack === null) continue;
                if (!Array.isArray(stack)) {
                    this.error(`${path}.substacks.${inputDesc.name}`, '這裡需要一串積木（陣列）。');
                    continue;
                }
                const first = this.compileStack(stack, block.id, `${path}.substacks.${inputDesc.name}`);
                if (first) block.inputs[inputDesc.name] = {name: inputDesc.name, block: first, shadow: null};
            } else {
                this.compileValueInput(block, entry, inputDesc, inputs[inputDesc.name], `${path}.inputs.${inputDesc.name}`);
            }
        }

        if (opcode === 'control_stop') {
            const option = block.fields.STOP_OPTION ? block.fields.STOP_OPTION.value : 'all';
            block.mutation = {
                tagName: 'mutation',
                children: [],
                hasnext: String(option === 'other scripts in sprite' || option === 'other scripts in stage')
            };
        } else if (entry.mutation && !block.mutation) {
            const match = /<mutation([^>]*)>/.exec(entry.mutation);
            if (match) {
                const mutation = {tagName: 'mutation', children: []};
                match[1].replace(/(\w+)="([^"]*)"/g, (m, key, value) => {
                    mutation[key] = value;
                });
                block.mutation = mutation;
            }
        }
        return block.id;
    }

    isTerminal (blockId) {
        const block = this.ctx.blocks.find(b => b.id === blockId);
        if (!block) return false;
        if (block.opcode === 'control_stop') return block.mutation.hasnext !== 'true';
        const entry = this.catalog.blocks[block.opcode];
        return !!entry && (entry.shape === 'cap' || entry.terminal);
    }

    /**
     * @param {Array} nodes IR nodes
     * @param {?string} parentId parent block id (null for top level)
     * @param {string} path path for errors
     * @param {object} options {allowHat}
     * @returns {?string} id of the first block
     */
    compileStack (nodes, parentId, path, {allowHat = false} = {}) {
        let firstId = null;
        let previousId = null;
        let terminated = false;
        nodes.forEach((node, index) => {
            const nodePath = `${path}[${index}]`;
            if (terminated) {
                this.error(nodePath, '前一個積木會結束腳本（例如「重複無限次」或「停止全部」），後面不能再接積木。');
            }
            const entry = node && node.opcode && this.catalog.blocks[node.opcode];
            if (entry && entry.shape === 'hat' && !(allowHat && index === 0)) {
                this.error(nodePath, `${node.opcode} 是事件（帽子）積木，只能放在腳本的第一個。`);
                return;
            }
            const id = this.compileNode(node, previousId || parentId, nodePath, {position: 'stack'});
            if (!id) return;
            const block = this.ctx.blocks.find(b => b.id === id);
            if (previousId) {
                const previous = this.ctx.blocks.find(b => b.id === previousId);
                previous.next = id;
                block.parent = previousId;
                block.topLevel = false;
            } else {
                firstId = id;
                block.parent = parentId || null;
                block.topLevel = !parentId;
            }
            previousId = id;
            if (this.isTerminal(id)) terminated = true;
        });
        return firstId;
    }

    // ---- procedures ---------------------------------------------------------

    normalizeProcedure (spec, path) {
        const args = Array.isArray(spec.args) ? spec.args.map(a => (typeof a === 'string' ? {name: a} : a)) : [];
        let proccode = String(spec.proccode || spec.name || '').trim();
        if (!proccode) {
            this.error(path, '自訂積木需要名稱（proccode）。');
            return null;
        }
        const placeholders = proccode.match(/%[snb]/g) || [];
        if (placeholders.length === 0 && args.length > 0) {
            proccode = `${proccode} ${args.map(a => (a.type === 'boolean' ? '%b' : '%s')).join(' ')}`;
        } else if (placeholders.length !== args.length) {
            this.error(path, `proccode「${proccode}」有 ${placeholders.length} 個 %s/%b，但 args 有 ${args.length} 個。`);
            return null;
        }
        const types = proccode.match(/%[snb]/g) || [];
        return {
            proccode,
            argumentids: args.map(() => uid()),
            argumentnames: args.map(a => String(a.name)),
            argumentdefaults: types.map(t => (t === '%b' ? 'false' : '')),
            argumentTypes: types.map(t => (t === '%b' ? 'boolean' : 'string')),
            warp: !!spec.warp,
            body: Array.isArray(spec.body) ? spec.body : []
        };
    }

    compileProcedureDefinition (procedure, path, position) {
        const definition = this.newBlock('procedures_definition', null);
        definition.x = position.x;
        definition.y = position.y;
        const prototype = this.newBlock('procedures_prototype', definition.id, {shadow: true});
        prototype.topLevel = false;
        prototype.mutation = {
            tagName: 'mutation',
            children: [],
            proccode: procedure.proccode,
            argumentids: JSON.stringify(procedure.argumentids),
            argumentnames: JSON.stringify(procedure.argumentnames),
            argumentdefaults: JSON.stringify(procedure.argumentdefaults),
            warp: String(procedure.warp)
        };
        procedure.argumentids.forEach((argId, index) => {
            const isBool = procedure.argumentTypes[index] === 'boolean';
            const reporter = this.newBlock(isBool ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
                prototype.id, {shadow: true});
            reporter.topLevel = false;
            reporter.fields.VALUE = {name: 'VALUE', value: procedure.argumentnames[index]};
            prototype.inputs[argId] = {name: argId, block: reporter.id, shadow: reporter.id};
        });
        definition.inputs.custom_block = {name: 'custom_block', block: prototype.id, shadow: prototype.id};

        this.ctx.procArgs = new Map(procedure.argumentnames.map((name, i) => [name, procedure.argumentTypes[i]]));
        const first = this.compileStack(procedure.body, definition.id, `${path}.body`);
        this.ctx.procArgs = null;
        if (first) {
            definition.next = first;
            const block = this.ctx.blocks.find(b => b.id === first);
            block.parent = definition.id;
            block.topLevel = false;
        }
        return definition;
    }

    // ---- targets ------------------------------------------------------------

    /**
     * Compile scripts and procedures for one target.
     * @param {object} info target info from the scope
     * @param {object} spec {scripts, procedures}
     * @param {string} path path for errors
     */
    compileTargetCode (info, spec, path) {
        const blocks = [];
        this.ctx = {info, blocks, procArgs: null};
        const procedures = (Array.isArray(spec.procedures) ? spec.procedures : [])
            .map((p, i) => this.normalizeProcedure(p || {}, `${path}.procedures[${i}]`))
            .filter(Boolean);
        procedures.forEach(p => this.scope.addProcedure(info, p));

        let y = 0;
        const place = top => {
            top.x = 0;
            top.y = y;
            y += SCRIPT_GAP + (BLOCK_HEIGHT * this.countStack(top.id));
        };
        procedures.forEach((procedure, i) => {
            const definition = this.compileProcedureDefinition(procedure, `${path}.procedures[${i}]`, {x: 0, y});
            place(definition);
        });
        (Array.isArray(spec.scripts) ? spec.scripts : []).forEach((script, i) => {
            const scriptPath = `${path}.scripts[${i}]`;
            let nodes = null;
            if (Array.isArray(script)) nodes = script;
            else if (script && Array.isArray(script.blocks)) nodes = script.blocks;
            if (!nodes) {
                this.error(scriptPath, '每個腳本必須是積木陣列。');
                return;
            }
            const first = this.compileStack(nodes, null, scriptPath, {allowHat: true});
            if (first) place(this.ctx.blocks.find(b => b.id === first));
        });
        if (blocks.length) this.plan.scripts.push({target: info.key, blocks});
        this.ctx = null;
    }

    /**
     * Number of stack blocks in a script including C-block contents, used to space scripts out.
     * @param {string} firstId first block of the script
     * @returns {number} block count
     */
    countStack (firstId) {
        const byId = new Map(this.ctx.blocks.map(b => [b.id, b]));
        let count = 0;
        const visit = id => {
            const block = byId.get(id);
            if (!block) return;
            count += 1;
            for (const input of Object.values(block.inputs)) {
                const child = byId.get(input.block);
                if (child && !child.shadow && child.parent === block.id && !this.isReporter(child)) visit(child.id);
            }
            if (block.next) visit(block.next);
        };
        visit(firstId);
        return count;
    }

    isReporter (block) {
        if (/^(data_variable|data_listcontents|argument_reporter_)/.test(block.opcode)) return true;
        const entry = this.catalog.blocks[block.opcode];
        return !!entry && (entry.shape === 'reporter' || entry.shape === 'boolean');
    }

    declareTargetData (info, spec, path) {
        for (const [key, type] of [['variables', ''], ['lists', 'list']]) {
            (Array.isArray(spec[key]) ? spec[key] : []).forEach((v, i) => {
                const variable = typeof v === 'string' ? {name: v} : v;
                if (!variable || !variable.name) {
                    this.error(`${path}.${key}[${i}]`, '需要名稱。');
                    return;
                }
                let value = typeof variable.value === 'undefined' ? 0 : variable.value;
                if (type === 'list') {
                    const items = Array.isArray(variable.items) ? variable.items : variable.value;
                    value = Array.isArray(items) ? items.map(String) : [];
                }
                this.scope.declareVariable(info, String(variable.name), type, value);
            });
        }
    }

    compileProgram (ir) {
        if (!ir || typeof ir !== 'object') {
            this.error('', '輸出必須是 JSON 物件。');
            return;
        }
        this.plan.explanation = typeof ir.explanation === 'string' ? ir.explanation : '';
        (Array.isArray(ir.broadcasts) ? ir.broadcasts : []).forEach(name => this.scope.broadcast(String(name)));

        const stageSpec = ir.stage && typeof ir.stage === 'object' ? ir.stage : {};
        const sprites = Array.isArray(ir.sprites) ? ir.sprites : [];

        // Declarations first so scripts can use variables of any target.
        this.declareTargetData(this.scope.stage, stageSpec, 'stage');
        const spriteInfos = sprites.map((sprite, i) => {
            const path = `sprites[${i}]`;
            if (!sprite || !sprite.name) {
                this.error(path, '角色需要名稱（name）。');
                return null;
            }
            const info = this.scope.target(String(sprite.name));
            this.declareTargetData(info, sprite, path);
            this.plan.sprites.push({
                name: String(sprite.name),
                isNew: !info.existing,
                costumes: Array.isArray(sprite.costumes) ? sprite.costumes : [],
                sounds: Array.isArray(sprite.sounds) ? sprite.sounds : [],
                props: ['x', 'y', 'size', 'direction', 'visible', 'rotationStyle', 'draggable']
                    .filter(key => typeof sprite[key] !== 'undefined')
                    .reduce((acc, key) => ({...acc, [key]: sprite[key]}), {})
            });
            return info;
        });
        this.plan.stage.backdrops = Array.isArray(stageSpec.backdrops) ? stageSpec.backdrops : [];

        this.compileTargetCode(this.scope.stage, stageSpec, 'stage');
        sprites.forEach((sprite, i) => {
            if (spriteInfos[i]) this.compileTargetCode(spriteInfos[i], sprite, `sprites[${i}]`);
        });
    }

    result () {
        return {
            plan: {
                ...this.plan,
                variables: this.scope.newVariables,
                broadcasts: this.scope.newBroadcasts
            },
            errors: this.errors,
            warnings: this.scope.warnings
        };
    }
}

/**
 * @param {object} ir program IR
 * @param {object} options {catalog, model}
 * @returns {{plan: object, errors: Array, warnings: Array}} compile result
 */
export const compileProgram = (ir, {catalog, model}) => {
    const compiler = new Compiler({catalog, model});
    compiler.compileProgram(ir);
    return compiler.result();
};

/**
 * Compile a single list of scripts for one existing target (used by patch ops).
 * @param {Array} scripts IR scripts
 * @param {object} options {catalog, model, target}
 * @returns {{plan: object, errors: Array, warnings: Array}} compile result
 */
export const compileScripts = (scripts, {catalog, model, target, procedures}) => {
    const compiler = new Compiler({catalog, model});
    const info = compiler.scope.target(target);
    compiler.compileTargetCode(info, {scripts, procedures}, 'scripts');
    return compiler.result();
};

/**
 * Compile one reporter/boolean node for an input of an existing block (used by patch ops).
 * @param {object} node IR value node
 * @param {object} options {catalog, model, target, boolean, parentId}
 * @returns {{plan: object, errors: Array, warnings: Array, rootId: ?string}} result
 */
export const compileValue = (node, {catalog, model, target, boolean = false, parentId = null}) => {
    const compiler = new Compiler({catalog, model});
    const info = compiler.scope.target(target);
    const blocks = [];
    compiler.ctx = {info, blocks, procArgs: null};
    const rootId = compiler.compileNode(node, parentId, 'value', {position: 'value', boolean});
    compiler.plan.scripts.push({target: info.key, blocks});
    const result = compiler.result();
    return {...result, rootId};
};

/**
 * Compile a stack of blocks to be inserted into an existing script (used by patch ops).
 * @param {Array} nodes IR nodes
 * @param {object} options {catalog, model, target}
 * @returns {{plan: object, errors: Array, warnings: Array, firstId: ?string}} result
 */
export const compileStackForInsert = (nodes, {catalog, model, target}) => {
    const compiler = new Compiler({catalog, model});
    const info = compiler.scope.target(target);
    const blocks = [];
    compiler.ctx = {info, blocks, procArgs: null};
    const firstId = compiler.compileStack(Array.isArray(nodes) ? nodes : [nodes], null, 'blocks');
    compiler.plan.scripts.push({target: info.key, blocks});
    return {...compiler.result(), firstId};
};

export {STAGE_KEY};
