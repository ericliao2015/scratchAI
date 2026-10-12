/**
 * Run the BlockAI gateway on Node 22+:
 *
 *   ADMIN_TOKEN=... ANTHROPIC_KEY=... node server/node.js
 *
 * Environment: PORT (8787), DATA_DIR (./blockai-data), ALLOWED_ORIGINS, ADMIN_TOKEN,
 * ANTHROPIC_KEY, OPENAI_KEY, GEMINI_KEY, COMPATIBLE_URL, COMPATIBLE_KEY, MAX_PROJECT_MB.
 */
import {createServer} from 'node:http';
import {createGateway} from './core/gateway.js';
import {fileStore} from './core/file-store.js';
import {memoryStore} from './core/stores.js';

const env = process.env;
const store = env.DATA_DIR === ':memory:' ? memoryStore() : fileStore(env.DATA_DIR || './blockai-data');
const gateway = createGateway({store, env});
const port = Number(env.PORT) || 8787;

createServer(async (req, res) => {
    try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? Buffer.concat(chunks) : null;
        const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
            method: req.method,
            headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
            body: req.method === 'GET' || req.method === 'HEAD' || !body ? null : body
        });
        const response = await gateway.handle(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error: {code: 'server_error', message: e.message}}));
    }
}).listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`BlockAI gateway listening on http://localhost:${port} (admin ${env.ADMIN_TOKEN ? 'on' : 'off'})`);
});
