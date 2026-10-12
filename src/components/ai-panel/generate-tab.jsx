import PropTypes from 'prop-types';
import React, {useRef, useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {applyGenerated, generate, restoreSnapshot, summarizeProgram} from '../../ai/generate.js';
import {describeError} from './errors.js';

const EXAMPLES = [
    '讓角色用方向鍵上下左右移動',
    '做一個接蘋果遊戲：蘋果從上面掉下來，接到加 1 分',
    '角色一直走，碰到邊緣就反彈',
    '按空白鍵讓角色跳起來',
    '加一個計時器，30 秒後遊戲結束'
];

const Summary = ({summary}) => (
    <ul className={styles.summary}>
        {summary.newSprites.length > 0 && <li>{`新增角色：${summary.newSprites.join('、')}`}</li>}
        {summary.changedSprites.length > 0 && <li>{`修改角色：${summary.changedSprites.join('、')}`}</li>}
        {summary.scripts > 0 && <li>{`新增 ${summary.scripts} 段腳本（共 ${summary.blocks} 個積木）`}</li>}
        {summary.variables.length > 0 && <li>{`新增變數／清單：${summary.variables.join('、')}`}</li>}
        {summary.broadcasts.length > 0 && <li>{`新增廣播：${summary.broadcasts.join('、')}`}</li>}
        {summary.costumes > 0 && <li>{`新增 ${summary.costumes} 個造型／背景`}</li>}
        {summary.ops > 0 && <li>{`修改既有積木 ${summary.ops} 處`}</li>}
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
        const prompt = (text === undefined ? request : text).trim();
        if (!prompt || busy) return;
        const catalog = services.getCatalog();
        if (!catalog) {
            add({kind: 'error', text: '編輯器還沒準備好，請稍候再試。'});
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
                    imageGeneration: services.canGenerateImages(),
                    level: services.settings.level || 'simple',
                    language: services.language,
                    strategy: services.settings.strategy
                },
                onStatus: setStatus,
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
                onStatus: setStatus
            });
            update(message.id, {state: 'applied', applied});
            if (autoClean) services.cleanUpWorkspace();
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
            add({kind: 'error', text: `復原失敗：${e.message}`});
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
                    {services.permissions.exam ? '考試模式：AI 產生積木已關閉。' : '老師已關閉 AI 產生積木功能。'}
                </div>
            </div>
        );
    }

    return (
        <div className={styles.body}>
            {messages.length === 0 && (
                <div className={styles.section}>
                    <p className={styles.hint}>
                        {'用一句話描述你想做的程式，AI 會幫你產生積木並放進專案。可以說「讓…」「做一個…」「修改…」。'}
                    </p>
                    <div className={styles.chips}>
                        {EXAMPLES.map(example => (
                            <button
                                key={example}
                                className={styles.chip}
                                onClick={() => setRequest(example)}
                            >{example}</button>
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
                                    <summary>{'錯誤細節'}</summary>
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
                        {result.warnings.length > 0 && (
                            <div className={classNames(styles.message, styles.messageWarning)}>
                                {result.warnings.join('\n')}
                            </div>
                        )}
                        <div className={styles.meta}>
                            {`${result.model}${result.downgraded ? '（已自動降級）' : ''} · ` +
                                `${result.usage.inputTokens + result.usage.outputTokens} tokens`}
                        </div>
                        {message.state === 'pending' && (
                            <div className={styles.row}>
                                <button
                                    className={styles.button}
                                    disabled={busy}
                                    onClick={() => apply(message)}
                                >{'套用到專案'}</button>
                                <button
                                    className={classNames(styles.button, styles.buttonSecondary)}
                                    disabled={busy}
                                    onClick={() => update(message.id, {state: 'discarded'})}
                                >{'捨棄'}</button>
                            </div>
                        )}
                        {message.state === 'applied' && (
                            <React.Fragment>
                                <div className={styles.pass}>{'✓ 已套用'}</div>
                                {message.applied.opErrors.length > 0 && (
                                    <div className={classNames(styles.message, styles.messageWarning)}>
                                        {`有 ${message.applied.opErrors.length} 個修改沒有完成：\n` +
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
                                    >{'復原這次變更'}</button>
                                    <button
                                        className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                                        onClick={() => services.cleanUpWorkspace()}
                                    >{'整理積木'}</button>
                                </div>
                            </React.Fragment>
                        )}
                        {message.state === 'undone' && <div className={styles.meta}>{'已復原'}</div>}
                        {message.state === 'discarded' && <div className={styles.meta}>{'已捨棄'}</div>}
                        {message.state === 'failed' && <div className={styles.fail}>{message.error}</div>}
                    </div>
                );
            })}

            {busy && (
                <div className={styles.status}>
                    <div className={styles.spinner} />
                    <span className={styles.grow}>{status || '處理中…'}</span>
                    {abortRef.current && (
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            onClick={() => abortRef.current && abortRef.current.abort()}
                        >{'取消'}</button>
                    )}
                </div>
            )}

            <div className={styles.section}>
                <textarea
                    className={styles.textarea}
                    placeholder={'例如：讓貓咪按方向鍵移動，碰到蘋果就說「好吃！」'}
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
                        {'套用後自動整理積木'}
                    </label>
                    {messages.length > 0 && (
                        <button
                            className={classNames(styles.button, styles.buttonSecondary)}
                            disabled={busy}
                            onClick={reset}
                        >{'新對話'}</button>
                    )}
                    <button
                        className={styles.button}
                        disabled={busy || !request.trim()}
                        onClick={() => send()}
                    >{'送出'}</button>
                </div>
                <p className={styles.hint}>{'Ctrl + Enter 送出。套用前會先顯示 AI 打算做的變更。'}</p>
            </div>
        </div>
    );
};

GenerateTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default GenerateTab;
