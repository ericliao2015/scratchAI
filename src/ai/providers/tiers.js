import TIERS from './model-tiers.json';
import {PROVIDERS, PROVIDER_ORDER} from './index.js';

export const TIER_ORDER = ['high', 'mid', 'low'];

export const TIER_LABELS = {
    high: '高階',
    mid: '中階',
    low: '低階'
};

/**
 * @param {string} providerId provider
 * @param {string} model model id
 * @returns {?string} 'high' | 'mid' | 'low', or null when the model is not ranked
 */
export const getTier = (providerId, model) => {
    const tiers = TIERS[providerId];
    if (!tiers || !model) return null;
    for (const tier of TIER_ORDER) {
        if ((tiers[tier] || []).includes(model)) return tier;
    }
    return null;
};

/**
 * Models of one tier, limited to what the provider says is available (when known).
 * @param {string} providerId provider
 * @param {string} tier tier name
 * @param {?Array<string>} available model ids from listModels(), or null if unknown
 * @returns {Array<string>} model ids
 */
export const tierModels = (providerId, tier, available) => {
    const models = (TIERS[providerId] && TIERS[providerId][tier]) || [];
    if (!available || available.length === 0) return models.slice();
    return models.filter(m => available.includes(m));
};

/**
 * Group a provider's models by tier for the model picker.
 * @param {string} providerId provider
 * @param {?Array<string>} available model ids from listModels()
 * @returns {Array<object>} groups {tier, models}, ranked tiers first
 */
export const groupModels = (providerId, available) => {
    const groups = TIER_ORDER.map(tier => ({tier, models: tierModels(providerId, tier, available)}));
    if (available && available.length) {
        const ranked = new Set(groups.flatMap(g => g.models));
        groups.push({tier: null, models: available.filter(m => !ranked.has(m))});
    }
    return groups.filter(g => g.models.length > 0);
};

/**
 * Default model for a provider: the first available model of the highest tier.
 * @param {string} providerId provider
 * @param {?Array<string>} available model ids from listModels()
 * @returns {string} model id
 */
export const defaultModel = (providerId, available) => {
    for (const tier of TIER_ORDER) {
        const models = tierModels(providerId, tier, available);
        if (models.length) return models[0];
    }
    return available && available.length ? available[0] : '';
};

export const isConfigured = (providerId, config) => {
    const provider = PROVIDERS[providerId];
    if (!provider || !config || !config.model) return false;
    if (provider.needsBaseUrl && !config.baseUrl) return false;
    // Local models download a lot of data, so they are only used after the user turns them on.
    if (provider.local && !config.enabled) return false;
    return !provider.requiresKey || !!config.apiKey;
};

const chainForProvider = (providerId, config, {strategy}) => {
    const selected = config.model;
    const available = config.models && config.models.length ? config.models : null;
    if (strategy === 'fixed') return [selected];

    const selectedTier = getTier(providerId, selected);
    if (strategy === 'economy') {
        // Start cheap and move up only when needed.
        const chain = [];
        for (const tier of TIER_ORDER.slice().reverse()) {
            const models = tierModels(providerId, tier, available);
            if (models.length) chain.push(models[0]);
            if (tier === (selectedTier || 'high')) break;
        }
        if (!chain.includes(selected)) chain.push(selected);
        return chain;
    }

    // high-first: the selected model, then the best model of each lower tier.
    const chain = [selected];
    const startIndex = selectedTier ? TIER_ORDER.indexOf(selectedTier) + 1 : 1;
    for (const tier of TIER_ORDER.slice(startIndex)) {
        const models = tierModels(providerId, tier, available).filter(m => !chain.includes(m));
        if (models.length) chain.push(models[0]);
    }
    return chain;
};

/**
 * Build the ordered list of {provider, model} pairs to try.
 * @param {object} settings AI settings (see settings.js)
 * @param {object} [options] {purpose: e.g. 'tutor'; providers limited to other purposes are skipped}
 * @returns {Array<{provider: string, model: string}>} chain, primary model first
 */
export const buildChain = (settings, {purpose = ''} = {}) => {
    const strategy = settings.strategy || 'high-first';
    const order = [settings.active, ...PROVIDER_ORDER.filter(id => id !== settings.active)];
    const chain = [];
    for (const providerId of order) {
        const config = settings.providers && settings.providers[providerId];
        if (!isConfigured(providerId, config)) continue;
        const purposes = PROVIDERS[providerId].purposes;
        if (purposes && !purposes.includes(purpose)) continue;
        if (providerId !== settings.active && (strategy === 'fixed' || settings.crossProvider === false)) continue;
        for (const model of chainForProvider(providerId, config, {strategy})) {
            chain.push({provider: providerId, model});
        }
    }
    return chain;
};
