/**
 * The BlockAI class gateway (server/): the teacher's server holds the AI keys; students
 * only enter the gateway address, the class code and their name or seat number.
 */
import {fetchJson} from './http.js';
import {ErrorKind} from './errors.js';

const trimSlash = url => String(url || '').replace(/\/+$/, '');

const classify = (status, err) => {
    const code = err && typeof err === 'object' ? err.code : '';
    if (code === 'insufficient_quota') return ErrorKind.QUOTA;
    if (code === 'invalid_api_key') return ErrorKind.AUTH;
    if (code === 'model_not_found') return ErrorKind.UNAVAILABLE;
    if (code === 'upstream_error') return ErrorKind.OVERLOADED;
    return null;
};

/**
 * Token sent to the gateway.
 * @param {string} classCode class code from the teacher
 * @param {string} student name or seat number
 * @returns {string} token
 */
export const gatewayToken = (classCode, student) =>
    `${String(classCode || '').trim()
        .toUpperCase()}.${encodeURIComponent(String(student || '').trim())}`;

/**
 * Call a gateway endpoint (also used for submissions and cloud projects).
 * @param {object} options {baseUrl, token, path, method, body, signal, fetchImpl, timeout}
 * @returns {Promise<object>} JSON response
 */
export const gatewayRequest = ({baseUrl, token, path, method = 'GET', body, signal, fetchImpl, timeout = 60000}) =>
    fetchJson(`${trimSlash(baseUrl)}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? {Authorization: `Bearer ${token}`} : {})
        },
        ...(typeof body === 'undefined' ? {} : {body: JSON.stringify(body)}),
        provider: 'gateway',
        signal,
        fetchImpl,
        classify,
        timeout
    });

export default {
    id: 'gateway',
    label: '班級閘道（老師提供網址與班級代碼）',
    requiresKey: true,
    keyUrl: '',
    defaultBaseUrl: '',
    needsBaseUrl: true,
    gateway: true,

    async listModels ({apiKey, baseUrl, signal, fetchImpl}) {
        const body = await gatewayRequest({baseUrl, token: apiKey, path: '/v1/models', signal, fetchImpl, timeout: 30000});
        return (body.data || []).map(m => m.id).filter(Boolean);
    },

    async complete ({apiKey, baseUrl, model, system, messages, json, maxTokens, signal, fetchImpl}) {
        const body = await gatewayRequest({
            baseUrl,
            token: apiKey,
            path: '/v1/complete',
            method: 'POST',
            body: {model, system, messages, json, maxTokens},
            signal,
            fetchImpl,
            timeout: 5 * 60 * 1000
        });
        return {text: body.text || '', truncated: !!body.truncated, usage: body.usage || {}, servedBy: body.model};
    }
};
