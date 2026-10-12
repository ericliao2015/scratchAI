import anthropic from './anthropic.js';
import gemini from './gemini.js';
import {createOpenAIAdapter} from './openai.js';

const openai = createOpenAIAdapter({
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys'
});

// Any server that speaks the Chat Completions API: Ollama (http://localhost:11434/v1),
// LM Studio, OpenRouter, Groq, ...
const compatible = createOpenAIAdapter({
    id: 'compatible',
    label: 'OpenAI 相容（Ollama 等）',
    defaultBaseUrl: '',
    requiresKey: false
});

export const PROVIDERS = {anthropic, openai, gemini, compatible};

export const PROVIDER_ORDER = ['anthropic', 'openai', 'gemini', 'compatible'];

export const getProvider = id => {
    const provider = PROVIDERS[id];
    if (!provider) throw new Error(`Unknown provider: ${id}`);
    return provider;
};
