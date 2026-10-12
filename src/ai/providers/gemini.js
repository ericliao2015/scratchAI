import {fetchJson} from './http.js';
import {ErrorKind} from './errors.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const classify = (status, err, message) => {
    const reason = err && typeof err === 'object' ? err.status : '';
    if (reason === 'RESOURCE_EXHAUSTED') {
        // Gemini uses the same status for per-minute limits and daily quotas.
        return /per ?day|daily|free_tier_requests|billing/i.test(message) ? ErrorKind.QUOTA : ErrorKind.RATE_LIMIT;
    }
    if (reason === 'PERMISSION_DENIED' || reason === 'UNAUTHENTICATED') return ErrorKind.AUTH;
    if (status === 400 && /API key not valid/i.test(message)) return ErrorKind.AUTH;
    if (reason === 'NOT_FOUND') return ErrorKind.UNAVAILABLE;
    return null;
};

const headers = apiKey => ({
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey
});

export default {
    id: 'gemini',
    label: 'Google Gemini',
    requiresKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultBaseUrl: BASE_URL,
    needsBaseUrl: false,

    async listModels ({apiKey, signal, fetchImpl}) {
        const body = await fetchJson(`${BASE_URL}/models?pageSize=200`, {
            method: 'GET', headers: headers(apiKey), provider: 'gemini', signal, fetchImpl, classify, timeout: 30000
        });
        return (body.models || [])
            .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace(/^models\//, ''));
    },

    async complete ({apiKey, model, system, messages, json, maxTokens, signal, fetchImpl}) {
        const payload = {
            contents: messages.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{text: m.content}]
            })),
            generationConfig: {}
        };
        if (system) payload.systemInstruction = {parts: [{text: system}]};
        if (json) payload.generationConfig.responseMimeType = 'application/json';
        if (maxTokens) payload.generationConfig.maxOutputTokens = maxTokens;
        const body = await fetchJson(`${BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: headers(apiKey),
            body: JSON.stringify(payload),
            provider: 'gemini',
            model,
            signal,
            fetchImpl,
            classify
        });
        const candidate = body.candidates && body.candidates[0];
        const parts = (candidate && candidate.content && candidate.content.parts) || [];
        return {
            text: parts.filter(p => !p.thought).map(p => p.text || '')
                .join(''),
            truncated: candidate && candidate.finishReason === 'MAX_TOKENS',
            refused: candidate && (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT'),
            usage: {
                inputTokens: body.usageMetadata ? body.usageMetadata.promptTokenCount : 0,
                outputTokens: body.usageMetadata ? body.usageMetadata.candidatesTokenCount : 0
            }
        };
    }
};
