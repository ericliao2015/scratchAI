/**
 * Grading reports: one Markdown file per project, a CSV summary and a zip of everything.
 */
import JSZip from '@turbowarp/jszip';

const csvCell = value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Parse a file name like "05_王小明.sb3" into seat number and name.
 * @param {string} fileName file name
 * @returns {{seat: string, name: string, base: string}} parts
 */
export const parseFileName = fileName => {
    const base = String(fileName).replace(/^.*[\\/]/, '')
        .replace(/\.sb3$/i, '');
    const match = /^(\d+)[\s_\-.]*(.*)$/.exec(base);
    return match ? {seat: match[1], name: match[2] || base, base} : {seat: '', name: base, base};
};

const verdict = (item, scoring) => (scoring === 'passfail' ?
    (item.pass ? '✅ 通過' : '❌ 未通過') :
    `${item.pass ? '✅' : '❌'} ${item.score}/${item.points}`);

/**
 * @param {object} entry {fileName, result, error, describeEvidence}
 * @returns {string} markdown report
 */
export const toMarkdown = ({fileName, result, error, describeEvidence = e => e.alias || e.blockId}) => {
    const {seat, name} = parseFileName(fileName);
    const lines = [`# ${result ? result.template.title : '批改結果'}`, ''];
    lines.push(`- 檔案：${fileName}`);
    if (seat) lines.push(`- 座號：${seat}`);
    lines.push(`- 姓名：${name}`);
    lines.push(`- 批改時間：${new Date().toLocaleString('zh-TW')}`);
    if (error) {
        lines.push('', `**無法批改：${error}**`);
        return lines.join('\n');
    }
    if (result.model) {
        lines.push(`- 使用模型：${result.model.model}${result.model.downgraded ? '（自動降級）' : ''}`);
    }
    const scoring = result.template.scoring;
    lines.push(scoring === 'passfail' ?
        `- 結果：${result.overallPass ? '通過' : '未通過'}（${result.passedCount}/${result.itemCount} 項）` :
        `- 總分：${result.total}/${result.max}（通過 ${result.passedCount}/${result.itemCount} 項）`);
    lines.push('', '| 項目 | 結果 | 說明 |', '|---|---|---|');
    for (const item of result.items) {
        lines.push(`| ${item.desc.replace(/\|/g, '\\|')} | ${verdict(item, scoring)} | ` +
            `${(item.reason || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    }
    const withEvidence = result.items.filter(i => i.evidence && i.evidence.length);
    if (withEvidence.length) {
        lines.push('', '## 相關積木');
        for (const item of withEvidence) {
            lines.push(`- ${item.desc}：${item.evidence.map(e => `${e.target} ${describeEvidence(e)}`).join('；')}`);
        }
    }
    if (result.summary) lines.push('', '## 整體回饋', '', result.summary);
    return lines.join('\n');
};

/**
 * @param {Array<{fileName, result, error}>} entries graded files
 * @returns {string} CSV with a BOM so Excel opens it as UTF-8
 */
export const toCsv = entries => {
    const template = entries.find(e => e.result);
    const items = template ? template.result.items : [];
    const scoring = template ? template.result.template.scoring : 'points';
    const header = ['座號', '姓名', '檔案', scoring === 'passfail' ? '結果' : '總分', '通過項數',
        ...items.map(i => i.desc), '模型', '錯誤'];
    const rows = entries.map(({fileName, result, error}) => {
        const {seat, name} = parseFileName(fileName);
        if (!result) return [seat, name, fileName, '', '', ...items.map(() => ''), '', error || ''];
        return [
            seat, name, fileName,
            scoring === 'passfail' ? (result.overallPass ? '通過' : '未通過') : result.total,
            `${result.passedCount}/${result.itemCount}`,
            ...items.map(item => {
                const own = result.items.find(i => i.id === item.id);
                if (!own) return '';
                return scoring === 'passfail' ? (own.pass ? '通過' : '未通過') : own.score;
            }),
            result.model ? `${result.model.model}${result.model.downgraded ? '(降級)' : ''}` : '',
            ''
        ];
    });
    return `﻿${[header, ...rows].map(row => row.map(csvCell).join(','))
        .join('\r\n')}\r\n`;
};

/**
 * @param {Array<{fileName, result, error}>} entries graded files
 * @param {object} options {title, describeEvidence}
 * @returns {Promise<Blob>} zip with one .md per file, summary.csv and results.json
 */
export const buildReportZip = async (entries, {title = '批改結果', describeEvidence} = {}) => {
    const zip = new JSZip();
    const folder = zip.folder('reports');
    const used = new Set();
    for (const entry of entries) {
        let name = `${parseFileName(entry.fileName).base}.md`;
        let n = 2;
        while (used.has(name)) name = `${parseFileName(entry.fileName).base}-${n++}.md`;
        used.add(name);
        folder.file(name, toMarkdown({...entry, describeEvidence}));
    }
    zip.file('summary.csv', toCsv(entries));
    zip.file('results.json', JSON.stringify({title, createdAt: new Date().toISOString(), entries}, null, 2));
    return zip.generateAsync({type: 'blob'});
};

export const reportFileName = title => {
    const date = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    return `批改結果_${String(title).replace(/[\\/:*?"<>|]/g, '_')}_${stamp}.zip`;
};
