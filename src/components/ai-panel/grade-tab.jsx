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

const FREE_TEXT = '__free__';

/** Each non-empty line of free text becomes one AI-judged item. */
const templateFromText = text => {
    const lines = text.split('\n').map(l => l.replace(/^\s*[-*\d.、)）]+\s*/, '').trim())
        .filter(Boolean);
    const points = lines.length ? Math.round(100 / lines.length) : 0;
    return normalizeTemplate({
        title: '自訂標準',
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
                        `${result.overallPass ? '通過' : '未通過'}（${result.passedCount}/${result.itemCount}）` :
                        `${result.total}/${result.max} 分`}
                </strong>
            </div>
            {shown.items.length === 0 ? (
                <p className={styles.hint}>{`通過 ${result.passedCount}/${result.itemCount} 項`}</p>
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
                                    {item.evidence && item.evidence.length > 0 && (
                                        <div className={styles.chips}>
                                            {item.evidence.slice(0, 5).map((e, i) => (
                                                <button
                                                    key={i}
                                                    className={styles.chip}
                                                    onClick={() => services.highlightBlock(e.target, e.blockId)}
                                                >{`${e.target} ${e.alias || '積木'}`}</button>
                                            ))}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            {shown.summary && <div className={classNames(styles.message, styles.messageAi)}>{shown.summary}</div>}
            {result.model && <div className={styles.meta}>{`AI：${result.model.model}${result.model.downgraded ? '（已降級）' : ''}`}</div>}
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
            .filter(t => t.studentView !== 'hidden') : services.templates);
    const allowFreeText = teacher || !modeState.classConfig;
    const [choice, setChoice] = useState(templates.length ? templates[0].id : FREE_TEXT);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);

    if (!permissions.selfCheck && !teacher) {
        return (
            <div className={styles.body}>
                <div className={classNames(styles.message, styles.messageWarning)}>{'老師已關閉自我檢查功能。'}</div>
            </div>
        );
    }

    const template = choice === FREE_TEXT ? templateFromText(text) : templates.find(t => t.id === choice);

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
                language: services.language
            });
            setResult(graded);
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy(false);
        }
    };

    const exportReport = () => {
        const title = services.getProjectTitle() || '專案';
        const md = toMarkdown({fileName: `${title}.sb3`, result});
        downloadBlob(`${title}_批改.md`, new Blob([md], {type: 'text/markdown;charset=utf-8'}));
    };

    return (
        <div className={styles.body}>
            <p className={styles.hint}>
                {teacher ? '檢查目前開啟的專案是否符合標準。要一次批改多個檔案請用「批次」。' :
                    '交作業前先檢查看看，你的程式有沒有做到要求。'}
            </p>
            <label className={styles.label}>{'檢查標準'}</label>
            <select
                className={styles.select}
                value={choice}
                onChange={e => setChoice(e.target.value)}
            >
                {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                {allowFreeText && <option value={FREE_TEXT}>{'自由輸入標準…'}</option>}
            </select>
            {choice === FREE_TEXT && (
                <React.Fragment>
                    <textarea
                        className={styles.textarea}
                        value={text}
                        placeholder={'一行一個標準，例如：\n按下綠旗後角色回到中間\n按方向鍵可以移動\n碰到蘋果分數加 1'}
                        onChange={e => setText(e.target.value)}
                    />
                    <p className={styles.hint}>{'每一行由 AI 判斷。常用的標準可以在「範本」存起來重複使用。'}</p>
                </React.Fragment>
            )}
            {template && choice !== FREE_TEXT && teacher && (
                <ul className={styles.summary}>
                    {template.items.map(item => <li key={item.id}>{`${item.desc}（${item.type === 'rule' ? '規則' : 'AI'}，${item.points} 分）`}</li>)}
                </ul>
            )}
            <div className={styles.row} style={{marginTop: '0.5rem'}}>
                <button
                    className={styles.button}
                    disabled={busy || !template || template.items.length === 0}
                    onClick={run}
                >{busy ? '檢查中…' : '開始檢查'}</button>
                {result && teacher && (
                    <button
                        className={classNames(styles.button, styles.buttonSecondary)}
                        onClick={exportReport}
                    >{'下載報告'}</button>
                )}
            </div>
            {busy && <div className={styles.status}><div className={styles.spinner} />{'AI 正在看你的程式…'}</div>}
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
