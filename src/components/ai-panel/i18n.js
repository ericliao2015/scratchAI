/**
 * Tiny translation helper for the AI panel. Strings are written in Traditional Chinese
 * in the code and looked up in a dictionary for other languages:
 *   t('已載入 {0} 個模型', [count])
 */
import en from './messages-en.js';

let language = 'zh';

/**
 * @param {string} locale GUI locale such as 'zh-tw', 'en', 'ja'
 */
export const setLocale = locale => {
    const value = String(locale || '').toLowerCase();
    language = value.startsWith('zh') ? 'zh' : 'en';
};

export const getLanguage = () => language;

/**
 * @param {string} text Chinese source text, with {0}, {1} placeholders
 * @param {Array} [args] values for the placeholders
 * @returns {string} translated text
 */
export const t = (text, args) => {
    const template = language === 'zh' ? text : (en[text] || text);
    if (!args) return template;
    return template.replace(/\{(\d+)\}/g, (match, index) => {
        const value = args[Number(index)];
        return typeof value === 'undefined' || value === null ? '' : String(value);
    });
};
