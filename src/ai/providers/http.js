import {AIError, ErrorKind, classifyHttpError} from './errors.js';

const DEFAULT_TIMEOUT = 5 * 60 * 1000;

/**
 * fetch() wrapper that turns every failure into an AIError.
 * @param {string} url request URL
 * @param {object} options fetch options plus provider/model/timeout/signal/classify
 * @returns {Promise<object>} parsed JSON body
 */
export const fetchJson = async (url, options = {}) => {
    const {
        provider,
        model,
        timeout = DEFAULT_TIMEOUT,
        signal,
        classify,
        fetchImpl = (typeof fetch === 'undefined' ? null : fetch),
        ...init
    } = options;
    if (!fetchImpl) throw new AIError(ErrorKind.NETWORK, 'fetch is not available', {provider, model});

    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let timedOut = false;
    const timer = controller ? setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeout) : null;
    const onAbort = () => controller && controller.abort();
    if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort);
    }

    let response;
    try {
        response = await fetchImpl(url, {...init, signal: controller ? controller.signal : undefined});
    } catch (e) {
        if (signal && signal.aborted) throw new AIError(ErrorKind.ABORTED, 'Cancelled', {provider, model});
        if (timedOut) throw new AIError(ErrorKind.OVERLOADED, 'Request timed out', {provider, model});
        // Browsers report CORS failures and offline errors the same way.
        throw new AIError(ErrorKind.NETWORK, `Network error: ${e.message}`, {provider, model});
    } finally {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }

    let text = '';
    try {
        text = await response.text();
    } catch (e) {
        text = '';
    }
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch (e) {
        body = null;
    }

    if (!response.ok) {
        const err = (body && (body.error || body[0] && body[0].error)) || {};
        const message = (typeof err === 'string' ? err : err.message) || text.slice(0, 500) ||
            `HTTP ${response.status}`;
        const code = typeof err === 'object' ? `${err.type || ''} ${err.code || ''} ${err.status || ''}` : '';
        const hint = classify ? classify(response.status, err, message) : null;
        throw classifyHttpError(response.status, message, {
            headers: response.headers, code, hint, provider, model
        });
    }
    if (body === null) {
        throw new AIError(ErrorKind.BAD_REQUEST, 'Response was not valid JSON', {provider, model});
    }
    return body;
};
