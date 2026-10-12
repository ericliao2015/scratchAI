/**
 * Optional proxy for BlockAI (Cloudflare Workers).
 *
 * Use it when a provider does not allow calls straight from the browser (CORS),
 * or when a teacher wants students to share one KEY that never reaches their computers.
 *
 *   https://<worker>/agnes/v1/...  -> https://apihub.agnes-ai.com/v1/...
 *   https://<worker>/openai/v1/... -> https://api.openai.com/v1/...
 *
 * In BlockAI: Settings -> image "service URL" = https://<worker>/agnes/v1
 * or platform "OpenAI compatible" with server URL https://<worker>/openai/v1.
 *
 * Environment variables (Workers -> Settings -> Variables):
 *   ALLOWED_ORIGIN  e.g. https://ericliao2015.github.io (required)
 *   AGNES_KEY       optional: shared key; when set it replaces whatever key the browser sends
 *   OPENAI_KEY      optional: same for OpenAI
 *   DAILY_LIMIT     optional: max requests per client IP per day (needs a KV binding named LIMITS)
 */

const UPSTREAMS = {
    agnes: {base: 'https://apihub.agnes-ai.com', key: 'AGNES_KEY'},
    openai: {base: 'https://api.openai.com', key: 'OPENAI_KEY'}
};

const cors = (origin, env) => ({
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN === '*' ? '*' : (origin === env.ALLOWED_ORIGIN ? origin : 'null'),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400'
});

const overLimit = async (request, env) => {
    if (!env.DAILY_LIMIT || !env.LIMITS) return false;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `${new Date().toISOString().slice(0, 10)}:${ip}`;
    const used = Number(await env.LIMITS.get(key)) || 0;
    if (used >= Number(env.DAILY_LIMIT)) return true;
    await env.LIMITS.put(key, String(used + 1), {expirationTtl: 2 * 24 * 3600});
    return false;
};

export default {
    async fetch (request, env) {
        const origin = request.headers.get('Origin') || '';
        const headers = cors(origin, env);
        if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
        if (!env.ALLOWED_ORIGIN || (env.ALLOWED_ORIGIN !== '*' && origin !== env.ALLOWED_ORIGIN)) {
            return new Response('Origin not allowed', {status: 403, headers});
        }
        const url = new URL(request.url);
        const [, name, ...rest] = url.pathname.split('/');
        const upstream = UPSTREAMS[name];
        if (!upstream) return new Response('Unknown service', {status: 404, headers});
        if (await overLimit(request, env)) {
            return new Response(JSON.stringify({error: {message: 'daily limit reached', code: 'insufficient_quota'}}),
                {status: 429, headers: {...headers, 'Content-Type': 'application/json'}});
        }
        const forward = new Headers(request.headers);
        forward.delete('Origin');
        forward.delete('Cookie');
        if (env[upstream.key]) forward.set('Authorization', `Bearer ${env[upstream.key]}`);
        const response = await fetch(`${upstream.base}/${rest.join('/')}${url.search}`, {
            method: request.method,
            headers: forward,
            body: request.method === 'GET' ? null : request.body
        });
        const out = new Response(response.body, response);
        for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
        return out;
    }
};
