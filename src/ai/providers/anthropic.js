import {fetchJson} from './http.js';
import {ErrorKind} from './errors.js';

const BASE_URL = 'https://api.anthropic.com/v1';

const classify = (status, err, message) => {
    const type = err && typeof err === 'object' ? err.type : '';
    if (type === 'billing_error') return ErrorKind.QUOTA;
    if (type === 'rate_limit_error') return ErrorKind.RATE_LIMIT;
    if (type === 'overloaded_error') return ErrorKind.OVERLOADED;
    if (type === 'authentication_error' || type === 'permission_error') return ErrorKind.AUTH;
    if (type === 'not_found_error') return ErrorKind.UNAVAILABLE;
    if (type === 'invalid_request_error' && /credit balance/i.test(message)) return ErrorKind.QUOTA;
    return null;
};

const headers = apiKey => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Required for calling the API straight from a browser page.
    'anthropic-dangerous-direct-browser-access': 'true'
});

export default {
    id: 'anthropic',
    label: 'Anthropic Claude',
    requiresKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultBaseUrl: BASE_URL,
    needsBaseUrl: false,

    async listModels ({apiKey, signal, fetchImpl}) {
        const body = await fetchJson(`${BASE_URL}/models?limit=100`, {
            method: 'GET', headers: headers(apiKey), provider: 'anthropic', signal, fetchImpl, classify, timeout: 30000
        });
        return (body.data || []).map(m => m.id).filter(Boolean);
    },

    async complete ({apiKey, model, system, messages, maxTokens, signal, fetchImpl}) {
        // Current Claude models reject sampling parameters and assistant prefill,
        // so JSON output is requested through the system prompt and parsed by the caller.
        const payload = {
            model,
            max_tokens: maxTokens || 16000,
            messages: messages.map(m => ({role: m.role, content: m.content}))
        };
        if (system) payload.system = system;
        const body = await fetchJson(`${BASE_URL}/messages`, {
            method: 'POST',
            headers: headers(apiKey),
            body: JSON.stringify(payload),
            provider: 'anthropic',
            model,
            signal,
            fetchImpl,
            classify
        });
        const text = (body.content || [])
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('');
        return {
            text,
            truncated: body.stop_reason === 'max_tokens',
            refused: body.stop_reason === 'refusal',
            usage: {
                inputTokens: body.usage ? body.usage.input_tokens : 0,
                outputTokens: body.usage ? body.usage.output_tokens : 0
            }
        };
    }
};
