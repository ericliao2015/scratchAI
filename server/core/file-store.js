/**
 * File store for Node: one JSON file per key under a data directory.
 */
import {mkdir, readFile, readdir, rm, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';

const fileName = key => `${encodeURIComponent(key)}.json`;

/**
 * @param {string} dir data directory
 * @returns {object} store
 */
export const fileStore = dir => {
    const ready = mkdir(dir, {recursive: true});
    return {
        async get (key) {
            await ready;
            try {
                return JSON.parse(await readFile(join(dir, fileName(key)), 'utf8'));
            } catch (e) {
                if (e.code === 'ENOENT') return null;
                throw e;
            }
        },
        async put (key, value) {
            await ready;
            const target = join(dir, fileName(key));
            const temp = `${target}.${process.pid}.tmp`;
            await writeFile(temp, JSON.stringify(value));
            await rename(temp, target);
        },
        async delete (key) {
            await ready;
            await rm(join(dir, fileName(key)), {force: true});
        },
        async list (prefix) {
            await ready;
            const names = await readdir(dir);
            return names.filter(name => name.endsWith('.json'))
                .map(name => decodeURIComponent(name.slice(0, -5)))
                .filter(key => key.startsWith(prefix))
                .sort();
        }
    };
};
