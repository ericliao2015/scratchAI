import PropTypes from 'prop-types';
import React, {useRef, useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {batchGrade, batchModify, buildModifyZip, modifyZipName, prepareUnifiedAnswer, readProjectFiles} from '../../ai/batch.js';
import {buildReportZip, parseFileName, reportFileName} from '../../ai/grade/report.js';
import {summarizeProgram} from '../../ai/generate.js';
import {describeError} from './errors.js';
import downloadBlob from '../../lib/download-blob.js';
import {t} from './i18n.js';

const Progress = ({done, total}) => (
    <div className={styles.progress}>
        <div
            className={styles.progressBar}
            style={{width: `${total ? Math.round((done / total) * 100) : 0}%`}}
        />
    </div>
);
Progress.propTypes = {done: PropTypes.number, total: PropTypes.number};

const BatchTab = ({services}) => {
    const {templates, settings} = services;
    const [task, setTask] = useState('grade');
    const [projects, setProjects] = useState([]);
    const [templateId, setTemplateId] = useState(templates.length ? templates[0].id : '');
    const [pauseOnFallback, setPauseOnFallback] = useState(settings.pauseBatchOnFallback !== false);
    const [entries, setEntries] = useState([]);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [paused, setPaused] = useState(false);
    const [instruction, setInstruction] = useState('');
    const [modifyMode, setModifyMode] = useState('unified');
    const [preview, setPreview] = useState(null);
    const [modified, setModified] = useState([]);
    const abortRef = useRef(null);

    const template = templates.find(tpl => tpl.id === templateId);

    const pickFiles = async e => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        setError('');
        try {
            const read = await readProjectFiles(files);
            setProjects(read);
            setEntries([]);
            setModified([]);
            setPreview(null);
            if (read.length === 0) setError(t('沒有找到 .sb3 檔案。'));
        } catch (err) {
            setError(t('讀取檔案失敗：{0}', [err.message]));
        }
    };

    const grade = async ({continuing = false, list = projects} = {}) => {
        if (!template) return;
        setBusy(true);
        setPaused(false);
        setError('');
        const controller = new AbortController();
        abortRef.current = controller;
        const done = continuing ? entries.filter(e => e.result) : [];
        const remaining = list.filter(p => !done.some(e => e.fileName === p.fileName));
        if (!continuing) setEntries([]);
        try {
            const results = await batchGrade({
                projects: remaining,
                template,
                client: services.hasTextModel() ? services.client : null,
                catalog: services.getCatalog(),
                language: services.language,
                storage: services.vm.runtime.storage,
                signal: controller.signal,
                onBeforeFallback: pauseOnFallback && !continuing ? () => false : () => true,
                onResult: entry => setEntries(current => [...current.filter(e => e.fileName !== entry.fileName), entry])
            });
            if (results.some(e => e.paused)) {
                setPaused(true);
                setError(t('模型額度用完，需要改用較低階的模型。為了讓同一批作業用同一個模型批改，已暫停。'));
            }
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy(false);
            abortRef.current = null;
        }
    };

    const downloadReports = async () => {
        const sorted = projects.map(p => entries.find(e => e.fileName === p.fileName)).filter(Boolean);
        const blob = await buildReportZip(sorted, {title: template ? template.title : t('批改結果')});
        downloadBlob(reportFileName(template ? template.title : t('批改結果')), blob);
    };

    const promptOptions = () => ({language: services.language, strategy: settings.strategy, level: 'advanced'});

    const prepare = async () => {
        setBusy(true);
        setError('');
        setPreview(null);
        try {
            const answer = await prepareUnifiedAnswer({
                project: projects[0],
                instruction,
                client: services.client,
                catalog: services.getCatalog(),
                storage: services.vm.runtime.storage,
                promptOptions: promptOptions()
            });
            setPreview(answer);
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy(false);
        }
    };

    const modify = async () => {
        setBusy(true);
        setError('');
        setModified([]);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const libraries = await services.getLibraries();
            await batchModify({
                projects,
                mode: modifyMode,
                instruction,
                client: services.client,
                catalog: services.getCatalog(),
                storage: services.vm.runtime.storage,
                libraries,
                promptOptions: promptOptions(),
                preparedAnswer: modifyMode === 'unified' ? preview : null,
                signal: controller.signal,
                onStatus: (key, args) => setStatus(t(key, args)),
                onResult: entry => setModified(current => [...current, entry])
            });
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy(false);
            setStatus('');
            abortRef.current = null;
        }
    };

    const gradeModified = () => {
        const list = modified.filter(e => e.data).map(e => ({fileName: e.fileName, data: e.data.buffer}));
        setProjects(list);
        setTask('grade');
        grade({list});
    };

    const gradedCount = entries.length;

    return (
        <div className={styles.body}>
            <div className={styles.tabs} style={{marginBottom: '0.75rem'}}>
                {[['grade', t('批次批改')], ['modify', t('批次修改')]].map(([id, label]) => (
                    <button
                        key={id}
                        className={classNames(styles.tab, task === id && styles.tabSelected)}
                        onClick={() => setTask(id)}
                    >{label}</button>
                ))}
            </div>

            <div className={styles.section}>
                <label className={classNames(styles.button, styles.buttonSecondary)}>
                    {t('選擇作業檔案（.sb3 或 .zip）')}
                    <input
                        type="file"
                        multiple
                        accept=".sb3,.zip"
                        style={{display: 'none'}}
                        onChange={pickFiles}
                    />
                </label>
                <p className={styles.hint}>
                    {projects.length ? t('已選擇 {0} 份作業。', [projects.length]) : t('可一次選多個檔案，或整個壓縮檔。')}
                    {t('建議檔名格式：座號_姓名.sb3。送給 AI 的內容不含檔名與姓名。')}
                </p>
            </div>

            {task === 'grade' && (
                <div className={styles.section}>
                    <label className={styles.label}>{t('範本')}</label>
                    {templates.length === 0 ? (
                        <p className={styles.hint}>{t('請先到「範本」建立批改範本。')}</p>
                    ) : (
                        <select
                            className={styles.select}
                            value={templateId}
                            onChange={e => setTemplateId(e.target.value)}
                        >
                            {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.title}</option>)}
                        </select>
                    )}
                    <label className={styles.checkbox}>
                        <input
                            type="checkbox"
                            checked={pauseOnFallback}
                            onChange={e => {
                                setPauseOnFallback(e.target.checked);
                                services.updateSettings({...settings, pauseBatchOnFallback: e.target.checked});
                            }}
                        />
                        {t('模型需要降級時先暫停（讓同一批作業用同一個模型批改）')}
                    </label>
                    {template && template.items.some(i => i.type === 'ai') && (
                        <p className={styles.hint}>{t('含 AI 項目：每份作業呼叫 AI 一次，共約 {0} 次。', [projects.length])}</p>
                    )}
                    <div className={styles.row}>
                        <button
                            className={styles.button}
                            disabled={busy || !template || projects.length === 0}
                            onClick={() => grade()}
                        >{t('開始批改')}</button>
                        {paused && (
                            <button
                                className={styles.button}
                                disabled={busy}
                                onClick={() => grade({continuing: true})}
                            >{t('改用較低階模型繼續')}</button>
                        )}
                        {busy && (
                            <button
                                className={classNames(styles.button, styles.buttonSecondary)}
                                onClick={() => abortRef.current && abortRef.current.abort()}
                            >{t('停止')}</button>
                        )}
                        {gradedCount > 0 && !busy && (
                            <button
                                className={classNames(styles.button, styles.buttonSecondary)}
                                onClick={downloadReports}
                            >{t('下載報告（zip）')}</button>
                        )}
                    </div>
                    {(busy || gradedCount > 0) && <Progress done={gradedCount} total={projects.length} />}
                    {gradedCount > 0 && (
                        <table className={styles.table}>
                            <thead>
                                <tr><th>{t('作業')}</th><th>{t('結果')}</th></tr>
                            </thead>
                            <tbody>
                                {projects.map(p => {
                                    const entry = entries.find(e => e.fileName === p.fileName);
                                    const {seat, name} = parseFileName(p.fileName);
                                    let cell = '…';
                                    if (entry && entry.error) cell = <span className={styles.fail}>{entry.error}</span>;
                                    else if (entry) {
                                        const r = entry.result;
                                        cell = (
                                            <span className={r.overallPass ? styles.pass : styles.fail}>
                                                {r.template.scoring === 'passfail' ?
                                                    t('{0}（{1}/{2}）', [r.overallPass ? t('通過') : t('未通過'), r.passedCount, r.itemCount]) :
                                                    `${r.total}/${r.max}`}
                                                {r.model && r.model.downgraded ? t(' ⚠降級') : ''}
                                            </span>
                                        );
                                    }
                                    return <tr key={p.fileName}><td>{`${seat ? `${seat} ` : ''}${name}`}</td><td>{cell}</td></tr>;
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {task === 'modify' && (
                <div className={styles.section}>
                    <label className={styles.label}>{t('要怎麼修改？')}</label>
                    <textarea
                        className={styles.textarea}
                        value={instruction}
                        placeholder={t('例如：每份都加入「按空白鍵跳躍」的程式\n或：把變數 score 改名為 分數')}
                        onChange={e => {
                            setInstruction(e.target.value);
                            setPreview(null);
                        }}
                    />
                    <label className={styles.checkbox}>
                        <input
                            type="radio"
                            checked={modifyMode === 'unified'}
                            onChange={() => setModifyMode('unified')}
                        />
                        <span>{t('統一修改：AI 產生一次，套用到每一份（便宜）')}</span>
                    </label>
                    <label className={styles.checkbox}>
                        <input
                            type="radio"
                            checked={modifyMode === 'individual'}
                            onChange={() => {
                                setModifyMode('individual');
                                setPreview(null);
                            }}
                        />
                        <span>{t('個別修改：AI 依每份內容修改（每份呼叫一次，共 {0} 次）', [projects.length])}</span>
                    </label>
                    <div className={styles.row}>
                        {modifyMode === 'unified' && (
                            <button
                                className={classNames(styles.button, preview && styles.buttonSecondary)}
                                disabled={busy || !instruction.trim() || projects.length === 0}
                                onClick={prepare}
                            >{t('先用第一份預覽')}</button>
                        )}
                        <button
                            className={styles.button}
                            disabled={busy || !instruction.trim() || projects.length === 0 || (modifyMode === 'unified' && !preview)}
                            onClick={modify}
                        >{t('套用到全部 {0} 份', [projects.length])}</button>
                    </div>
                    {preview && (
                        <div className={classNames(styles.message, styles.messageAi)}>
                            <div>{preview.explanation || t('AI 的修改方式：')}</div>
                            <ul className={styles.summary}>
                                {(() => {
                                    const s = summarizeProgram(preview);
                                    return [
                                        s.scripts > 0 && <li key="s">{t('新增 {0} 段腳本', [s.scripts])}</li>,
                                        s.ops > 0 && <li key="o">{t('修改既有積木 {0} 處', [s.ops])}</li>,
                                        s.newSprites.length > 0 && <li key="n">{t('新增角色：{0}', [s.newSprites.join(t('、'))])}</li>,
                                        s.variables.length > 0 && <li key="v">{t('新增變數：{0}', [s.variables.join(t('、'))])}</li>
                                    ];
                                })()}
                            </ul>
                            <div className={styles.meta}>{t('以「{0}」為範例產生', [projects[0].fileName])}</div>
                        </div>
                    )}
                    {busy && <div className={styles.status}><div className={styles.spinner} />{status || t('處理中…')}</div>}
                    {modified.length > 0 && (
                        <React.Fragment>
                            <Progress done={modified.length} total={projects.length} />
                            <table className={styles.table}>
                                <tbody>
                                    {modified.map(e => (
                                        <tr key={e.fileName}>
                                            <td>{e.fileName}</td>
                                            <td className={e.error ? styles.fail : styles.pass}>{e.error || t('完成')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!busy && (
                                <div className={styles.row}>
                                    <button
                                        className={styles.button}
                                        onClick={async () => downloadBlob(modifyZipName(), await buildModifyZip(modified))}
                                    >{t('下載修改結果（zip）')}</button>
                                    <button
                                        className={classNames(styles.button, styles.buttonSecondary)}
                                        disabled={!template}
                                        onClick={gradeModified}
                                    >{t('接著批改修改後的檔案')}</button>
                                </div>
                            )}
                            <p className={styles.hint}>{t('原始檔案不會被更動。')}</p>
                        </React.Fragment>
                    )}
                </div>
            )}

            {error && <div className={classNames(styles.message, styles.messageError)}>{error}</div>}
        </div>
    );
};

BatchTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default BatchTab;
