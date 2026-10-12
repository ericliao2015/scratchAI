import PropTypes from 'prop-types';
import React, {useRef, useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {applyGenerated, generate, restoreSnapshot, summarizeProgram} from '../../ai/generate.js';
import {describeError} from './errors.js';
import {t} from './i18n.js';
import BlocksPreview from './blocks-preview.jsx';

const EXAMPLES = [
    '讓角色用方向鍵上下左右移動',
    '做一個接蘋果遊戲：蘋果從上面掉下來，接到加 1 分',
    '角色一直走，碰到邊緣就反彈',
    '按空白鍵讓角色跳起來',
    '加一個計時器，30 秒後遊戲結束'
];

const Summary = ({summary}) => (
    <ul className={styles.summary}>
        {summary.newSprites.length > 0 && <li>{t('新增角色：{0}', [summary.newSprites.join(t('、'))])}</li>}
        {summary.changedSprites.length > 0 && <li>{t('修改角色：{0}', [summary.changedSprites.join(t('、'))])}</li>}
        {summary.scripts > 0 && <li>{t('新增 {0} 段腳本（共 {1} 個積木）', [summary.scripts, summary.blocks])}</li>}
        {summary.variables.length > 0 && <li>{t('新增變數／清單：{0}', [summary.variables.join(t('、'))])}</li>}
        {summary.broadcasts.length > 0 && <li>{t('新增廣播：{0}', [summary.broadcasts.join(t('、'))])}</li>}
        {summary.costumes > 0 && <li>{t('新增 {0} 個造型／背景', [summary.costumes])}</li>}
        {summary.sounds > 0 && <li>{t('新增 {0} 個音效', [summary.sounds])}</li>}
        {summary.ops > 0 && <li>{t('修改既有積木 {0} 處', [summary.ops])}</li>}
    </ul>
);
Summary.propTypes = {summary: PropTypes.object.isRequired};

const GenerateTab = ({services}) => {
    const [request, setRequest] = useState('');
    const [messages, setMessages] = useState([]);
    const [history, setHistory] = useState([]);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [autoClean, setAutoClean] = useState(true);
    const abortRef = useRef(null);

    const add = message => setMessages(list => [...list, {id: `${Date.now()}-${Math.random()}`, ...message}]);
    const update = (id, patch) => setMessages(list => list.map(m => (m.id === id ? {...m, ...patch} : m)));

    const send = async text => {
        const prompt = (typeof text === 'undefined' ? request : text).trim();
        if (!prompt || busy) return;
        const catalog = services.getCatalog();
        if (!catalog) {
            add({kind: 'error', text: t('編輯器還沒準備好，請稍候再試。')});
            return;
        }
        setRequest('');
        add({kind: 'user', text: prompt});
        setBusy(true);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const libraries = await services.getLibraries();
            const result = await generate({
                client: services.client,
                vm: services.vm,
                catalog,
                request: prompt,
                history,
                promptOptions: {
                    spriteLibrary: libraries.sprites.map(s => s.name),
                    backdropLibrary: libraries.backdrops.map(b => b.name),
                    soundLibrary: (libraries.sounds || []).map(s => s.name),
                    imageGeneration: services.canGenerateImages(),
                    level: services.settings.level || 'simple',
                    language: services.language,
                    strategy: services.settings.strategy
                },
                onStatus: (key, args) => setStatus(t(key, args)),
                signal: controller.signal
            });
            setHistory(result.history);
            if (result.type === 'question') {
                add({kind: 'question', text: result.question, options: result.options, meta: result});
            } else {
                add({kind: 'program', result, summary: summarizeProgram(result), state: 'pending'});
            }
        } catch (e) {
            add({kind: 'error', text: describeError(e), details: e.details});
        } finally {
            setBusy(false);
            setStatus('');
            abortRef.current = null;
        }
    };

    const apply = async message => {
        setBusy(true);
        try {
            const libraries = await services.getLibraries();
            const applied = await applyGenerated({
                vm: services.vm,
                catalog: services.getCatalog(),
                result: message.result,
                libraries,
                generateImage: services.canGenerateImages() ? services.generateImage : null,
                onStatus: (key, args) => setStatus(t(key, args))
            });
            update(message.id, {state: 'applied', applied});
            // Edits made through the editor are already placed; cleaning up would add a second undo step.
            if (autoClean && !applied.summary.undoable) services.cleanUpWorkspace();
            // Later requests should see the new project state, not the old conversation.
            setHistory([]);
        } catch (e) {
            update(message.id, {state: 'failed', error: describeError(e)});
        } finally {
            setBusy(false);
            setStatus('');
        }
    };

    const undo = async message => {
        setBusy(true);
        try {
            await restoreSnapshot(services.vm, message.applied.snapshot);
            update(message.id, {state: 'undone'});
        } catch (e) {
            add({kind: 'error', text: t('復原失敗：{0}', [e.message])});
        } finally {
            setBusy(false);
        }
    };

    const reset = () => {
        setMessages([]);
        setHistory([]);
    };

    if (!services.permissions.generate) {
        return (
            <div className={styles.body}>
                <div className={classNames(styles.message, styles.messageWarning)}>
                    {services.permissions.exam ? t('考試模式：AI 產生積木已關閉。') : t('老師已關閉 AI 產生積木功能。')}
                </div>
            </div>
        );
    }

    return (
        <div className={styles.body}>
            {messages.length === 0 && (
                <div className={styles.section}>
                    <p className={styles.hint}>
                        {t('用一句話描述你想做的程式，AI 會幫你產生積木並放進專案。可以說「讓…」「做一個…」「修改…」。')}
                    </p>
                    <div className={styles.chips}>
                        {EXAMPLES.map(example => (
                            <button
                                key={example}
                                className={styles.chip}
                                onClick={() => setRequest(t(example))}
                            >{t(example)}</button>
                        ))}
                    </div>
                </div>
            )}

            {messages.map(message => {
                if (message.kind === 'user') {
                    return <div key={message.id} className={classNames(styles.message, styles.messageUser)}>{message.text}</div>;
                }
                if (message.kind === 'error') {
                    return (
                        <div key={message.id} className={classNames(styles.message, styles.messageError)}>
                            {message.text}
                            {message.details && (
                                <details>
                                    <summary>{t('錯誤細節')}</summary>
                                    <ul>{message.details.slice(0, 10).map((d, i) => <li key={i}>{`${d.path} ${d.message}`}</li>)}</ul>
                                </details>
                            )}
                        </div>
                    );
                }
                if (message.kind === 'question') {
                    return (
                        <div key={message.id} className={classNames(styles.message, styles.messageAi)}>
                            {message.text}
                            {message.options.length > 0 && (
                                <div className={styles.chips}>
                                    {message.options.map(option => (
                                        <button
                                            key={option}
                                            className={styles.chip}
                                            disabled={busy}
                                            onClick={() => send(option)}
                                        >{option}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                }
                const {result, summary} = message;
                return (
                    <div key={message.id} className={classNames(styles.message, styles.messageAi)}>
                        {result.explanation && <div>{result.explanation}</div>}
                        <Summary summary={summary} />
                        {message.state === 'pending' && (
                            <BlocksPreview
                                vm={services.vm}
                                scripts={result.plan.scripts}
                            />
                        )}
                        {result.warnings.length > 0 && (
                            <div className={classNames(styles.message, styles.messageWarning)}>
                                {result.warnings.join('\n')}
                            </div>
                        )}
                        <div className={styles.meta}>
                            {`${result.model}${result.downgraded ? t('（已自動降級）') : ''} · ` +
                                `${result.usage.inputTokens + result.usage.outputTokens} tokens` +
                                (result.usage.cachedTokens ? t('（快取 {0}）', [result.usage.cachedTokens]) : '')}
                        </div>
                        {message.state === 'pending' && (
                            <div className={styles.row}>
                                <button
                                    className={styles.button}
                                    disabled={busy}
                                    onClick={() => apply(message)}
                                >{t('套用到專案')}</button>
                                <button
                                    className={classNames(styles.button, styles.buttonSecondary)}
                                    disabled={busy}
                                    onClick={() => update(message.id, {state: 'discarded'})}
                                >{t('捨棄')}</button>
                            </div>
                        )}
                        {message.state === 'applied' && (
                            <React.Fragment>
                                <div className={styles.pass}>{t('✓ 已套用')}</div>
                                {message.applied.opErrors.length > 0 && (
                                    <div className={classNames(styles.message, styles.messageWarning)}>
                                        {t('有 {0} 個修改沒有完成：\n', [message.applied.opErrors.length]) +
                                            message.applied.opErrors.map(e => e.message).join('\n')}
                                    </div>
                                )}
                                {message.applied.warnings.length > 0 && (
                                    <div className={classNames(styles.message, styles.messageWarning)}>
                                        {message.applied.warnings.join('\n')}
                                    </div>
                                )}
                                <div className={styles.row}>
                                    <button
                                        className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                                        disabled={busy}
                                        onClick={() => undo(message)}
                                    >{t('復原這次變更')}</button>
                                    <button
                                        className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                                        onClick={() => services.cleanUpWorkspace()}
                                    >{t('整理積木')}</button>
                                </div>
                                {message.applied.summary.undoable && (
                                    <div className={styles.hint}>{t('也可以按 Ctrl+Z 復原。')}</div>
                                )}
                            </React.Fragment>
                        )}
                        {message.state === 'undone' && <div className={styles.meta}>{t('已復原')}</div>}
                        {message.state === 'discarded' && <div className={styles.meta}>{t('已捨棄')}</div>}
                        {message.state === 'failed' && <div className={styles.fail}>{message.error}</div>}
                    </div>
                );
            })}

            {busy && (
                <div className={styles.status}>
                    <div className={styles.spinner} />
                    <span className={styles.grow}>{status || t('處理中…')}</span>
                    {abortRef.current && (
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            onClick={() => abortRef.current && abortRef.current.abort()}
                        >{t('取消')}</button>
                    )}
                </div>
            )}

            <div className={styles.section}>
                <textarea
                    className={styles.textarea}
                    placeholder={t('例如：讓貓咪按方向鍵移動，碰到蘋果就說「好吃！」')}
                    value={request}
                    disabled={busy}
                    onChange={e => setRequest(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
                    }}
                />
                <div className={styles.row}>
                    <label className={classNames(styles.checkbox, styles.grow)}>
                        <input
                            type="checkbox"
                            checked={autoClean}
                            onChange={e => setAutoClean(e.target.checked)}
                        />
                        {t('套用後自動整理積木')}
                    </label>
                    {messages.length > 0 && (
                        <button
                            className={classNames(styles.button, styles.buttonSecondary)}
                            disabled={busy}
                            onClick={reset}
                        >{t('新對話')}</button>
                    )}
                    <button
                        className={styles.button}
                        disabled={busy || !request.trim()}
                        onClick={() => send()}
                    >{t('送出')}</button>
                </div>
                <p className={styles.hint}>{t('Ctrl + Enter 送出。套用前會先顯示 AI 打算做的變更。')}</p>
            </div>
        </div>
    );
};

GenerateTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default GenerateTab;
