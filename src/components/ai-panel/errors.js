import {ErrorKind} from '../../ai/providers/errors.js';
import {t} from './i18n.js';

const PROVIDER_NAMES = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    gemini: 'Gemini',
    compatible: '相容伺服器',
    agnes: 'Agnes AI'
};

/**
 * Friendly message for any error thrown by the AI features.
 * @param {Error} error error
 * @returns {string} message for the user
 */
export const describeError = error => {
    if (!error) return t('發生未知錯誤');
    const where = error.provider ? t('{0}{1}：', [t(PROVIDER_NAMES[error.provider] || error.provider), error.model ? t('（{0}）', [error.model]) : '']) : '';
    switch (error.kind) {
    case ErrorKind.AUTH:
        return error.provider ? t('{0}KEY 無效或沒有權限，請到「設定」檢查 KEY。', [where]) : error.message;
    case ErrorKind.QUOTA:
        return t('{0}額度已用完，且沒有其他可用的模型。可到「設定」加入其他平台的 KEY。', [where]);
    case ErrorKind.RATE_LIMIT:
        return t('{0}請求太頻繁，請稍等一下再試。', [where]);
    case ErrorKind.OVERLOADED:
        return t('{0}服務暫時忙碌或逾時，請稍後再試。', [where]);
    case ErrorKind.UNAVAILABLE:
        return t('{0}找不到這個模型，請到「設定」重新選擇模型。', [where]);
    case ErrorKind.NETWORK:
        return t('{0}無法連線。可能是網路中斷，或這個服務不允許從瀏覽器直接呼叫（CORS）。', [where]);
    case ErrorKind.ABORTED:
        return error.message === 'Cancelled' ? t('已取消') : error.message;
    case ErrorKind.BAD_REQUEST:
        return t('{0}請求被拒絕：{1}', [where, error.message]);
    default:
        return error.message || String(error);
    }
};
