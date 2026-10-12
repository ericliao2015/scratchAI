import {PROVIDERS} from './index.js';
import {buildChain} from './tiers.js';
import {AIError, ErrorKind, isDowngradable, isRetryable} from './errors.js';

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const today = () => new Date().toISOString()
    .slice(0, 10);

/**
 * Creates a client that sends requests along the fallback chain.
 *
 * The position in the chain is sticky for the current day: once a model ran out of
 * quota, later requests start at the model that worked. Reloading the page or a new
 * day starts from the top again.
 *
 * @param {object} options options
 * @param {function(): object} options.getSettings returns current AI settings
 * @param {function(object): void} [options.onEvent] receives {type: 'fallback'|'retry'|'usage', ...}
 * @returns {object} client
 */
export const createAIClient = ({
    getSettings,
    onEvent = () => {},
    providers = PROVIDERS,
    sleep = defaultSleep,
    fetchImpl,
    maxRetries = 2
}) => {
    // One position per chain (requests for different purposes can use different chains).
    const state = {day: today(), positions: {}};

    const currentChain = (purpose = '') => {
        const chain = buildChain(getSettings(), {purpose});
        const key = chain.map(e => `${e.provider}:${e.model}`).join('|');
        if (state.day !== today()) {
            state.day = today();
            state.positions = {};
        }
        if (!(key in state.positions)) state.positions[key] = 0;
        return {chain, key};
    };

    const client = {
        get chain () {
            return currentChain().chain;
        },

        get current () {
            const {chain, key} = currentChain();
            return chain[Math.min(state.positions[key], chain.length - 1)] || null;
        },

        reset () {
            state.positions = {};
        },

        /**
         * Move one step along the chain without an error (used by the economy strategy
         * when a cheap model's answer failed validation).
         * @returns {boolean} true if there was a next model
         */
        escalate () {
            const {chain, key} = currentChain();
            const position = state.positions[key];
            if (position + 1 >= chain.length) return false;
            state.positions[key] = position + 1;
            onEvent({type: 'fallback', from: chain[position], to: chain[position + 1], reason: 'escalate'});
            return true;
        },

        /**
         * @param {object} request {system, messages, json, maxTokens, purpose}
         * @param {object} [options] {signal, onBeforeFallback}
         * @returns {Promise<object>} {text, usage, provider, model, downgraded}
         */
        async complete (request, {signal, onBeforeFallback} = {}) {
            const {purpose, ...payload} = request;
            const {chain, key} = currentChain(purpose);
            if (chain.length === 0) {
                if (purpose !== 'tutor' && buildChain(getSettings(), {purpose: 'tutor'}).length) {
                    throw new AIError(ErrorKind.AUTH, '本機模型只能用來解釋與提示；寫程式和批改需要設定雲端 AI 模型。');
                }
                throw new AIError(ErrorKind.AUTH, '尚未設定 AI 模型與 KEY，請先到「設定」完成設定。');
            }
            const settings = getSettings();
            let lastError = null;
            for (let i = Math.min(state.positions[key], chain.length - 1); i < chain.length; i++) {
                const entry = chain[i];
                const config = settings.providers[entry.provider];
                const adapter = providers[entry.provider];
                for (let attempt = 0; ; attempt++) {
                    try {
                        const result = await adapter.complete({
                            ...payload,
                            apiKey: config.apiKey,
                            baseUrl: config.baseUrl,
                            model: entry.model,
                            signal,
                            fetchImpl
                        });
                        onEvent({type: 'usage', provider: entry.provider, model: entry.model, usage: result.usage});
                        return {
                            ...result,
                            provider: entry.provider,
                            model: entry.model,
                            downgraded: i > 0
                        };
                    } catch (e) {
                        const error = e instanceof AIError ? e : new AIError(ErrorKind.BAD_REQUEST, e.message);
                        error.provider = entry.provider;
                        error.model = entry.model;
                        lastError = error;
                        if (error.kind === ErrorKind.ABORTED) throw error;
                        if (isRetryable(error) && attempt < maxRetries) {
                            const wait = error.retryAfter ? error.retryAfter * 1000 : 1000 * (2 ** attempt);
                            onEvent({type: 'retry', ...entry, attempt: attempt + 1, wait, error});
                            await sleep(Math.min(wait, 30000));
                            continue;
                        }
                        break;
                    }
                }

                // Lower tiers help with quota and availability problems. Other problems
                // (bad key, network) only go away by switching to a different provider.
                let nextIndex = -1;
                if (isDowngradable(lastError)) {
                    nextIndex = i + 1;
                } else if (lastError.kind !== ErrorKind.BAD_REQUEST) {
                    nextIndex = chain.findIndex((e, index) => index > i && e.provider !== entry.provider);
                }
                const next = chain[nextIndex];
                if (!next) throw lastError;
                if (onBeforeFallback && await onBeforeFallback({from: entry, to: next, error: lastError}) === false) {
                    throw new AIError(ErrorKind.ABORTED, '已暫停：模型需要降級，等待確認。', {
                        provider: entry.provider, model: entry.model
                    });
                }
                if (lastError.kind !== ErrorKind.RATE_LIMIT && lastError.kind !== ErrorKind.OVERLOADED) {
                    // Concurrent requests may both move the position; either value is a valid model.
                    // eslint-disable-next-line require-atomic-updates
                    state.positions[key] = nextIndex;
                }
                onEvent({type: 'fallback', from: entry, to: next, reason: lastError.kind, error: lastError});
                // eslint-disable-next-line require-atomic-updates
                i = nextIndex - 1;
            }
            throw lastError;
        }
    };
    return client;
};
