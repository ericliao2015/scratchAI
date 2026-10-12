import PropTypes from 'prop-types';
import React, {useMemo, useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {
    MISSION_KINDS, PRACTICE_PACK_ID, loadProgress, loadSavedPacks, missionTemplate, normalizeMissionPack,
    savePacks, updateProgress
} from '../../ai/missions/pack.js';
import {samplePack} from '../../ai/missions/sample.js';
import {generateMission, startMission} from '../../ai/missions/exercise.js';
import {gradeProject} from '../../ai/grade/grade.js';
import {modelFromVM} from '../../ai/project/model.js';
import {projectDataWithIds, runTest} from '../../ai/run/verify.js';
import {askTutor} from '../../ai/tutor.js';
import {recordUsage} from '../../ai/provenance.js';
import {describeError} from './errors.js';
import downloadBlob from '../../lib/download-blob.js';
import {t} from './i18n.js';

const KIND_BADGE = {build: '自己完成', parsons: '積木排序', bugfix: '找錯誤'};

const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
});

const MissionsTab = ({services}) => {
    const {permissions, modeState} = services;
    const [savedPacks, setSavedPacks] = useState(loadSavedPacks);
    const packs = useMemo(() => {
        const fromClass = (modeState.classConfig && Array.isArray(modeState.classConfig.missionPacks) ?
            modeState.classConfig.missionPacks : [])
            .map(pack => {
                try {
                    return normalizeMissionPack(pack);
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean);
        return [...fromClass, samplePack(services.locale), ...savedPacks];
    }, [modeState.classConfig, savedPacks, services.locale]);

    const [packId, setPackId] = useState(packs.length ? packs[0].id : '');
    const pack = packs.find(p => p.id === packId) || packs[0];
    const [missionId, setMissionId] = useState(null);
    const mission = pack && pack.missions.find(m => m.id === missionId);
    const [progress, setProgress] = useState(loadProgress);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);
    const [shownHints, setShownHints] = useState(0);
    const [aiHints, setAiHints] = useState([]);
    const [topic, setTopic] = useState('');
    const [kind, setKind] = useState('build');

    const packProgress = (pack && progress[pack.id]) || {};
    const record = mission ? (packProgress[mission.id] || {}) : {};
    const doneCount = pack ? pack.missions.filter(m => packProgress[m.id] && packProgress[m.id].done).length : 0;

    const openMission = id => {
        setMissionId(id);
        setResult(null);
        setError('');
        setShownHints(0);
        setAiHints([]);
    };

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

    const start = () => guard(t('準備任務…'), async () => {
        const catalog = services.getCatalog();
        if (!catalog) throw new Error(t('編輯器還沒準備好，請稍候再試。'));
        await startMission({vm: services.vm, catalog, mission});
        setProgress(updateProgress(pack.id, mission.id, r => ({...r, started: true})));
    });

    const check = () => guard(t('檢查中…'), async () => {
        setResult(null);
        const graded = await gradeProject({
            model: modelFromVM(services.vm),
            template: missionTemplate(mission),
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
        const pass = graded.overallPass;
        setProgress(updateProgress(pack.id, mission.id, r => ({
            ...r,
            checks: (r.checks || 0) + 1,
            done: r.done || pass,
            doneAt: r.doneAt || (pass ? new Date().toISOString() : null)
        })));
        if (pass && !record.done) recordUsage(services.vm, {mode: 'mission', prompt: `${pack.title} / ${mission.title}`});
    });

    const nextHint = () => {
        setShownHints(n => n + 1);
        setProgress(updateProgress(pack.id, mission.id, r => ({...r, hints: (r.hints || 0) + 1})));
    };

    const aiHint = () => guard(t('AI 家教思考中…'), async () => {
        const level = Math.min(aiHints.length + 1, 3);
        const answer = await askTutor({
            client: services.client,
            vm: services.vm,
            catalog: services.getCatalog(),
            task: `hint${level}`,
            goal: mission.goal,
            promptOptions: {level: services.settings.level || 'simple', language: services.language}
        });
        setAiHints(list => [...list, answer]);
        setProgress(updateProgress(pack.id, mission.id, r => ({...r, aiHints: (r.aiHints || 0) + 1})));
    });

    const savePracticeMission = newMission => {
        const existing = savedPacks.find(p => p.id === PRACTICE_PACK_ID);
        const practice = existing || normalizeMissionPack({id: PRACTICE_PACK_ID, title: t('我的練習'), missions: []});
        const updated = {...practice, missions: [...practice.missions, newMission]};
        const list = [...savedPacks.filter(p => p.id !== PRACTICE_PACK_ID), updated];
        savePacks(list);
        setSavedPacks(list);
        setPackId(PRACTICE_PACK_ID);
        openMission(newMission.id);
    };

    const makeExercise = () => guard(t('AI 出題中…'), async () => {
        const catalog = services.getCatalog();
        if (!catalog) throw new Error(t('編輯器還沒準備好，請稍候再試。'));
        const newMission = await generateMission({
            client: services.client,
            vm: services.vm,
            catalog,
            topic: topic.trim(),
            kind,
            promptOptions: {level: services.settings.level || 'simple', language: services.language}
        });
        setTopic('');
        savePracticeMission(newMission);
    });

    const importPack = async event => {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        await guard(t('讀取中…'), async () => {
            const imported = normalizeMissionPack(JSON.parse(await readFile(file)));
            const list = [...savedPacks.filter(p => p.id !== imported.id), imported];
            savePacks(list);
            setSavedPacks(list);
            setPackId(imported.id);
            setMissionId(null);
        });
    };

    const removePack = () => {
        const list = savedPacks.filter(p => p.id !== pack.id);
        savePacks(list);
        setSavedPacks(list);
        setPackId(packs[0].id);
        setMissionId(null);
    };

    const canAskAI = permissions.tutor && services.hasTextModel();
    const isSaved = pack && savedPacks.some(p => p.id === pack.id);

    return (
        <div className={styles.body}>
            <p className={styles.hint}>{t('一關一關完成小任務。每個任務都可以按「檢查」，程式會在背景實際執行來確認你有沒有做到。')}</p>
            <div className={styles.row}>
                <select
                    className={classNames(styles.select, styles.grow)}
                    value={pack ? pack.id : ''}
                    onChange={e => {
                        setPackId(e.target.value);
                        setMissionId(null);
                    }}
                >
                    {packs.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                <label className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}>
                    {t('匯入任務包')}
                    <input
                        type="file"
                        accept=".json,application/json"
                        style={{display: 'none'}}
                        onChange={importPack}
                    />
                </label>
            </div>
            {pack && (
                <React.Fragment>
                    {pack.description && <p className={styles.meta}>{pack.description}</p>}
                    <div className={styles.meta}>{t('完成 {0}/{1}', [doneCount, pack.missions.length])}</div>
                    <div className={styles.progressBar}>
                        <div
                            className={styles.progressFill}
                            style={{width: `${pack.missions.length ? (100 * doneCount / pack.missions.length) : 0}%`}}
                        />
                    </div>
                    <ol className={styles.missionList}>
                        {pack.missions.map(m => {
                            const r = packProgress[m.id] || {};
                            return (
                                <li key={m.id}>
                                    <button
                                        className={classNames(styles.missionItem, m.id === missionId && styles.missionActive)}
                                        onClick={() => openMission(m.id)}
                                    >
                                        <span>{r.done ? '✅' : (r.started || r.checks ? '🟡' : '⬜')}</span>
                                        <span className={styles.grow}>{m.title}</span>
                                        <span className={styles.chip}>{t(KIND_BADGE[m.kind])}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ol>
                    {(permissions.teacher || isSaved) && (
                        <div className={styles.row}>
                            <button
                                className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                                onClick={() => downloadBlob(`${pack.title}.json`,
                                    new Blob([JSON.stringify(pack, null, 2)], {type: 'application/json'}))}
                            >{t('匯出任務包')}</button>
                            {isSaved && (
                                <button
                                    className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                                    onClick={removePack}
                                >{t('刪除任務包')}</button>
                            )}
                        </div>
                    )}
                </React.Fragment>
            )}

            {mission && (
                <div className={styles.card}>
                    <h3 className={styles.missionTitle}>{mission.title}</h3>
                    <div className={styles.meta}>{t(MISSION_KINDS[mission.kind])}</div>
                    <p>{mission.goal}</p>
                    {mission.concepts.length > 0 && (
                        <div className={styles.chips}>
                            {mission.concepts.map(c => <span key={c} className={styles.chip}>{c}</span>)}
                        </div>
                    )}
                    <div className={styles.row}>
                        {mission.kind !== 'build' && (
                            <button
                                className={classNames(styles.button, styles.buttonSecondary)}
                                disabled={!!busy}
                                onClick={start}
                            >{mission.kind === 'parsons' ? t('放上打散的積木') : t('放上有問題的程式')}</button>
                        )}
                        <button
                            className={styles.button}
                            disabled={!!busy || mission.checks.length === 0}
                            onClick={check}
                        >{t('檢查')}</button>
                    </div>

                    {mission.hints.slice(0, shownHints).map((hint, i) => (
                        <div
                            key={i}
                            className={classNames(styles.message, styles.messageAi)}
                        >{t('提示 {0}：{1}', [i + 1, hint])}</div>
                    ))}
                    {aiHints.map((answer, i) => (
                        <div
                            key={`ai${i}`}
                            className={classNames(styles.message, styles.messageAi)}
                        >
                            <div>{`🤖 ${answer.message}`}</div>
                            {answer.question && <div className={styles.tutorQuestion}>{`💭 ${answer.question}`}</div>}
                            {answer.missing.length > 0 && (
                                <ul className={styles.summary}>
                                    {answer.missing.map((m, j) => <li key={j}>{t('待完成：{0}', [m])}</li>)}
                                </ul>
                            )}
                        </div>
                    ))}
                    <div className={styles.row}>
                        {shownHints < mission.hints.length && (
                            <button
                                className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                                onClick={nextHint}
                            >{t('看提示（{0}/{1}）', [shownHints + 1, mission.hints.length])}</button>
                        )}
                        {shownHints >= mission.hints.length && canAskAI && aiHints.length < 3 && (
                            <button
                                className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                                disabled={!!busy}
                                onClick={aiHint}
                            >{t('請 AI 家教給提示')}</button>
                        )}
                    </div>

                    {result && (
                        result.overallPass ? (
                            <div className={classNames(styles.message, styles.messagePass)}>
                                {t('🎉 任務完成！')}
                                {pack.missions.indexOf(mission) < pack.missions.length - 1 && (
                                    <button
                                        className={classNames(styles.button, styles.buttonSmall)}
                                        style={{marginLeft: '0.5rem'}}
                                        onClick={() => openMission(pack.missions[pack.missions.indexOf(mission) + 1].id)}
                                    >{t('下一關')}</button>
                                )}
                            </div>
                        ) : (
                            <div className={classNames(styles.message, styles.messageWarning)}>
                                {t('還差一點，再試試看！')}
                            </div>
                        )
                    )}
                    {result && (
                        <ul className={styles.summary}>
                            {result.items.map(item => (
                                <li
                                    key={item.id}
                                    className={item.pass ? styles.pass : styles.fail}
                                >
                                    {`${item.pass ? '✓' : '✗'} ${item.desc}`}
                                    {!item.pass && item.reason && <div className={styles.meta}>{item.reason}</div>}
                                </li>
                            ))}
                        </ul>
                    )}
                    {record.done && !result && <div className={styles.pass}>{t('✅ 已完成過這個任務')}</div>}
                </div>
            )}

            {busy && <div className={styles.status}><div className={styles.spinner} />{busy}</div>}
            {error && <div className={classNames(styles.message, styles.messageError)}>{error}</div>}

            {(canAskAI || (permissions.teacher && services.hasTextModel())) && (
                <div className={styles.section}>
                    <label className={styles.label}>{t('🤖 AI 出題：想練習什麼？')}</label>
                    <div className={styles.row}>
                        <input
                            className={classNames(styles.input, styles.grow)}
                            value={topic}
                            placeholder={t('例如：迴圈、變數計分、廣播')}
                            onChange={e => setTopic(e.target.value)}
                        />
                        <select
                            className={styles.select}
                            style={{width: 'auto'}}
                            value={kind}
                            onChange={e => setKind(e.target.value)}
                        >
                            {Object.keys(MISSION_KINDS).map(k => <option key={k} value={k}>{t(KIND_BADGE[k])}</option>)}
                        </select>
                        <button
                            className={styles.button}
                            disabled={!!busy || !topic.trim()}
                            onClick={makeExercise}
                        >{t('出題')}</button>
                    </div>
                    <p className={styles.hint}>{t('新題目會放在「我的練習」任務包。老師可以匯出任務包，放進班級設定給全班使用。')}</p>
                </div>
            )}
        </div>
    );
};

MissionsTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default MissionsTab;
