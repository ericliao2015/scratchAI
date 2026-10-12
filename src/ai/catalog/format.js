/**
 * Formats the block catalog as compact text for prompts.
 */

const VALUE_TYPE_TEXT = {
    number: 'number',
    positive_number: 'number>0',
    whole_number: 'integer>=0',
    integer: 'integer',
    angle: 'angle',
    text: 'text',
    color: 'color "#rrggbb"',
    note: 'note number (60 = middle C)',
    matrix: '25 chars of 0/1',
    broadcast: 'broadcast message name',
    boolean: 'boolean block',
    any: 'block',
    other: 'block'
};

const MAX_OPTIONS = 30;

const optionsText = options => {
    if (!options || options.length === 0) return '';
    const shown = options.slice(0, MAX_OPTIONS).map(o => (o.text && o.text !== o.value ?
        `${JSON.stringify(o.value)}(${o.text})` : JSON.stringify(o.value)));
    return `[${shown.join(', ')}${options.length > MAX_OPTIONS ? ', ...' : ''}]`;
};

const inputText = input => {
    if (input.kind === 'statement') return `${input.name}: substack`;
    if (input.valueType === 'menu' && input.shadow) {
        return `${input.name}: menu ${optionsText(input.shadow.options) || '(project names)'}` +
            `${input.shadow.acceptsText ? ' or text' : ''}`;
    }
    return `${input.name}: ${VALUE_TYPE_TEXT[input.valueType] || input.valueType}`;
};

const fieldText = field => {
    if (field.kind === 'variable') {
        const what = {'': 'variable name', 'list': 'list name', 'broadcast_msg': 'broadcast message name'};
        return `${field.name}: ${what[field.variableType || ''] || 'name'}`;
    }
    if (field.kind === 'dropdown') return `${field.name}: one of ${optionsText(field.options) || '(project names)'}`;
    return `${field.name}: ${field.kind}`;
};

/**
 * @param {object} catalog catalog from buildCatalogFromEditor
 * @returns {string} one line per block, grouped by category
 */
export const formatCatalog = catalog => {
    const lines = [];
    const byCategory = new Map();
    for (const entry of Object.values(catalog.blocks)) {
        if (!byCategory.has(entry.category)) byCategory.set(entry.category, []);
        byCategory.get(entry.category).push(entry);
    }
    const order = (catalog.categories || []).map(c => c.id);
    const categories = Array.from(byCategory.keys()).sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    for (const category of categories) {
        const info = (catalog.categories || []).find(c => c.id === category);
        lines.push(`## ${info ? info.name : category}${info && info.extension ? ' (extension)' : ''}`);
        for (const entry of byCategory.get(category)) {
            const parts = [entry.opcode, entry.shape + (entry.terminal ? ' (ends script)' : ''), entry.label];
            const args = [...entry.fields.map(fieldText), ...entry.inputs.map(inputText)];
            if (args.length) parts.push(args.join('; '));
            if (entry.targets && entry.targets.length === 1) parts.push(`${entry.targets[0]} only`);
            lines.push(parts.join(' | '));
        }
    }
    return lines.join('\n');
};
