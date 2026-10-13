import PropTypes from 'prop-types';
import React, {useEffect, useState} from 'react';
import classNames from 'classnames';
import JSZip from '@turbowarp/jszip';
import styles from './ai-panel.css';
import {gatewayAdmin} from '../../ai/backend/index.js';
import TIERS from '../../ai/providers/model-tiers.json';
import {describeError} from './errors.js';
import downloadBlob from '../../lib/download-blob.js';
import {t} from './i18n.js';

const KEY = 'scratchai:gateway-admin';

const loadConnection = () => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
        const token = window.sessionStorage.getItem(`${KEY}:token`) || saved.token || '';
        return {url: saved.url || '', token, remember: !!saved.token};
    } catch (e) {
        return {url: '', token: '', remember: false};
    }
};

const saveConnection = ({url, token, remember}) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify({url, token: remember ? token : ''}));
        window.sessionStorage.setItem(`${KEY}:token`, token);
    } catch (e) {
        // ignore
    }
};

// Suggested models: the best of each tier for the hosted providers.
const SUGGESTED = ['anthropic', 'openai', 'gemini'].flatMap(provider =>
    ['mid', 'low', 'high'].map(tier => (TIERS[provider][tier] || [])[0])
        .filter(Boolean)
        .map(model => `${provider}/${model}`));

const sumDay = record => (record ? record.inputTokens + record.outputTokens : 0);

