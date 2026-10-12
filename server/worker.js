/**
 * Cloudflare Workers entry for the BlockAI gateway. Needs a KV namespace bound as BLOCKAI
 * and the secrets described in server/README.md. Deploy with `npx wrangler deploy` from server/.
 */
import {createGateway} from './core/gateway.js';
import {kvStore} from './core/stores.js';

export default {
    fetch (request, env) {
        return createGateway({store: kvStore(env.BLOCKAI), env}).handle(request);
    }
};
