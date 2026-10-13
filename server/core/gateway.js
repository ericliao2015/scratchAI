/**
 * BlockAI class gateway (v2): one small HTTP API that holds the AI keys for a class,
 * gives students a class code instead of a key, enforces daily quotas, keeps usage
 * statistics, and stores submissions and projects.
 *
 * It is written against the standard Fetch API (Request -> Response) so the same code
 * runs on Node (server/node.js) and on Cloudflare Workers (server/worker.js). Storage is
 * an injected key-value store (server/core/stores.js).
 *
 * Student requests:  Authorization: Bearer <CLASSCODE>.<student>  (student is URL-encoded)
 * Teacher requests:  Authorization: Bearer <ADMIN_TOKEN>
 */
import anthropic from '../../src/ai/providers/anthropic.js';
import gemini from '../../src/ai/providers/gemini.js';
import {createOpenAIAdapter} from '../../src/ai/providers/openai.js';
import {AIError, ErrorKind, isDowngradable} from '../../src/ai/providers/errors.js';
import {elevenLabsMusic, elevenLabsSfx, lyriaMusic} from '../../src/ai/audio/services.js';
import {toBase64} from '../../src/ai/backend/base64.js';

export const VERSION = 2;

const DEFAULT_PROVIDERS = {
    anthropic,
    gemini,
    openai: createOpenAIAdapter({id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1'}),
    compatible: createOpenAIAdapter({id: 'compatible', label: 'compatible', defaultBaseUrl: '', requiresKey: false})
};

const KEY_ENV = {anthropic: 'ANTHROPIC_KEY', openai: 'OPENAI_KEY', gemini: 'GEMINI_KEY', compatible: 'COMPATIBLE_KEY'};
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_STUDENT = 40;

const projectKey = (code, student, name) => `${code}:${encodeURIComponent(student)}:${encodeURIComponent(name)}`;

const day = date => date.toISOString().slice(0, 10);

class HttpError extends Error {
    constructor (status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const safeEqual = (a, b) => {
    const x = String(a);
    const y = String(b);
    let diff = x.length ^ y.length;
    for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
    return diff === 0;
};

const randomCode = (length = 6) => {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
};

const randomId = () => {
    const bytes = new Uint8Array(9);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
};

// Names become parts of storage keys: no control characters or slashes.
const cleanName = value => Array.from(String(value || '').trim()
    .slice(0, 80))
    .filter(ch => ch.charCodeAt(0) >= 32 && ch !== '/' && ch !== '\\')
    .join('');

/**
 * Normalize class settings sent by a teacher.
 * @param {object} json input
 * @param {object} [base] existing class
 * @returns {object} class fields
 */
export const normalizeClass = (json, base = {}) => {
    const input = json && typeof json === 'object' ? json : {};
    const models = Array.isArray(input.models) ? input.models : base.models || [];
    const limits = {...(base.limits || {}), ...(input.limits || {})};
    return {
        ...base,
        name: typeof input.name === 'undefined' ? base.name || '' : cleanName(input.name),
        models: models
            .map(m => {
                if (typeof m !== 'string') return m;
                const [provider, ...rest] = m.split('/');
                return {provider, model: rest.join('/')};
            })
            .filter(m => m && DEFAULT_PROVIDERS[m.provider] && m.model)
            .map(m => ({provider: m.provider, model: String(m.model)})),
        limits: {
            requestsPerDay: Math.max(0, Number(limits.requestsPerDay) || 0),
            tokensPerDay: Math.max(0, Number(limits.tokensPerDay) || 0),
            classTokensPerDay: Math.max(0, Number(limits.classTokensPerDay) || 0),
            audioPerDay: Math.max(0, Number(limits.audioPerDay) || 0)
        },
        roster: Array.isArray(input.roster) ? input.roster.map(cleanName).filter(Boolean) :
            (typeof input.roster === 'undefined' ? base.roster || null : null),
        active: typeof input.active === 'boolean' ? input.active : base.active !== false,
        features: {
            ai: true,
            audio: true,
            submissions: true,
            projects: true,
            ...(base.features || {}),
            ...(input.features || {})
        }
    };
};

/**
 * @param {object} options options
 * @param {object} options.store key-value store {get, put, delete, list}
 * @param {object} [options.env] ADMIN_TOKEN, ALLOWED_ORIGINS, ANTHROPIC_KEY, OPENAI_KEY, GEMINI_KEY,
 *     COMPATIBLE_URL, COMPATIBLE_KEY, ELEVENLABS_KEY, MAX_PROJECT_MB
 * @param {object} [options.providers] provider adapters (tests)
 * @param {function} [options.fetchImpl] fetch for upstream calls (tests)
 * @param {function(): Date} [options.now] clock (tests)
 * @returns {{handle: function(Request): Promise<Response>}} gateway
 */
export const createGateway = ({store, env = {}, providers = DEFAULT_PROVIDERS, fetchImpl, now = () => new Date()}) => {
    const maxProjectBytes = (Number(env.MAX_PROJECT_MB) || 10) * 1024 * 1024;
    const upstreamKey = provider => env[KEY_ENV[provider]] || '';
    const upstreamReady = provider => (provider === 'compatible' ? !!env.COMPATIBLE_URL : !!upstreamKey(provider));

    const corsHeaders = origin => {
        const allowed = String(env.ALLOWED_ORIGINS || '*').split(',')
            .map(s => s.trim())
            .filter(Boolean);
        const ok = allowed.includes('*') || allowed.includes(origin);
        return {
            'Access-Control-Allow-Origin': ok ? (allowed.includes('*') ? '*' : origin) : 'null',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
            'Vary': 'Origin'
        };
    };

    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
        status,
        headers: {'Content-Type': 'application/json; charset=utf-8', ...headers}
    });

    const readBody = async request => {
        const text = await request.text();
        if (text.length > maxProjectBytes * 1.4) throw new HttpError(413, 'too_large', 'Request is too large');
        try {
            return text ? JSON.parse(text) : {};
        } catch (e) {
            throw new HttpError(400, 'bad_json', 'Body is not valid JSON');
        }
    };

    const bearer = request => {
        const header = request.headers.get('Authorization') || '';
        return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    };

    const requireAdmin = request => {
        if (!env.ADMIN_TOKEN) throw new HttpError(403, 'admin_disabled', 'ADMIN_TOKEN is not set on the server');
        if (!safeEqual(bearer(request), env.ADMIN_TOKEN)) {
            throw new HttpError(401, 'invalid_api_key', 'Wrong admin token');
        }
    };

    const getClass = async code => {
        const klass = await store.get(`class:${String(code).toUpperCase()}`);
        if (!klass) throw new HttpError(404, 'not_found', 'Class not found');
        return klass;
    };

    // Identity: class code + student name/number, optionally limited to a roster.
    const requireStudent = async request => {
        const token = bearer(request);
        const dot = token.indexOf('.');
        const code = (dot < 0 ? token : token.slice(0, dot)).toUpperCase();
        let student = '';
        try {
            student = cleanName(decodeURIComponent(dot < 0 ? '' : token.slice(dot + 1))).slice(0, MAX_STUDENT);
        } catch (e) {
            student = '';
        }
        const klass = code && await store.get(`class:${code}`);
        if (!klass || klass.active === false) throw new HttpError(401, 'invalid_api_key', 'Unknown class code');
        if (!student) throw new HttpError(401, 'invalid_api_key', 'Missing student name or number');
        if (klass.roster && klass.roster.length && !klass.roster.includes(student)) {
            throw new HttpError(403, 'invalid_api_key', 'This name is not on the class list');
        }
        return {klass, code, student};
    };

    const usageKey = (code, date, student) => `usage:${code}:${date}:${student}`;

    const addUsage = async (code, student, model, usage) => {
        const key = usageKey(code, day(now()), student);
        const empty = {requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, models: {}};
        const record = await store.get(key) || empty;
        record.requests += 1;
        record.inputTokens += usage.inputTokens || 0;
        record.outputTokens += usage.outputTokens || 0;
        record.cachedTokens += usage.cachedTokens || 0;
        record.models[model] = (record.models[model] || 0) + 1;
        await store.put(key, record);
        const classKey = `usage-class:${code}:${day(now())}`;
        const total = await store.get(classKey) || {requests: 0, tokens: 0};
        total.requests += 1;
        total.tokens += (usage.inputTokens || 0) + (usage.outputTokens || 0);
        await store.put(classKey, total);
    };

    const checkQuota = async (klass, code, student) => {
        const limits = klass.limits || {};
        const today = day(now());
        const mine = await store.get(usageKey(code, today, student));
        if (mine && limits.requestsPerDay && mine.requests >= limits.requestsPerDay) {
            throw new HttpError(429, 'insufficient_quota', `Daily request limit reached (${limits.requestsPerDay})`);
        }
        if (mine && limits.tokensPerDay && mine.inputTokens + mine.outputTokens >= limits.tokensPerDay) {
            throw new HttpError(429, 'insufficient_quota', `Daily token limit reached (${limits.tokensPerDay})`);
        }
        if (limits.classTokensPerDay) {
            const total = await store.get(`usage-class:${code}:${today}`);
            if (total && total.tokens >= limits.classTokensPerDay) {
                throw new HttpError(429, 'insufficient_quota', 'The class has used today\'s budget');
            }
        }
    };

    const classModels = klass => (klass.models || []).filter(m => upstreamReady(m.provider));

    const complete = async (request, {klass, code, student}) => {
        if (klass.features && klass.features.ai === false) {
            throw new HttpError(403, 'disabled', 'AI is turned off for this class');
        }
        const body = await readBody(request);
        if (!Array.isArray(body.messages) || !body.messages.length) {
            throw new HttpError(400, 'bad_request', 'messages is required');
        }
        await checkQuota(klass, code, student);
        const models = classModels(klass);
        if (!models.length) throw new HttpError(503, 'model_not_found', 'No model is configured for this class');
        const wanted = models.findIndex(m => `${m.provider}/${m.model}` === body.model);
        const chain = wanted > 0 ? models.slice(wanted) : models;
        let lastError = null;
        for (const entry of chain) {
            try {
                const result = await providers[entry.provider].complete({
                    apiKey: upstreamKey(entry.provider),
                    baseUrl: entry.provider === 'compatible' ? env.COMPATIBLE_URL : '',
                    model: entry.model,
                    system: typeof body.system === 'string' ? body.system : '',
                    messages: body.messages.map(m => ({
                        role: m.role === 'assistant' ? 'assistant' : 'user',
                        content: String(m.content)
                    })),
                    json: !!body.json,
                    maxTokens: Math.min(Number(body.maxTokens) || 4000, 32000),
                    fetchImpl
                });
                const id = `${entry.provider}/${entry.model}`;
                await addUsage(code, student, id, result.usage || {});
                return json({
                    text: result.text,
                    truncated: !!result.truncated,
                    usage: result.usage || {},
                    model: id,
                    downgraded: entry !== chain[0]
                });
            } catch (e) {
                lastError = e instanceof AIError ? e : new AIError(ErrorKind.BAD_REQUEST, e.message);
                if (!isDowngradable(lastError) && lastError.kind !== ErrorKind.AUTH) break;
            }
        }
        const status = lastError.kind === ErrorKind.QUOTA ? 429 : 502;
        throw new HttpError(status, lastError.kind === ErrorKind.QUOTA ? 'insufficient_quota' : 'upstream_error',
            `Upstream: ${lastError.message}`);
    };

    // AI sound effects and music with the server's keys; counted per student per day.
    const audio = async (request, {klass, code, student}) => {
        if (klass.features && klass.features.audio === false) {
            throw new HttpError(403, 'disabled', 'AI audio is turned off for this class');
        }
        const body = await readBody(request);
        const prompt = String(body.prompt || '').slice(0, 2000);
        if (!prompt) throw new HttpError(400, 'bad_request', 'prompt is required');
        const kind = body.kind === 'music' ? 'music' : 'sfx';
        const key = `usage-audio:${code}:${day(now())}:${student}`;
        const used = (await store.get(key)) || 0;
        const limit = (klass.limits && klass.limits.audioPerDay) || 0;
        if (limit && used >= limit) {
            throw new HttpError(429, 'insufficient_quota', `Daily audio limit reached (${limit})`);
        }
        // Music prefers Lyria (Gemini key); sound effects need ElevenLabs.
        let engine = body.engine;
        if (!engine) engine = kind === 'music' && env.GEMINI_KEY ? 'lyria' : 'elevenlabs';
        let result;
        try {
            if (engine === 'lyria' && kind === 'music' && env.GEMINI_KEY) {
                result = await lyriaMusic({apiKey: env.GEMINI_KEY, prompt, fetchImpl});
            } else if (env.ELEVENLABS_KEY) {
                result = kind === 'music' ?
                    await elevenLabsMusic({apiKey: env.ELEVENLABS_KEY, prompt, seconds: 30, fetchImpl}) :
                    await elevenLabsSfx({
                        apiKey: env.ELEVENLABS_KEY,
                        prompt,
                        durationSeconds: Number(body.durationSeconds) || 0,
                        loop: !!body.loop,
                        fetchImpl
                    });
            } else {
                const what = kind === 'music' ? 'music' : 'sound effect';
                throw new HttpError(503, 'model_not_found', `No ${what} service is configured`);
            }
        } catch (e) {
            if (e instanceof HttpError) throw e;
            throw new HttpError(e.kind === ErrorKind.QUOTA ? 429 : 502,
                e.kind === ErrorKind.QUOTA ? 'insufficient_quota' : 'upstream_error', `Upstream: ${e.message}`);
        }
        await store.put(key, used + 1);
        return json({
            format: result.format,
            rate: result.rate,
            mimeType: result.mimeType,
            data: toBase64(result.data)
        });
    };

    // ---- storage helpers (submissions, projects) ----

    const decodeProject = text => {
        const data = String(text || '');
        if (!data) throw new HttpError(400, 'bad_request', 'project is required (base64)');
        const size = Math.floor(data.length * 3 / 4);
        if (size > maxProjectBytes) throw new HttpError(413, 'too_large', 'Project is too large');
        return {data, size};
    };

    const listMeta = async prefix => {
        const keys = await store.list(prefix);
        const items = await Promise.all(keys.map(key => store.get(key)));
        return items.filter(Boolean);
    };

    const routes = [
        ['GET', /^\/v1\/health$/, () => json({
            ok: true,
            version: VERSION,
            upstreams: Object.keys(providers).filter(upstreamReady),
            audio: {music: !!(env.GEMINI_KEY || env.ELEVENLABS_KEY), sfx: !!env.ELEVENLABS_KEY},
            admin: !!env.ADMIN_TOKEN
        })],

        // ---- students ----
        ['GET', /^\/v1\/whoami$/, async request => {
            const {klass, student} = await requireStudent(request);
            return json({student, className: klass.name, features: klass.features, limits: klass.limits});
        }],
        ['GET', /^\/v1\/models$/, async request => {
            const {klass} = await requireStudent(request);
            return json({data: classModels(klass).map(m => ({id: `${m.provider}/${m.model}`}))});
        }],
        ['POST', /^\/v1\/complete$/, async request => complete(request, await requireStudent(request))],
        ['POST', /^\/v1\/audio$/, async request => audio(request, await requireStudent(request))],
        ['GET', /^\/v1\/usage$/, async request => {
            const {klass, code, student} = await requireStudent(request);
            const usage = await store.get(usageKey(code, day(now()), student));
            return json({today: usage || null, limits: klass.limits});
        }],
        ['POST', /^\/v1\/submissions$/, async request => {
            const {klass, code, student} = await requireStudent(request);
            if (klass.features.submissions === false) {
                throw new HttpError(403, 'disabled', 'Submissions are turned off');
            }
            const body = await readBody(request);
            const {data, size} = decodeProject(body.project);
            const id = randomId();
            const meta = {
                id,
                student,
                assignment: cleanName(body.assignment) || 'assignment',
                fileName: cleanName(body.fileName) || `${student}.sb3`,
                size,
                createdAt: now().toISOString(),
                summary: body.summary && typeof body.summary === 'object' ? body.summary : null,
                report: typeof body.report === 'string' ? body.report.slice(0, 50000) : ''
            };
            await store.put(`subdata:${code}:${id}`, data);
            await store.put(`sub:${code}:${id}`, meta);
            return json({id, createdAt: meta.createdAt}, 201);
        }],
        ['GET', /^\/v1\/submissions$/, async request => {
            const {code, student} = await requireStudent(request);
            const all = await listMeta(`sub:${code}:`);
            // The report can be long; the list only needs the summary.
            return json({data: all.filter(s => s.student === student).map(item => ({...item, report: ''}))});
        }],
        ['GET', /^\/v1\/projects$/, async request => {
            const {code, student} = await requireStudent(request);
            return json({data: await listMeta(`proj:${code}:${encodeURIComponent(student)}:`)});
        }],
        ['PUT', /^\/v1\/projects\/([^/]+)$/, async (request, match) => {
            const {klass, code, student} = await requireStudent(request);
            if (klass.features.projects === false) {
                throw new HttpError(403, 'disabled', 'Cloud projects are turned off');
            }
            const name = cleanName(decodeURIComponent(match[1]));
            const body = await readBody(request);
            const {data, size} = decodeProject(body.project);
            const base = projectKey(code, student, name);
            const meta = {name, size, updatedAt: now().toISOString()};
            await store.put(`projdata:${base}`, data);
            await store.put(`proj:${base}`, meta);
            return json(meta);
        }],
        ['GET', /^\/v1\/projects\/([^/]+)$/, async (request, match) => {
            const {code, student} = await requireStudent(request);
            const base = projectKey(code, student, cleanName(decodeURIComponent(match[1])));
            const [meta, data] = await Promise.all([store.get(`proj:${base}`), store.get(`projdata:${base}`)]);
            if (!meta || !data) throw new HttpError(404, 'not_found', 'Project not found');
            return json({...meta, project: data});
        }],
        ['DELETE', /^\/v1\/projects\/([^/]+)$/, async (request, match) => {
            const {code, student} = await requireStudent(request);
            const base = projectKey(code, student, cleanName(decodeURIComponent(match[1])));
            await store.delete(`proj:${base}`);
            await store.delete(`projdata:${base}`);
            return json({ok: true});
        }],

        // ---- teacher ----
        ['GET', /^\/v1\/admin\/classes$/, async request => {
            requireAdmin(request);
            return json({data: await listMeta('class:')});
        }],
        ['POST', /^\/v1\/admin\/classes$/, async request => {
            requireAdmin(request);
            const body = await readBody(request);
            let code = randomCode();
            while (await store.get(`class:${code}`)) code = randomCode();
            const klass = {...normalizeClass(body), code, createdAt: now().toISOString()};
            await store.put(`class:${code}`, klass);
            return json(klass, 201);
        }],
        ['GET', /^\/v1\/admin\/classes\/([A-Za-z0-9]+)$/, async (request, match) => {
            requireAdmin(request);
            return json(await getClass(match[1]));
        }],
        ['PATCH', /^\/v1\/admin\/classes\/([A-Za-z0-9]+)$/, async (request, match) => {
            requireAdmin(request);
            const klass = await getClass(match[1]);
            const updated = normalizeClass(await readBody(request), klass);
            await store.put(`class:${klass.code}`, updated);
            return json(updated);
        }],
        ['DELETE', /^\/v1\/admin\/classes\/([A-Za-z0-9]+)$/, async (request, match) => {
            requireAdmin(request);
            const klass = await getClass(match[1]);
            await store.delete(`class:${klass.code}`);
            return json({ok: true});
        }],
        ['GET', /^\/v1\/admin\/classes\/([A-Za-z0-9]+)\/usage$/, async (request, match) => {
            requireAdmin(request);
            const klass = await getClass(match[1]);
            const days = Math.min(Math.max(Number(new URL(request.url).searchParams.get('days')) || 7, 1), 60);
            const dates = Array.from({length: days}, (_, i) => day(new Date(now().getTime() - (i * 86400000))));
            const students = {};
            for (const date of dates) {
                for (const key of await store.list(`usage:${klass.code}:${date}:`)) {
                    const student = key.slice(`usage:${klass.code}:${date}:`.length);
                    students[student] = students[student] || {};
                    students[student][date] = await store.get(key);
                }
            }
            return json({code: klass.code, dates, students});
        }],
        ['GET', /^\/v1\/admin\/classes\/([A-Za-z0-9]+)\/submissions$/, async (request, match) => {
            requireAdmin(request);
            const klass = await getClass(match[1]);
            const list = await listMeta(`sub:${klass.code}:`);
            list.sort((a, b) => String(b.createdAt).localeCompare(a.createdAt));
            return json({data: list});
        }],
        ['GET', /^\/v1\/admin\/classes\/([A-Za-z0-9]+)\/submissions\/([a-f0-9]+)$/, async (request, match) => {
            requireAdmin(request);
            const klass = await getClass(match[1]);
            const [meta, data] = await Promise.all([
                store.get(`sub:${klass.code}:${match[2]}`), store.get(`subdata:${klass.code}:${match[2]}`)
            ]);
            if (!meta || !data) throw new HttpError(404, 'not_found', 'Submission not found');
            return json({...meta, project: data});
        }],
        ['DELETE', /^\/v1\/admin\/classes\/([A-Za-z0-9]+)\/submissions\/([a-f0-9]+)$/, async (request, match) => {
            requireAdmin(request);
            const klass = await getClass(match[1]);
            await store.delete(`sub:${klass.code}:${match[2]}`);
            await store.delete(`subdata:${klass.code}:${match[2]}`);
            return json({ok: true});
        }]
    ];

    const handle = async request => {
        const cors = corsHeaders(request.headers.get('Origin') || '');
        if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
        const path = new URL(request.url).pathname.replace(/\/+$/, '');
        let response;
        try {
            const route = routes.find(([method, pattern]) => method === request.method && pattern.test(path));
            if (!route) throw new HttpError(404, 'not_found', 'Unknown endpoint');
            response = await route[2](request, path.match(route[1]));
        } catch (e) {
            const status = e instanceof HttpError ? e.status : 500;
            response = json({error: {code: e.code || 'server_error', message: e.message}}, status);
        }
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
    };

    return {handle};
};
