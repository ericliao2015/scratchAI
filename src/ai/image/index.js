import {createAgnesProvider} from './agnes.js';
import {imageSize, processImage} from './process.js';
import {buildImagePrompt, checkImageRequest} from './prompt.js';
import {AIError, ErrorKind} from '../providers/errors.js';

const POSES = [
    'same character, walking pose with the left leg forward',
    'same character, walking pose with the right leg forward',
    'same character, jumping pose',
    'same character, waving one hand'
];

export const imageProviderFor = settings => {
    const image = settings.image || {};
    if (!image.apiKey) {
        throw new AIError(ErrorKind.AUTH, '尚未設定生圖 KEY，請到「設定」填入 Agnes AI 的 KEY。', {provider: 'agnes'});
    }
    return createAgnesProvider({apiKey: image.apiKey, baseUrl: image.baseUrl, model: image.model});
};

/**
 * Generate costumes from a description.
 * @param {object} options options
 * @param {object} options.settings AI settings
 * @param {string} options.description what to draw
 * @param {string} [options.kind] 'sprite' | 'backdrop'
 * @param {string} [options.style] style id
 * @param {object} [options.processing] post-processing options
 * @param {number} [options.frames] number of animation frames (1 = single costume)
 * @param {?object} [options.client] text AI client used for the safety check
 * @param {function(string): void} [options.onStatus] progress
 * @param {AbortSignal} [options.signal] cancel
 * @returns {Promise<Array<object>>} costumes ready for resolveCostume ({data, dataFormat, ...})
 */
export const generateCostumes = async ({
    settings, description, kind = 'sprite', style = 'cartoon', processing = {}, frames = 1,
    client = null, onStatus = () => {}, signal
}) => {
    onStatus('檢查描述內容…');
    const check = await checkImageRequest(description, client);
    if (!check.ok) throw new AIError(ErrorKind.BAD_REQUEST, check.reason || '這個描述不適合使用。');

    const provider = imageProviderFor(settings);
    const size = imageSize(kind);
    onStatus('AI 繪圖中…（可能需要數十秒）');
    const [original] = await provider.generate({prompt: buildImagePrompt({description, kind, style}), size, signal});
    onStatus('後製處理中…');
    const results = (await processImage(original, {...processing, kind})).map(c => ({...c, source: original}));

    for (let i = 1; i < Math.min(frames, POSES.length + 1); i++) {
        const pose = POSES[i - 1];
        onStatus('產生動畫造型 {0}/{1}…', [i + 1, frames]);
        let bytes;
        try {
            [bytes] = await provider.edit({
                image: new Blob([original], {type: 'image/png'}),
                prompt: buildImagePrompt({description, kind, style, pose}),
                size,
                signal
            });
        } catch (e) {
            if (e.kind === ErrorKind.AUTH || e.kind === ErrorKind.QUOTA || e.kind === ErrorKind.ABORTED) throw e;
            // Image editing is not available: draw the pose from the text description instead.
            const prompt = buildImagePrompt({description, kind, style, pose});
            [bytes] = await provider.generate({prompt, size, signal});
        }
        const processed = await processImage(bytes, {...processing, kind, flip: false});
        results.push(...processed.map(c => ({...c, suffix: `-${i + 1}`, source: bytes})));
    }
    return results;
};

/**
 * Used by applyPlan for IR costumes of the form {generate: {prompt, kind}}.
 * @param {object} settings AI settings
 * @param {?object} client text AI client
 * @returns {function(object, object): Promise<?object>} generator
 */
export const makeIRImageGenerator = (settings, client) => async (spec, {isBackdrop}) => {
    const kind = isBackdrop || spec.kind === 'backdrop' ? 'backdrop' : 'sprite';
    const [costume] = await generateCostumes({
        settings,
        description: String(spec.prompt || spec.description || ''),
        kind,
        style: spec.style || 'cartoon',
        client
    });
    if (!costume) return null;
    const {data, dataFormat, rotationCenterX, rotationCenterY, bitmapResolution} = costume;
    return {data, dataFormat, rotationCenterX, rotationCenterY, bitmapResolution};
};
