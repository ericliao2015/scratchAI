/**
 * Error kinds used by the fallback runner to decide what to do next.
 * - rate_limit: temporary throttling. Retry with backoff, do not downgrade.
 * - quota: credits or quota used up. Downgrade to a lower tier model.
 * - unavailable: the model does not exist or is not available to this key. Downgrade.
 * - overloaded: provider is temporarily overloaded (5xx). Retry, then downgrade.
 * - auth: invalid key or no permission. Stop and ask the user to check the key.
 * - bad_request: request was rejected. Stop.
 * - network: could not reach the provider (offline, CORS). Stop.
 * - aborted: cancelled by the user.
 */
export const ErrorKind = Object.freeze({
    RATE_LIMIT: 'rate_limit',
    QUOTA: 'quota',
    UNAVAILABLE: 'unavailable',
    OVERLOADED: 'overloaded',
    AUTH: 'auth',
    BAD_REQUEST: 'bad_request',
    NETWORK: 'network',
    ABORTED: 'aborted'
});

export class AIError extends Error {
    constructor (kind, message, {status = null, retryAfter = null, provider = null, model = null} = {}) {
        super(message);
        this.name = 'AIError';
        this.kind = kind;
        this.status = status;
        this.retryAfter = retryAfter;
        this.provider = provider;
        this.model = model;
    }
}

/** Errors after which trying a lower tier model makes sense. */
export const isDowngradable = error => error instanceof AIError && (
    error.kind === ErrorKind.QUOTA ||
    error.kind === ErrorKind.UNAVAILABLE ||
    error.kind === ErrorKind.RATE_LIMIT ||
    error.kind === ErrorKind.OVERLOADED
);

/** Errors worth retrying on the same model before moving on. */
export const isRetryable = error => error instanceof AIError && (
    error.kind === ErrorKind.RATE_LIMIT ||
    error.kind === ErrorKind.OVERLOADED
);

const parseRetryAfter = headers => {
    const value = headers && headers.get && headers.get('retry-after');
    if (!value) return null;
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds : null;
};

const QUOTA_PATTERN = /quota|credit|billing|balance|insufficient|exceeded your|per[ _-]?day|daily/i;

/**
 * Classify an HTTP error response in a provider independent way.
 * Providers can pre-classify by passing `hint`.
 * @param {number} status HTTP status
 * @param {string} message error message from the body
 * @param {object} options extra info
 * @returns {AIError} classified error
 */
export const classifyHttpError = (status, message, {headers, code = '', hint = null, provider, model} = {}) => {
    const info = {status, retryAfter: parseRetryAfter(headers), provider, model};
    if (hint) return new AIError(hint, message, info);
    const text = `${code} ${message}`;
    if (status === 401) return new AIError(ErrorKind.AUTH, message, info);
    if (status === 403) {
        return new AIError(QUOTA_PATTERN.test(text) ? ErrorKind.QUOTA : ErrorKind.AUTH, message, info);
    }
    if (status === 402) return new AIError(ErrorKind.QUOTA, message, info);
    if (status === 404) return new AIError(ErrorKind.UNAVAILABLE, message, info);
    if (status === 429) {
        return new AIError(QUOTA_PATTERN.test(text) && !/per[ _-]?minute|rpm|tpm/i.test(text) ?
            ErrorKind.QUOTA : ErrorKind.RATE_LIMIT, message, info);
    }
    if (status === 400 && QUOTA_PATTERN.test(text)) return new AIError(ErrorKind.QUOTA, message, info);
    if (status === 400 && /model/i.test(text) && /not (found|exist|support|available)|invalid model|unknown model/i.test(text)) {
        return new AIError(ErrorKind.UNAVAILABLE, message, info);
    }
    if (status >= 500) return new AIError(ErrorKind.OVERLOADED, message, info);
    return new AIError(ErrorKind.BAD_REQUEST, message, info);
};
