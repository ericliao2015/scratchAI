/**
 * Builds the catalog of blocks the AI may use from what the editor's toolbox shows:
 * core categories, the dynamic Variables category and every loaded extension
 * (official or third party). Must run in the browser after scratch-blocks has loaded.
 */

// Shadow block types that hold a plain value, mapped to [field name, value type].
export const PRIMITIVE_SHADOWS = {
    math_number: ['NUM', 'number'],
    math_positive_number: ['NUM', 'positive_number'],
    math_whole_number: ['NUM', 'whole_number'],
    math_integer: ['NUM', 'integer'],
    math_angle: ['NUM', 'angle'],
    text: ['TEXT', 'text'],
    colour_picker: ['COLOUR', 'color'],
    note: ['NOTE', 'note'],
    matrix: ['MATRIX', 'matrix'],
    event_broadcast_menu: ['BROADCAST_OPTION', 'broadcast']
};

const INPUT_VALUE = 1;
const NEXT_STATEMENT = 3;

const fieldText = text => {
    if (typeof text === 'string') return text;
    if (text && typeof text === 'object') return text.alt || text.src || '';
    return String(text);
};

const optionList = field => {
    try {
        const options = field.getOptions();
        return options
            .filter(o => Array.isArray(o) && o.length >= 2)
            .map(([text, value]) => ({text: fieldText(text), value: String(value)}));
    } catch (e) {
        return null;
    }
};

const describeField = (SB, field) => {
    const base = {name: field.name};
    if (SB.FieldVariableGetter && field instanceof SB.FieldVariableGetter) {
        return {...base, kind: 'variable', variableType: field.variableTypes_ ? field.variableTypes_[0] : ''};
    }
    if (field instanceof SB.FieldVariable) {
        const types = field.variableTypes_ || (field.getVariableTypes_ ? field.getVariableTypes_() : ['']);
        return {...base, kind: 'variable', variableType: types && types.length ? types[0] : ''};
    }
    if (field instanceof SB.FieldDropdown) {
        return {...base, kind: 'dropdown', options: optionList(field), value: field.getValue()};
    }
    if (SB.FieldNumber && field instanceof SB.FieldNumber) {
        return {...base, kind: 'number', value: field.getValue()};
    }
    return {...base, kind: 'text', value: field.getValue ? field.getValue() : ''};
};

const shapeOf = block => {
    if (block.outputConnection) {
        const check = block.outputConnection.check_;
        return check && check.includes('Boolean') ? 'boolean' : 'reporter';
    }
    const hasStatement = block.inputList.some(i => i.type === NEXT_STATEMENT);
    if (!block.previousConnection) return 'hat';
    if (hasStatement) return 'c';
    return block.nextConnection ? 'stack' : 'cap';
};

const describeShadow = (SB, shadow) => {
    if (!shadow) return null;
    const primitive = PRIMITIVE_SHADOWS[shadow.type];
    if (primitive) {
        const field = shadow.getField(primitive[0]);
        // Variable-like fields (broadcast menus) store an id; the name is the text.
        const value = field ? (primitive[1] === 'broadcast' ? field.getText() : field.getValue()) : '';
        return {opcode: shadow.type, field: primitive[0], valueType: primitive[1], value};
    }
    // Menu shadow: a block with a single dropdown field.
    const fields = [];
    shadow.inputList.forEach(input => input.fieldRow.forEach(f => {
        if (f.name) fields.push(f);
    }));
    if (fields.length === 1) {
        const field = fields[0];
        const description = describeField(SB, field);
        return {
            opcode: shadow.type,
            field: field.name,
            valueType: 'menu',
            value: field.getValue(),
            options: description.options || null,
            // Some extension menus accept typed text as well as menu values.
            acceptsText: !(field instanceof SB.FieldDropdown)
        };
    }
    return {opcode: shadow.type, field: null, valueType: 'other', value: null};
};

/**
 * Describe one block instance.
 * @param {object} SB ScratchBlocks
 * @param {object} block a headless Blockly block
 * @param {string} category category id
 * @returns {object} catalog entry
 */
const describeBlock = (SB, block, category) => {
    const labelParts = [];
    const inputs = [];
    const fields = [];
    for (const input of block.inputList) {
        for (const field of input.fieldRow) {
            if (field.name) {
                const description = describeField(SB, field);
                fields.push(description);
                labelParts.push(`[${field.name}${description.kind === 'dropdown' ? '▾' : ''}]`);
            } else if (!(SB.FieldImage && field instanceof SB.FieldImage)) {
                const text = field.getText ? field.getText() : '';
                if (text && text.trim()) labelParts.push(text.trim());
            }
        }
        if (input.type === INPUT_VALUE) {
            const check = input.connection && input.connection.check_;
            const shadow = describeShadow(SB, input.connection && input.connection.targetBlock());
            const isBoolean = !!(check && check.includes('Boolean'));
            inputs.push({
                name: input.name,
                kind: 'value',
                valueType: isBoolean ? 'boolean' : (shadow ? shadow.valueType : 'any'),
                shadow: isBoolean ? null : shadow
            });
            labelParts.push(isBoolean ? `<${input.name}>` : `(${input.name})`);
        } else if (input.type === NEXT_STATEMENT) {
            inputs.push({name: input.name, kind: 'statement'});
            labelParts.push(`{${input.name}}`);
        }
    }
    const entry = {
        opcode: block.type,
        category,
        shape: shapeOf(block),
        label: labelParts.join(' '),
        inputs,
        fields
    };
    if (block.previousConnection && !block.nextConnection && entry.shape === 'c') entry.terminal = true;
    if (block.mutationToDom) {
        try {
            const mutation = block.mutationToDom();
            if (mutation) entry.mutation = SB.Xml.domToText(mutation);
        } catch (e) {
            // ignore
        }
    }
    return entry;
};

