/**
 * @jest-environment node
 */
import {createGateway} from '../../../server/core/gateway.js';
import {memoryStore} from '../../../server/core/stores.js';
import {AIError, ErrorKind} from '../../../src/ai/providers/errors.js';

const fakeProviders = calls => ({
    anthropic: {
        async complete (request) {
            calls.push(request);
            if (request.model === 'claude-big') throw new AIError(ErrorKind.QUOTA, 'no credit');
            return {text: `{"ok":true,"model":"${request.model}"}`, usage: {inputTokens: 100, outputTokens: 20}};
        }
    },
    openai: {complete: async () => ({text: 'x', usage: {}})}
});

const setup = (env = {}) => {
    const calls = [];
    let clock = new Date('2026-10-12T08:00:00Z');
    const gateway = createGateway({
        store: memoryStore(),
        env: {ADMIN_TOKEN: 'admin-secret', ANTHROPIC_KEY: 'sk-up', ALLOWED_ORIGINS: 'https://school.example', ...env},
        providers: fakeProviders(calls),
        now: () => clock
    });
    const call = async (method, path, {token, body, origin = 'https://school.example'} = {}) => {
        const response = await gateway.handle(new Request(`http://gw.test${path}`, {
            method,
            headers: {
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
                'Content-Type': 'application/json',
                'Origin': origin
            },
            body: body ? JSON.stringify(body) : null
        }));
        return {status: response.status, body: await response.json().catch(() => null), headers: response.headers};
    };
    return {call, calls, setClock: date => {
        clock = date;
    }};
};

describe('class gateway', () => {
    test('teacher creates a class, students use the class code', async () => {
        const {call, calls} = setup();
        expect((await call('GET', '/v1/health')).body).toMatchObject({ok: true, version: 2, upstreams: ['anthropic']});
        expect((await call('POST', '/v1/admin/classes', {token: 'wrong', body: {}})).status).toBe(401);
        const created = await call('POST', '/v1/admin/classes', {token: 'admin-secret', body: {
            name: '五年甲班',
            models: ['anthropic/claude-big', 'anthropic/claude-small', 'openai/gpt-x'],
            limits: {requestsPerDay: 2}
        }});
        expect(created.status).toBe(201);
        const code = created.body.code;
        expect(code).toMatch(/^[A-Z2-9]{6}$/);

        const student = `${code}.${encodeURIComponent('05 王小明')}`;
        expect((await call('GET', '/v1/whoami', {token: student})).body).toMatchObject({student: '05 王小明', className: '五年甲班'});
        // openai has no upstream key on the server, so it is not offered
        expect((await call('GET', '/v1/models', {token: student})).body.data.map(m => m.id))
            .toEqual(['anthropic/claude-big', 'anthropic/claude-small']);
        expect((await call('GET', '/v1/models', {token: 'NOPE.x'})).status).toBe(401);

        const answer = await call('POST', '/v1/complete', {token: student, body: {
            system: 'sys', messages: [{role: 'user', content: 'hi'}], json: true, maxTokens: 100
        }});
        expect(answer.status).toBe(200);
        // the big model is out of credit, the gateway moves down the class list
        expect(answer.body).toMatchObject({model: 'anthropic/claude-small', downgraded: true});
        expect(calls[0]).toMatchObject({apiKey: 'sk-up', model: 'claude-big', system: 'sys', json: true});
        expect(answer.headers.get('Access-Control-Allow-Origin')).toBe('https://school.example');

        await call('POST', '/v1/complete', {token: student, body: {messages: [{role: 'user', content: 'again'}]}});
        const limited = await call('POST', '/v1/complete', {token: student, body: {messages: [{role: 'user', content: '3'}]}});
        expect(limited.status).toBe(429);
        expect(limited.body.error.code).toBe('insufficient_quota');

        const usage = await call('GET', `/v1/admin/classes/${code}/usage?days=2`, {token: 'admin-secret'});
        expect(usage.body.students['05 王小明']['2026-10-12']).toMatchObject({requests: 2, inputTokens: 200, outputTokens: 40});
    });

    test('roster, submissions and cloud projects', async () => {
        const {call} = setup();
        const {body: klass} = await call('POST', '/v1/admin/classes', {token: 'admin-secret', body: {
            name: 'c', models: ['anthropic/claude-small'], roster: ['01', '02']
        }});
        expect((await call('GET', '/v1/whoami', {token: `${klass.code}.99`})).status).toBe(403);
        const token = `${klass.code}.01`;
        const project = Buffer.from('PK fake sb3').toString('base64');
        const sent = await call('POST', '/v1/submissions', {token, body: {
            assignment: '接蘋果', fileName: '01.sb3', project, report: '# ok', summary: {total: 80}
        }});
        expect(sent.status).toBe(201);
        expect((await call('GET', '/v1/submissions', {token})).body.data).toHaveLength(1);
        const list = await call('GET', `/v1/admin/classes/${klass.code}/submissions`, {token: 'admin-secret'});
        expect(list.body.data[0]).toMatchObject({student: '01', assignment: '接蘋果', summary: {total: 80}});
        const one = await call('GET', `/v1/admin/classes/${klass.code}/submissions/${sent.body.id}`, {token: 'admin-secret'});
        expect(Buffer.from(one.body.project, 'base64').toString()).toBe('PK fake sb3');

        expect((await call('PUT', `/v1/projects/${encodeURIComponent('我的遊戲')}`, {token, body: {project}})).status).toBe(200);
        expect((await call('GET', '/v1/projects', {token})).body.data.map(p => p.name)).toEqual(['我的遊戲']);
        expect((await call('GET', `/v1/projects/${encodeURIComponent('我的遊戲')}`, {token})).body.project).toBe(project);
        // another student cannot see it
        expect((await call('GET', '/v1/projects', {token: `${klass.code}.02`})).body.data).toEqual([]);

        await call('PATCH', `/v1/admin/classes/${klass.code}`, {token: 'admin-secret', body: {active: false}});
        expect((await call('GET', '/v1/whoami', {token})).status).toBe(401);
    });

    test('origins outside the allow list get no CORS access', async () => {
        const {call} = setup();
        const response = await call('GET', '/v1/health', {origin: 'https://evil.example'});
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null');
    });
});