const UsageTable = ({usage}) => {
    const names = Object.keys(usage.students).sort((a, b) => a.localeCompare(b, 'zh-Hant', {numeric: true}));
    if (!names.length) return <p className={styles.meta}>{t('還沒有使用紀錄')}</p>;
    const dates = usage.dates.slice().reverse();
    return (
        <div style={{overflowX: 'auto'}}>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th>{t('學生')}</th>
                        {dates.map(d => <th key={d}>{d.slice(5)}</th>)}
                        <th>{t('合計')}</th>
                    </tr>
                </thead>
                <tbody>
                    {names.map(name => {
                        const days = usage.students[name];
                        const total = dates.reduce((n, d) => n + sumDay(days[d]), 0);
                        const requests = dates.reduce((n, d) => n + (days[d] ? days[d].requests : 0), 0);
                        return (
                            <tr key={name}>
                                <td>{name}</td>
                                {dates.map(d => (
                                    <td
                                        key={d}
                                        title={days[d] ? t('{0} 次', [days[d].requests]) : ''}
                                    >{days[d] ? Math.round(sumDay(days[d]) / 1000) : ''}</td>
                                ))}
                                <td>{t('{0}k（{1} 次）', [Math.round(total / 1000), requests])}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <p className={styles.meta}>{t('數字是每天使用的 token（千）。')}</p>
        </div>
    );
};
UsageTable.propTypes = {usage: PropTypes.object.isRequired};

const ClassroomTab = ({services}) => {
    const [connection, setConnection] = useState(loadConnection);
    const [classes, setClasses] = useState(null);
    const [selected, setSelected] = useState(null);
    const [usage, setUsage] = useState(null);
    const [submissions, setSubmissions] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [draft, setDraft] = useState({name: '', models: SUGGESTED.slice(0, 2).join('\n'), requestsPerDay: 100, tokensPerDay: 200000, audioPerDay: 10});

    const admin = gatewayAdmin({baseUrl: connection.url, adminToken: connection.token});
    const klass = classes && classes.find(c => c.code === selected);

    const guard = async (label, work) => {
        setBusy(label);
        setError('');
        try {
            await work();
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy('');
        }
    };

    const connect = () => guard(t('連線中…'), async () => {
        saveConnection(connection);
        setClasses(await admin.listClasses());
    });

    useEffect(() => {
        if (connection.url && connection.token) connect();
    }, []);

    const openClass = code => guard(t('讀取中…'), async () => {
        setSelected(code);
        const [u, s] = await Promise.all([admin.usage(code, 7), admin.listSubmissions(code)]);
        setUsage(u);
        setSubmissions(s);
    });

    const create = () => guard(t('建立中…'), async () => {
        const created = await admin.createClass({
            name: draft.name,
            models: draft.models.split(/\s+/).filter(Boolean),
            limits: {
                requestsPerDay: Number(draft.requestsPerDay) || 0,
                tokensPerDay: Number(draft.tokensPerDay) || 0,
                audioPerDay: Number(draft.audioPerDay) || 0
            }
        });
        setClasses(await admin.listClasses());
        await openClass(created.code);
    });

    const toggleActive = () => guard(t('更新中…'), async () => {
        await admin.updateClass(klass.code, {active: klass.active === false});
        setClasses(await admin.listClasses());
    });

    const fetchAll = async () => {
        const files = [];
        for (const sub of submissions) {
            const full = await admin.getSubmission(klass.code, sub.id);
            files.push({fileName: `${sub.student}_${sub.assignment}_${sub.id.slice(0, 4)}.sb3`, data: full.data, sub});
        }
        return files;
    };

    const downloadAll = () => guard(t('下載中…'), async () => {
        const zip = new JSZip();
        for (const file of await fetchAll()) zip.file(file.fileName, file.data);
        downloadBlob(`${klass.name || klass.code}_submissions.zip`, await zip.generateAsync({type: 'blob'}));
    });

    const gradeAll = () => guard(t('下載中…'), async () => {
        services.sendToBatch((await fetchAll()).map(({fileName, data}) => ({fileName, data})));
    });

    // The class config editor (templates tab) picks up the gateway address and this class code.
    const useInClassConfig = () => {
        try {
            const saved = JSON.parse(window.localStorage.getItem(KEY) || '{}');
            window.localStorage.setItem(KEY, JSON.stringify({...saved, url: connection.url, lastCode: klass.code}));
        } catch (e) {
            // ignore
        }
        services.openTab('templates');
    };

    return (
        <div className={styles.body}>
            <p className={styles.hint}>
                {t('班級閘道是放在學校或雲端的小伺服器（見專案的 server/ 資料夾），由它保管 AI KEY。學生只要輸入班級代碼和座號，你可以設定每日額度、查看用量、收作業。')}
            </p>
            <div className={styles.section}>
                <label className={styles.label}>{t('閘道網址')}</label>
                <input
                    className={styles.input}
                    value={connection.url}
                    placeholder="https://blockai-gateway.example.workers.dev"
                    onChange={e => setConnection({...connection, url: e.target.value.trim()})}
                />
                <label className={styles.label}>{t('管理密碼（ADMIN_TOKEN）')}</label>
                <input
                    className={styles.input}
                    type="password"
                    autoComplete="off"
                    value={connection.token}
                    onChange={e => setConnection({...connection, token: e.target.value.trim()})}
                />
                <div className={styles.row}>
                    <label className={classNames(styles.checkbox, styles.grow)}>
                        <input
                            type="checkbox"
                            checked={connection.remember}
                            onChange={e => setConnection({...connection, remember: e.target.checked})}
                        />
                        {t('在這台電腦記住管理密碼')}
                    </label>
                    <button
                        className={styles.button}
                        disabled={!!busy || !connection.url || !connection.token}
                        onClick={connect}
                    >{t('連線')}</button>
                </div>
            </div>

            {classes && (
                <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>{t('班級')}</h3>
                    {classes.length === 0 && <p className={styles.meta}>{t('還沒有班級')}</p>}
                    <div className={styles.chips}>
                        {classes.map(c => (
                            <button
                                key={c.code}
                                className={classNames(styles.chip, c.code === selected && styles.chipSelected)}
                                onClick={() => openClass(c.code)}
                            >{`${c.name || t('（未命名）')} · ${c.code}${c.active === false ? t('（停用）') : ''}`}</button>
                        ))}
                    </div>
                    <details>
                        <summary>{t('+ 新增班級')}</summary>
                        <label className={styles.label}>{t('班級名稱')}</label>
                        <input
                            className={styles.input}
                            value={draft.name}
                            onChange={e => setDraft({...draft, name: e.target.value})}
                        />
                        <label className={styles.label}>{t('可用模型（一行一個，依序備援；伺服器要有該平台的 KEY）')}</label>
                        <textarea
                            className={classNames(styles.textarea, styles.code)}
                            value={draft.models}
                            onChange={e => setDraft({...draft, models: e.target.value})}
                        />
                        <p className={styles.meta}>{t('建議：{0}', [SUGGESTED.join('、')])}</p>
                        <div className={styles.row}>
                            <span>{t('每人每天次數')}</span>
                            <input
                                className={styles.input}
                                style={{width: '5rem'}}
                                type="number"
                                min="0"
                                value={draft.requestsPerDay}
                                onChange={e => setDraft({...draft, requestsPerDay: e.target.value})}
                            />
                            <span>{t('token')}</span>
                            <input
                                className={styles.input}
                                style={{width: '7rem'}}
                                type="number"
                                min="0"
                                value={draft.tokensPerDay}
                                onChange={e => setDraft({...draft, tokensPerDay: e.target.value})}
                            />
                            <span>{t('AI 聲音')}</span>
                            <input
                                className={styles.input}
                                style={{width: '4rem'}}
                                type="number"
                                min="0"
                                value={draft.audioPerDay}
                                onChange={e => setDraft({...draft, audioPerDay: e.target.value})}
                            />
                        </div>
                        <p className={styles.meta}>{t('0 = 不限')}</p>
                        <button
                            className={styles.button}
                            disabled={!!busy || !draft.name.trim()}
                            onClick={create}
                        >{t('建立班級')}</button>
                    </details>
                </div>
            )}

            {klass && (
                <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>{t('{0}（代碼 {1}）', [klass.name, klass.code])}</h3>
                    <div className={classNames(styles.message, styles.messageAi)}>
                        {t('學生設定：平台選「班級閘道」，網址 {0}，班級代碼 {1}，再輸入自己的座號。', [connection.url, klass.code])}
                    </div>
                    <p className={styles.meta}>
                        {t('模型：{0}', [klass.models.map(m => `${m.provider}/${m.model}`).join(' → ') || t('（無）')])}
                        <br />
                        {t('每人每天：{0} 次、{1} token、AI 聲音 {2} 次', [
                            klass.limits.requestsPerDay || '∞', klass.limits.tokensPerDay || '∞', klass.limits.audioPerDay || '∞'
                        ])}
                    </p>
                    <div className={styles.row}>
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            onClick={useInClassConfig}
                        >{t('放進班級設定檔')}</button>
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            disabled={!!busy}
                            onClick={toggleActive}
                        >{klass.active === false ? t('啟用班級') : t('停用班級')}</button>
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            disabled={!!busy}
                            onClick={() => openClass(klass.code)}
                        >{t('重新整理')}</button>
                    </div>

                    <h3 className={styles.sectionTitle}>{t('近 7 天用量')}</h3>
                    {usage && <UsageTable usage={usage} />}

                    <h3 className={styles.sectionTitle}>{t('繳交的作業（{0}）', [submissions ? submissions.length : 0])}</h3>
                    {submissions && submissions.length > 0 && (
                        <React.Fragment>
                            <table className={styles.table}>
                                <tbody>
                                    {submissions.slice(0, 200).map(sub => (
                                        <tr key={sub.id}>
                                            <td>{sub.student}</td>
                                            <td>{sub.assignment}</td>
                                            <td>{sub.summary && typeof sub.summary.total === 'number' ?
                                                `${sub.summary.total}/${sub.summary.max}` : ''}</td>
                                            <td className={styles.meta}>{new Date(sub.createdAt).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className={styles.row}>
                                <button
                                    className={styles.button}
                                    disabled={!!busy}
                                    onClick={gradeAll}
                                >{t('全部送到批次批改')}</button>
                                <button
                                    className={classNames(styles.button, styles.buttonSecondary)}
                                    disabled={!!busy}
                                    onClick={downloadAll}
                                >{t('全部下載（zip）')}</button>
                            </div>
                        </React.Fragment>
                    )}
                </div>
            )}

            {busy && <div className={styles.status}><div className={styles.spinner} />{busy}</div>}
            {error && <div className={classNames(styles.message, styles.messageError)}>{error}</div>}
        </div>
    );
};

ClassroomTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default ClassroomTab;
