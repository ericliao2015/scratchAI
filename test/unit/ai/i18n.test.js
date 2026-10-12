import fs from 'fs';
import path from 'path';
import en from '../../../src/components/ai-panel/messages-en.js';
import {setLocale, t} from '../../../src/components/ai-panel/i18n.js';

const dir = path.join(__dirname, '../../../src/components/ai-panel');

const sourceKeys = () => {
    const keys = new Set();
    for (const file of fs.readdirSync(dir)) {
        if (!/\.jsx?$/.test(file) || file.startsWith('messages')) continue;
        const source = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const match of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
            // eslint-disable-next-line no-eval
            keys.add(eval(`'${match[1]}'`));
        }
    }
    return keys;
};

describe('AI panel translations', () => {
    test('every UI string has an English translation', () => {
        const missing = [...sourceKeys()].filter(key => !(key in en));
        expect(missing).toEqual([]);
    });

    test('placeholders work in both languages', () => {
        setLocale('zh-tw');
        expect(t('已載入 {0} 個模型', [3])).toBe('已載入 3 個模型');
        setLocale('en');
        expect(t('已載入 {0} 個模型', [3])).toBe('Loaded 3 models');
        expect(t('沒有翻譯的字')).toBe('沒有翻譯的字');
        setLocale('zh-cn');
        expect(t('設定')).toBe('設定');
    });
});
