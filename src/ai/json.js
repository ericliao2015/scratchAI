/**
 * Extract a JSON value from model output. Models sometimes wrap JSON in markdown
 * fences or add a sentence before it, so this looks for the outermost object.
 * @param {string} text model output
 * @returns {*} parsed value
 * @throws {SyntaxError} when no JSON can be found
 */
export const extractJson = text => {
    if (typeof text !== 'string') throw new SyntaxError('Model returned no text');
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    } catch (e) {
        // fall through
    }
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
        try {
            return JSON.parse(fence[1].trim());
        } catch (e) {
            // fall through
        }
    }
    const start = trimmed.search(/[{[]/);
    if (start !== -1) {
        const open = trimmed[start];
        const close = open === '{' ? '}' : ']';
        const end = trimmed.lastIndexOf(close);
        if (end > start) {
            return JSON.parse(trimmed.slice(start, end + 1));
        }
    }
    throw new SyntaxError('Could not find JSON in the model output');
};
