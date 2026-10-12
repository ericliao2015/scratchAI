import PropTypes from 'prop-types';
import React, {useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {gradeProject, studentViewOf} from '../../ai/grade/grade.js';
import {normalizeTemplate} from '../../ai/grade/template.js';
import {toMarkdown} from '../../ai/grade/report.js';
import {modelFromVM} from '../../ai/project/model.js';
import {describeError} from './errors.js';
import downloadBlob from '../../lib/download-blob.js';
import {t} from './i18n.js';
import {projectDataWithIds, runTest} from '../../ai/run/verify.js';

const FREE_TEXT = '__free__';

/** Each non-empty line of free text becomes one AI-judged item. */
const templateFromText = text => {
    const lines = text.split('\n').map(l => l.replace(/^\s*[-*\d.、)）]+\s*/, '').trim())
        .filter(Boolean);
    const points = lines.length ? Math.round(100 / lines.length) : 0;
    return normalizeTemplate({
        title: t('自訂標準'),
        items: lines.map((line, i) => ({id: `a${i + 1}`, type: 'ai', desc: line, points})),
        studentView: 'full'
    });
};

export const ResultView = ({result, services, teacher}) => {
    const shown = teacher ? result : studentViewOf(result);
    const scoring = result.template.scoring;
    return (
        <div className={styles.card}>
            <div className={styles.row}>
                <strong className={styles.grow}>{result.template.title}</strong>
                <strong className={result.overallPass ? styles.pass : styles.fail}>
                    {scoring === 'passfail' ?
                        t('{0}（{1}/{2}）', [result.overallPass ? t('通過') : t('未通過'), result.passedCount, result.itemCount]) :
                        t('{0}/{1} 分', [result.total, result.max])}
                </strong>
            </div>
            {shown.items.length === 0 ? (
                <p className={styles.hint}>{t('通過 {0}/{1} 項', [result.passedCount, result.itemCount])}</p>
            ) : (
                <table className={styles.table}>
                    <tbody>
                        {shown.items.map(item => (
                            <tr key={item.id}>
                                <td className={item.pass ? styles.pass : styles.fail}>
                                    {scoring === 'passfail' ? (item.pass ? '✓' : '✗') : `${item.score}/${item.points}`}
                                </td>
                                <td>
                                    <div>{item.desc}</div>
                                    {item.reason && <div className={styles.meta}>{item.reason}</div>}
                                    {item.run && (
                                        <details className={styles.meta}>
                                            <summary>{t('執行紀錄')}</summary>
                                            <pre className={styles.code}>{item.run.report}</pre>
                                        </details>
                                    )}
                                    {item.evidence && item.evidence.length > 0 && (
                                        <div className={styles.chips}>
                                            {item.evidence.slice(0, 5).map((e, i) => (
                                                <button
                                                    key={i}
                                                    className={styles.chip}
                                                    onClick={() => services.highlightBlock(e.target, e.blockId)}
                                                    title={e.text}
                                                >{t('{0}：{1}', [e.target, (e.text || e.alias || t('積木')).slice(0, 24)])}</button>
                                            ))}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {result.ai && result.ai.totalBlocks > 0 && (
                <div className={styles.meta}>
                    {t('🤖 AI 產生的積木：{0}%（{1}/{2}），AI 產生 {3} 次、家教 {4} 次', [
                        Math.round(result.ai.share * 100), result.ai.aiBlocks, result.ai.totalBlocks,
                        result.ai.generations, result.ai.tutorCount
                    ])}
                </div>
            )}
            {shown.summary && <div className={classNames(styles.message, styles.messageAi)}>{shown.summary}</div>}
            {result.model && <div className={styles.meta}>{t('AI：{0}{1}', [result.model.model, result.model.downgraded ? t('（已降級）') : ''])}</div>}
        </div>
    );
};
ResultView.propTypes = {
    result: PropTypes.object.isRequired,
    services: PropTypes.object.isRequired,
    teacher: PropTypes.bool
};

const GradeTab = ({services}) => {
    const {permissions, modeState} = services;
    const teacher = permissions.teacher;
    const templates = teacher ? services.templates :
        (modeState.classConfig ? modeState.classConfig.templates.map(normalizeTemplate)
            .filter(tpl => tpl.studentView !== 'hidden') : services.templates);
    const allowFreeText = teacher || !modeState.classConfig;
    const [choice, setChoice] = useState(templates.length ? templates[0].id : FREE_TEXT);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);

    if (!permissions.selfCheck && !teacher) {
        return (
            <div className={styles.body}>
                <div className={classNames(styles.message, styles.messageWarning)}>{t('老師已關閉自我檢查功能。')}</div>
            </div>
        );
    }

    const template = choice === FREE_TEXT ? templateFromText(text) : templates.find(tpl => tpl.id === choice);

    const run = async () => {
        if (!template || template.items.length === 0) return;
        setBusy(true);
        setError('');
        setResult(null);
        try {
            const graded = await gradeProject({
                model: modelFromVM(services.vm),
                template,
                client: services.hasTextModel() ? services.client : null,
                catalog: services.getCatalog(),
                language: services.language,
                runTest: async test => runTest({
                    data: await projectDataWithIds(services.vm),
                    storage: services.vm.runtime.storage,
                    test
                })
            });
            setResult(graded);
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy(false);
        }
    };

    const exportReport = () => {
        const title = services.getProjectTitle() || t('專案');
        const md = toMarkdown({fileName: `${title}.sb3`, result});
        downloadBlob(t('{0}_批改.md', [title]), new Blob([md], {type: 'text/markdown;charset=utf-8'}));
    };

    return (
        <div className={styles.body}>
            <p className={styles.hint}>
                {teacher ? t('檢查目前開啟的專案是否符合標準。要一次批改多個檔案請用「批次」。') :
                    t('交作業前先檢查看看，你的程式有沒有做到要求。')}
            </p>
            <label className={styles.label}>{t('檢查標準')}</label>
            <select
                className={styles.select}
                value={choice}
                onChange={e => setChoice(e.target.value)}
            >
                {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.title}</option>)}
                {allowFreeText && <option value={FREE_TEXT}>{t('自由輸入標準…')}</option>}
            </select>
            {choice === FREE_TEXT && (
                <React.Fragment>
                    <textarea
                        className={styles.textarea}
                        value={text}
                        placeholder={t('一行一個標準，例如：\n按下綠旗後角色回到中間\n按方向鍵可以移動\n碰到蘋果分數加 1')}
                        onChange={e => setText(e.target.value)}
                    />
                    <p className={styles.hint}>{t('每一行由 AI 判斷。常用的標準可以在「範本」存起來重複使用。')}</p>
                </React.Fragment>
            )}
            {template && choice !== FREE_TEXT && teacher && (
                <ul className={styles.summary}>
                    {template.items.map(item => <li key={item.id}>{t('{0}（{1}，{2} 分）', [item.desc, {rule: t('規則'), test: t('測試')}[item.type] || 'AI', item.points])}</li>)}
                </ul>
            )}
            <div className={styles.row} style={{marginTop: '0.5rem'}}>
                <button
                    className={styles.button}
                    disabled={busy || !template || template.items.length === 0}
                    onClick={run}
                >{busy ? t('檢查中…') : t('開始檢查')}</button>
                {result && teacher && (
                    <button
                        className={classNames(styles.button, styles.buttonSecondary)}
                        onClick={exportReport}
                    >{t('下載報告')}</button>
                )}
            </div>
            {busy && <div className={styles.status}><div className={styles.spinner} />{t('AI 正在看你的程式…')}</div>}
            {error && <div className={classNames(styles.message, styles.messageError)}>{error}</div>}
            {result && (
                <ResultView
                    result={result}
                    services={services}
                    teacher={teacher}
                />
            )}
        </div>
    );
};

GradeTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default GradeTab;
