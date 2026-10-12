import {fetchJson} from './http.js';
import {ErrorKind} from './errors.js';

const trimSlash = url => url.replace(/\/+$/, '');

const classify = (status, err) => {
    const code = err && typeof err === 'object' ? err.code || err.type : '';
    if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return ErrorKind.QUOTA;
    if (code === 'model_not_found') return ErrorKind.UNAVAILABLE;
    if (code === 'rate_limit_exceeded') return ErrorKind.RATE_LIMIT;
    if (code === 'invalid_api_key') return ErrorKind.AUTH;
    return null;
};

/**
 * Chat Completions API. Used for OpenAI and for any OpenAI compatible server
 * (Ollama, LM Studio, OpenRouter, Groq, ...).
 * @param {object} config adapter config
 * @returns {object} provider adapter
 */
export const createOpenAIAdapter = ({id, label, defaultBaseUrl, requiresKey = true, keyUrl = ''}) => ({
    id,
    label,
    requiresKey,
    keyUrl,
    defaultBaseUrl,
    needsBaseUrl: !defaultBaseUrl,

    headers ({apiKey}) {
        const headers = {'Content-Type': 'application/json'};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        return headers;
    },

    async listModels ({apiKey, baseUrl, signal, fetchImpl}) {
        const base = trimSlash(baseUrl || defaultBaseUrl);
        const body = await fetchJson(`${base}/models`, {
            method: 'GET', headers: this.headers({apiKey}), provider: id, signal, fetchImpl, classify, timeout: 30000
        });
        const list = Array.isArray(body.data) ? body.data : (Array.isArray(body.models) ? body.models : []);
        return list
            .map(m => (typeof m === 'string' ? m : m.id || m.name))
            .filter(Boolean)
            .sort();
    },

    async complete ({apiKey, baseUrl, model, system, messages, json, maxTokens, signal, fetchImpl}) {
        const base = trimSlash(baseUrl || defaultBaseUrl);
        const payload = {
            model,
            messages: [
                ...(system ? [{role: 'system', content: system}] : []),
                ...messages.map(m => ({role: m.role, content: m.content}))
            ]
        };
        if (json) payload.response_format = {type: 'json_object'};
        if (maxTokens) payload.max_completion_tokens = maxTokens;
        const body = await fetchJson(`${base}/chat/completions`, {
            method: 'POST',
            headers: this.headers({apiKey}),
            body: JSON.stringify(payload),
            provider: id,
            model,
            signal,
            fetchImpl,
            classify
        });
        const choice = body.choices && body.choices[0];
        const text = choice && choice.message ? (choice.message.content || '') : '';
        return {
            text,
            truncated: choice && choice.finish_reason === 'length',
            usage: {
                inputTokens: body.usage ? body.usage.prompt_tokens : 0,
                outputTokens: body.usage ? body.usage.completion_tokens : 0
            }
        };
    }
});
