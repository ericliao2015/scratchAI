/**
 * Student / teacher / exam modes and the class configuration file (docs/SPEC.md §3).
 * Everything runs in the browser, so this keeps honest users honest; it is not security.
 */

const KEY = 'scratchai:mode';

export const MODES = {
    student: '學生模式',
    teacher: '老師模式'
};

export const defaultModeState = () => ({
    mode: 'student',
    pinHash: '',
    classConfig: null
});

export const loadModeState = () => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) || 'null');
        return {...defaultModeState(), ...saved};
    } catch (e) {
        return defaultModeState();
    }
};

export const saveModeState = state => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
        // ignore
    }
};

/**
 * @param {string} pin PIN typed by the teacher
 * @returns {Promise<string>} hex SHA-256 of the PIN
 */
export const hashPin = async pin => {
    const data = new TextEncoder().encode(`scratchai:${pin}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * Class configuration made by a teacher and shared with students.
 * @typedef {object} ClassConfig
 * @property {string} name class name
 * @property {boolean} exam exam mode: AI generation and image generation are disabled
 * @property {string} aiMode which AI help students get: 'both' | 'tutor' | 'generate'
 * @property {object} features {generate, image, selfCheck, missions}
 * @property {Array} missionPacks mission packs for self-study (missions/pack.js)
 * @property {?object} gateway class gateway {url, code}: students only enter their name or number
 * @property {string[]} providers allowed providers (empty = all)
 * @property {object} models allowed models per provider (empty = all)
 * @property {string} level default level 'simple' | 'advanced'
 * @property {number} imageDailyLimit images per student per day (0 = unlimited)
 * @property {Array} templates grading templates students can self-check with
 */

export const AI_MODES = {
    both: '代寫與家教都開放',
    tutor: '只開放家教（AI 只解釋、提示，不寫程式）',
    generate: '只開放代寫'
};

export const defaultClassConfig = () => ({
    version: 1,
    name: '',
    exam: false,
    aiMode: 'both',
    features: {generate: true, image: true, selfCheck: true, missions: true},
    providers: [],
    models: {},
    level: 'simple',
    imageDailyLimit: 0,
    templates: [],
    missionPacks: []
});

/**
 * Validate and normalize a class config loaded from a file or URL.
 * @param {*} json parsed JSON
 * @returns {ClassConfig} config
 */
export const normalizeClassConfig = json => {
    if (!json || typeof json !== 'object') throw new Error('班級設定檔格式不正確');
    const base = defaultClassConfig();
    const config = {
        ...base,
        ...json,
        features: {...base.features, ...(json.features || {})}
    };
    // Never accept keys from a shared file.
    delete config.apiKey;
    delete config.keys;
    if (!Array.isArray(config.templates)) config.templates = [];
    if (!Array.isArray(config.providers)) config.providers = [];
    if (!Array.isArray(config.missionPacks)) config.missionPacks = [];
    config.gateway = config.gateway && typeof config.gateway === 'object' && config.gateway.url ?
        {url: String(config.gateway.url), code: String(config.gateway.code || '').toUpperCase()} : null;
    if (!AI_MODES[config.aiMode]) config.aiMode = 'both';
    return config;
};

/**
 * What the current user may do.
 * @param {object} state mode state
 * @returns {object} permissions
 */
export const permissions = state => {
    const config = state.classConfig;
    const teacher = state.mode === 'teacher';
    if (teacher) {
        const all = {generate: true, tutor: true, image: true, selfCheck: true, missions: true};
        return {teacher, ...all, batch: true, templates: true, exam: false};
    }
    if (!config) {
        const all = {generate: true, tutor: true, image: true, selfCheck: true, missions: true};
        return {teacher, ...all, batch: false, templates: false, exam: false};
    }
    const aiMode = config.aiMode || 'both';
    return {
        teacher,
        exam: !!config.exam,
        generate: !config.exam && config.features.generate !== false && aiMode !== 'tutor',
        tutor: !config.exam && aiMode !== 'generate',
        image: !config.exam && config.features.image !== false,
        selfCheck: config.features.selfCheck !== false,
        missions: config.features.missions !== false,
        batch: false,
        templates: false
    };
};

/**
 * Load a class config from the `?class=` URL parameter, if present.
 * @returns {Promise<?ClassConfig>} config or null
 */
export const loadClassConfigFromUrl = async () => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get('class');
    if (!url) return null;
    const response = await fetch(url, {credentials: 'omit'});
    if (!response.ok) throw new Error(`無法下載班級設定檔（HTTP ${response.status}）`);
    return normalizeClassConfig(await response.json());
};

const IMAGE_COUNT_KEY = 'scratchai:image-count';

/** Count generated images per day, for the class daily limit. */
export const imageQuota = {
    used () {
        try {
            const saved = JSON.parse(window.localStorage.getItem(IMAGE_COUNT_KEY) || '{}');
            return saved.day === new Date().toISOString()
                .slice(0, 10) ? saved.count : 0;
        } catch (e) {
            return 0;
        }
    },
    add () {
        const day = new Date().toISOString()
            .slice(0, 10);
        try {
            window.localStorage.setItem(IMAGE_COUNT_KEY, JSON.stringify({day, count: imageQuota.used() + 1}));
        } catch (e) {
            // ignore
        }
    }
};
