/**
 * Key-value stores for the gateway. Values are JSON-serializable.
 * Interface: get(key) -> value | null, put(key, value), delete(key), list(prefix) -> keys.
 */

/**
 * In-memory store (tests, quick trials; data is lost on restart).
 * @returns {object} store
 */
export const memoryStore = () => {
    const map = new Map();
    return {
        get: key => Promise.resolve(map.has(key) ? JSON.parse(map.get(key)) : null),
        put: (key, value) => {
            map.set(key, JSON.stringify(value));
            return Promise.resolve();
        },
        delete: key => {
            map.delete(key);
            return Promise.resolve();
        },
        list: prefix => Promise.resolve([...map.keys()].filter(key => key.startsWith(prefix))
            .sort())
    };
};

/**
 * Cloudflare Workers KV namespace.
 * @param {object} kv KV binding
 * @returns {object} store
 */
export const kvStore = kv => ({
    get: key => kv.get(key, 'json'),
    put: (key, value) => kv.put(key, JSON.stringify(value)),
    delete: key => kv.delete(key),
    list: async prefix => {
        const keys = [];
        let cursor;
        do {
            const page = await kv.list({prefix, cursor});
            keys.push(...page.keys.map(k => k.name));
            cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
        return keys.sort();
    }
});