const categoryId = element => {
    const id = element.getAttribute('id') || '';
    return id || element.getAttribute('name') || 'other';
};

const createHeadlessWorkspace = SB => {
    const ws = new SB.Workspace({});
    ws.registerButtonCallback = () => {};
    ws.registerToolboxCategoryCallback = () => {};
    return ws;
};

/**
 * @param {object} options options
 * @param {object} options.ScratchBlocks the loaded scratch-blocks instance
 * @param {Element} options.toolbox toolbox XML root (workspace.options.languageTree)
 * @param {boolean} [options.isStage] whether the editing target is the stage
 * @returns {{blocks: object, categories: Array}} catalog keyed by opcode
 */
export const buildCatalog = ({ScratchBlocks: SB, toolbox, isStage = false}) => {
    const ws = createHeadlessWorkspace(SB);
    ws.createVariable('my variable', '', 'scratchai-var');
    ws.createVariable('my list', 'list', 'scratchai-list');

    const blocks = {};
    const categories = [];
    const add = (element, category) => {
        const type = element.getAttribute('type');
        if (!type || blocks[type] || !SB.Blocks[type]) return;
        let block = null;
        try {
            block = SB.Xml.domToBlock(element, ws);
            blocks[type] = describeBlock(SB, block, category);
        } catch (e) {
            // A block that cannot be created headless is simply not offered to the AI.
        } finally {
            if (block) block.dispose(false);
        }
    };

    for (const category of Array.from(toolbox.querySelectorAll('category'))) {
        const id = categoryId(category);
        const name = category.getAttribute('name') || id;
        const custom = category.getAttribute('custom');
        const before = Object.keys(blocks).length;
        if (custom === 'VARIABLE') {
            for (const element of SB.DataCategory(ws)) {
                if (element.nodeName && element.nodeName.toLowerCase() === 'block') add(element, id);
            }
        } else if (custom === 'PROCEDURE') {
            // Custom blocks are described by the IR directly, not by catalog entries.
        } else {
            for (const element of Array.from(category.children)) {
                if (element.nodeName.toLowerCase() === 'block') add(element, id);
            }
        }
        categories.push({
            id,
            name: name.replace(/^%\{BKY_CATEGORY_(\w+)\}$/, (m, key) => key.toLowerCase()),
            count: Object.keys(blocks).length - before,
            extension: !['motion', 'looks', 'sound', 'events', 'control', 'sensing', 'operators',
                'variables', 'myBlocks'].includes(id)
        });
    }
    ws.dispose();
    return {blocks, categories, isStage};
};

const lastName = items => (items && items.length ? items[items.length - 1].name : '');

const toolboxFor = (SB, vm, target, makeToolboxXML) => {
    const stage = vm.runtime.getTargetForStage();
    const xml = makeToolboxXML(
        false,
        target.isStage,
        target.id,
        vm.runtime.getBlocksXML(target),
        lastName(target.getCostumes()),
        lastName(stage.getCostumes()),
        lastName(target.getSounds())
    );
    return SB.Xml.textToDom(xml);
};

/**
 * Merge the sprite and stage catalogs. Each entry gets `targets`: which kinds of
 * target can use it ('sprite', 'stage').
 * @param {?object} spriteCatalog catalog built from a sprite's toolbox
 * @param {?object} stageCatalog catalog built from the stage's toolbox
 * @returns {object} merged catalog
 */
export const mergeCatalogs = (spriteCatalog, stageCatalog) => {
    const blocks = {};
    const categories = [];
    const seen = new Set();
    for (const [kind, catalog] of [['sprite', spriteCatalog], ['stage', stageCatalog]]) {
        if (!catalog) continue;
        for (const [opcode, entry] of Object.entries(catalog.blocks)) {
            if (blocks[opcode]) blocks[opcode].targets.push(kind);
            else blocks[opcode] = {...entry, targets: [kind]};
        }
        for (const category of catalog.categories) {
            if (!seen.has(category.id)) {
                seen.add(category.id);
                categories.push(category);
            }
        }
    }
    return {blocks, categories};
};

/**
 * Get the catalog for the editor's current state: everything a sprite or the stage
 * can use, including all loaded extensions.
 * @param {object} vm the VM
 * @param {function} makeToolboxXML the GUI's toolbox builder
 * @returns {?object} catalog, or null when the editor is not ready
 */
export const buildCatalogFromEditor = (vm, makeToolboxXML) => {
    const SB = typeof window !== 'undefined' && window.ScratchBlocks;
    if (!SB || !SB.Xml || !vm || !vm.runtime.getTargetForStage()) return null;
    const stage = vm.runtime.getTargetForStage();
    const editing = vm.editingTarget;
    const sprite = editing && !editing.isStage ? editing :
        vm.runtime.targets.find(t => t.isOriginal && !t.isStage);
    const spriteCatalog = sprite ?
        buildCatalog({ScratchBlocks: SB, toolbox: toolboxFor(SB, vm, sprite, makeToolboxXML)}) : null;
    const stageCatalog = buildCatalog({ScratchBlocks: SB, toolbox: toolboxFor(SB, vm, stage, makeToolboxXML)});
    return mergeCatalogs(spriteCatalog, stageCatalog);
};
