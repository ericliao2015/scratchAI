/**
 * Builds image prompts and checks that requests are appropriate for students.
 */
import {extractJson} from '../json.js';

export const STYLES = {
    cartoon: {label: '卡通', text: 'cute cartoon style, bold clean outlines, flat bright colors'},
    flat: {label: '扁平', text: 'flat vector illustration style, simple shapes, no gradients'},
    pixel: {label: '像素', text: 'pixel art style, 32x32 sprite look, crisp pixels'},
    hand: {label: '手繪', text: 'hand-drawn crayon style, playful'},
    realistic: {label: '寫實', text: 'semi-realistic illustration, soft shading'}
};

/**
 * @param {object} options {description, kind, style, pose}
 * @returns {string} prompt for the image model
 */
export const buildImagePrompt = ({description, kind = 'sprite', style = 'cartoon', pose = ''}) => {
    const styleText = (STYLES[style] || STYLES.cartoon).text;
    if (kind === 'backdrop') {
        return `${description}. A game background scene for a children's coding project, wide 4:3 landscape, ` +
            `${styleText}, no text, no characters in the foreground.`;
    }
    return `${description}${pose ? `, ${pose}` : ''}. A single game character sprite, full body, centered, ` +
        `${styleText}, isolated on a plain solid pure white background, no shadow, no text, no frame, ` +
        'nothing else in the picture.';
};

const BLOCKLIST = [
    /血腥|暴力|殺人|屠殺|自殺|色情|裸體|裸露|性感|毒品|吸毒|槍殺|恐怖攻擊/,
    /\b(gore|nude|naked|nsfw|porn|sexy|suicide|kill(ing)? people|drugs?)\b/i
];

/**
 * Check a request before generating an image.
 * @param {string} text user description
 * @param {?object} client AI text client (optional, for a smarter check)
 * @returns {Promise<{ok: boolean, reason: string}>} result
 */
export const checkImageRequest = async (text, client) => {
    if (BLOCKLIST.some(pattern => pattern.test(text))) {
        return {ok: false, reason: '這個描述不適合在課堂使用，請換一個主題。'};
    }
    if (!client) return {ok: true, reason: ''};
    try {
        const result = await client.complete({
            system: 'You review picture requests from school students (age 8+) for a coding class. ' +
                'Reply with JSON only: {"ok": true|false, "reason": "short reason in Traditional Chinese"}. ' +
                'Refuse violence, gore, sexual content, hate, drugs, self-harm, real people and copyrighted ' +
                'characters by name. Allow normal game art like monsters, robots, swords and spaceships.',
            messages: [{role: 'user', content: text}],
            json: true,
            maxTokens: 2000
        });
        const verdict = extractJson(result.text);
        return {ok: verdict.ok !== false, reason: String(verdict.reason || '')};
    } catch (e) {
        // If the check itself fails, fall back to the keyword list result.
        return {ok: true, reason: ''};
    }
};
