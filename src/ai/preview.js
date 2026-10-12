/**
 * Turns compiled plan blocks into scratch-blocks XML so they can be shown in a
 * read-only workspace before they are applied.
 */

const xmlEscape = text => String(text).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;'
}[c]));

/**
 * @param {object} vm VM (only used for its Blocks class and runtime)
 * @param {Array<object>} blocks VM blocks of one target (plan.scripts[i].blocks)
 * @returns {string} workspace XML
 */
export const blocksToWorkspaceXml = (vm, blocks) => {
    const BlocksClass = vm.runtime.getTargetForStage().blocks.constructor;
    const container = new BlocksClass(vm.runtime, true);
    const variables = new Map();
    for (const block of blocks) {
        container.createBlock(JSON.parse(JSON.stringify(block)));
        for (const field of Object.values(block.fields || {})) {
            if (field.id && typeof field.variableType === 'string') {
                variables.set(field.id, {name: field.value, type: field.variableType});
            }
        }
    }
    const variableXml = Array.from(variables.entries())
        .map(([id, v]) => `<variable type="${xmlEscape(v.type)}" id="${xmlEscape(id)}">${xmlEscape(v.name)}</variable>`)
        .join('');
    return `<xml xmlns="http://www.w3.org/1999/xhtml"><variables>${variableXml}</variables>${container.toXML()}</xml>`;
};
