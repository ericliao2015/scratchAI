/**
 * Local model in the browser with WebLLM (WebGPU). Free and works offline once the model is
 * downloaded, but small models are not good enough to write programs, so this provider is only
 * used for tutor tasks (explanations and hints).
 */
import {AIError, ErrorKind} from './errors.js';

const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.84/+esm';

// Small instruction models that run on ordinary laptops (sizes are approximate downloads).
export const WEBLLM_MODELS = [
    {id: 'Qwen3.5-2B-q4f16_1-MLC', size: '1.5 GB'},
    {id: 'Qwen3.5-0.8B-q4f16_1-MLC', size: '0.6 GB'},
    {id: 'Qwen3.5-4B-q4f16_1-MLC', size: '2.8 GB'},
    {id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', size: '1.0 GB'},
    {id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', size: '1.8 GB'}
];

const state = {engine: null, model: '', loading: null, listeners: new Set()};

/**
 * Follow model download progress.
 * @param {function(object): void} listener receives {progress (0-1), text}
 * @returns {function(): void} unsubscribe
 */
export const onWebLLMProgress = listener => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
};

export const webgpuAvailable = () => typeof navigator !== 'undefined' && !!navigator.gpu;

const loadEngine = async (model, importer) => {
    if (state.engine && state.model === model) return state.engine;
    if (state.loading && state.loading.model === model) return state.loading.promise;
    if (!webgpuAvailable()) {
        throw new AIError(ErrorKind.UNAVAILABLE, '這個瀏覽器不支援 WebGPU，無法使用本機模型（請用新版 Chrome 或 Edge）。',
            {provider: 'webllm', model});
    }
    const promise = (async () => {
        const webllm = await importer();
        if (state.engine && state.engine.unload) await state.engine.unload();
        const engine = await webllm.CreateMLCEngine(model, {
            initProgressCallback: report => state.listeners.forEach(fn => fn({
                progress: report.progress || 0,
                text: report.text || ''
            }))
        });
        // Loads of different models are serialized by the user; the last one wins.
        // eslint-disable-next-line require-atomic-updates
        state.engine = engine;
        // eslint-disable-next-line require-atomic-updates
        state.model = model;
        return engine;
    })();
    state.loading = {model, promise};
    try {
        return await promise;
    } catch (e) {
        throw e instanceof AIError ? e : new AIError(ErrorKind.NETWORK, `無法載入本機模型：${e.message}`,
            {provider: 'webllm', model});
    } finally {
        // eslint-disable-next-line require-atomic-updates
        state.loading = null;
    }
};

// Qwen 3 models may think aloud first.
export const stripThinking = text => String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();

/**
 * @param {object} [options] {importer: () => Promise<module>} (tests)
 * @returns {object} provider adapter
 */
export const createWebLLMAdapter = ({importer = () => import(/* webpackIgnore: true */ WEBLLM_URL)} = {}) => ({
    id: 'webllm',
    label: '本機模型 WebLLM（免費、可離線，只用於解釋與提示）',
    requiresKey: false,
    keyUrl: '',
    defaultBaseUrl: '',
    needsBaseUrl: false,
    local: true,
    // Requests for other purposes (writing programs, grading) skip this provider.
    purposes: ['tutor'],

    listModels () {
        return Promise.resolve(WEBLLM_MODELS.map(m => m.id));
    },

    async complete ({model, system, messages, maxTokens, signal}) {
        const engine = await loadEngine(model || WEBLLM_MODELS[0].id, importer);
        if (signal && signal.aborted) throw new AIError(ErrorKind.ABORTED, 'Cancelled', {provider: 'webllm', model});
        const reply = await engine.chat.completions.create({
            messages: [
                ...(system ? [{role: 'system', content: system}] : []),
                ...messages.map(m => ({role: m.role, content: m.content}))
            ],
            max_tokens: Math.min(maxTokens || 1500, 1500),
            temperature: 0.4,
            // eslint-disable-next-line camelcase
            extra_body: {enable_thinking: false}
        });
        const choice = reply.choices && reply.choices[0];
        return {
            text: stripThinking(choice && choice.message ? choice.message.content : ''),
            truncated: choice && choice.finish_reason === 'length',
            usage: {
                inputTokens: reply.usage ? reply.usage.prompt_tokens : 0,
                outputTokens: reply.usage ? reply.usage.completion_tokens : 0
            }
        };
    }
});

export default createWebLLMAdapter();
