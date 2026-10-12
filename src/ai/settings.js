/**
 * AI settings persistence. API keys stay in sessionStorage unless the user ticks
 * "remember on this device", in which case everything goes to localStorage.
 */

const KEY = 'scratchai:settings';

export const STRATEGIES = {
    'high-first': '高階優先，額度用完自動降級',
    'fixed': '固定模型（不自動切換）',
    'economy': '省錢優先（先用低階，必要時升級）'
};

export const defaultSettings = () => ({
    version: 1,
    active: 'anthropic',
    strategy: 'high-first',
    crossProvider: true,
    remember: false,
    pauseBatchOnFallback: true,
    providers: {
        anthropic: {apiKey: '', model: '', models: []},
        openai: {apiKey: '', model: '', models: []},
        gemini: {apiKey: '', model: '', models: []},
        compatible: {apiKey: '', model: '', models: [], baseUrl: 'http://localhost:11434/v1'}
    },
    image: {
        provider: 'agnes',
        apiKey: '',
        model: 'agnes-image-2.1-flash',
        baseUrl: 'https://apihub.agnes-ai.com/v1'
    }
});

const storages = () => {
    const result = {};
    try {
        result.local = window.localStorage;
    } catch (e) {
        result.local = null;
    }
    try {
        result.session = window.sessionStorage;
    } catch (e) {
        result.session = null;
    }
    return result;
};

const read = storage => {
    if (!storage) return null;
    try {
        const text = storage.getItem(KEY);
        return text ? JSON.parse(text) : null;
    } catch (e) {
        return null;
    }
};

const merge = (base, saved) => {
    if (!saved || typeof saved !== 'object') return base;
    const result = {...base, ...saved};
    result.providers = {...base.providers};
    for (const id of Object.keys(base.providers)) {
        result.providers[id] = {...base.providers[id], ...(saved.providers && saved.providers[id])};
    }
    result.image = {...base.image, ...saved.image};
    return result;
};

export const loadSettings = () => {
    const {local, session} = storages();
    // Session storage wins: it holds the most recent values for this tab.
    return merge(defaultSettings(), read(session) || read(local));
};

const stripKeys = settings => {
    const copy = JSON.parse(JSON.stringify(settings));
    for (const id of Object.keys(copy.providers)) copy.providers[id].apiKey = '';
    copy.image.apiKey = '';
    return copy;
};

export const saveSettings = settings => {
    const {local, session} = storages();
    const text = JSON.stringify(settings);
    try {
        if (session) session.setItem(KEY, text);
        if (local) local.setItem(KEY, JSON.stringify(settings.remember ? settings : stripKeys(settings)));
    } catch (e) {
        // Storage can be full or blocked; settings then only live in memory.
    }
};

/**
 * Remove every saved key from this device.
 * @param {object} settings current settings
 * @returns {object} settings without keys
 */
export const forgetKeys = settings => {
    const cleared = stripKeys(settings);
    cleared.remember = false;
    saveSettings(cleared);
    return cleared;
};
