/**
 * Agnes AI image API (OpenAI compatible images endpoints).
 * Docs: https://agnes-ai.com/doc/agnes-image-21-flash
 */
import {fetchJson} from '../providers/http.js';
import {AIError, ErrorKind} from '../providers/errors.js';

const trimSlash = url => url.replace(/\/+$/, '');

const base64ToBytes = base64 => {
    const binary = atob(base64.replace(/^data:[^,]+,/, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const downloadImage = async (url, fetchImpl = fetch) => {
    try {
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    } catch (e) {
        throw new AIError(ErrorKind.NETWORK, `圖片已產生，但無法下載（${e.message}）。可能需要代理伺服器。`,
            {provider: 'agnes'});
    }
};

const readImages = async (body, fetchImpl) => {
    const items = Array.isArray(body.data) ? body.data : [];
    if (items.length === 0) throw new AIError(ErrorKind.BAD_REQUEST, '生圖服務沒有回傳圖片', {provider: 'agnes'});
    const images = [];
    for (const item of items) {
        if (item.b64_json) images.push(base64ToBytes(item.b64_json));
        else if (item.url) images.push(await downloadImage(item.url, fetchImpl));
    }
    return images;
};

export const createAgnesProvider = ({apiKey, baseUrl, model, fetchImpl}) => {
    const base = trimSlash(baseUrl || 'https://apihub.agnes-ai.com/v1');
    const headers = {Authorization: `Bearer ${apiKey}`};
    return {
        id: 'agnes',

        /**
         * @param {object} options {prompt, size, signal}
         * @returns {Promise<Uint8Array[]>} image files (PNG/JPEG/WebP bytes)
         */
        async generate ({prompt, size = '1024x1024', signal}) {
            const payload = {model, prompt, size, n: 1, response_format: 'b64_json'};
            let body;
            try {
                body = await fetchJson(`${base}/images/generations`, {
                    method: 'POST',
                    headers: {...headers, 'Content-Type': 'application/json'},
                    body: JSON.stringify(payload),
                    provider: 'agnes',
                    model,
                    signal,
                    fetchImpl
                });
            } catch (e) {
                // Some deployments reject response_format; retry with the default (URL) output.
                if (!(e instanceof AIError) || e.kind !== ErrorKind.BAD_REQUEST || !/response_format/i.test(e.message)) {
                    throw e;
                }
                delete payload.response_format;
                body = await fetchJson(`${base}/images/generations`, {
                    method: 'POST',
                    headers: {...headers, 'Content-Type': 'application/json'},
                    body: JSON.stringify(payload),
                    provider: 'agnes',
                    model,
                    signal,
                    fetchImpl
                });
            }
            return readImages(body, fetchImpl);
        },

        /**
         * Image-to-image: keep a character's look while changing pose or details.
         * @param {object} options {image: Blob, prompt, size, signal}
         * @returns {Promise<Uint8Array[]>} image files
         */
        async edit ({image, prompt, size = '1024x1024', signal}) {
            const form = new FormData();
            form.append('model', model);
            form.append('prompt', prompt);
            form.append('size', size);
            form.append('n', '1');
            form.append('response_format', 'b64_json');
            form.append('image', image, 'reference.png');
            const body = await fetchJson(`${base}/images/edits`, {
                method: 'POST',
                headers,
                body: form,
                provider: 'agnes',
                model,
                signal,
                fetchImpl
            });
            return readImages(body, fetchImpl);
        }
    };
};
