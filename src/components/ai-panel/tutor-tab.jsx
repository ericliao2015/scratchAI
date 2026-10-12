import PropTypes from 'prop-types';
import React, {useEffect, useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {askTutor} from '../../ai/tutor.js';
import {describeError} from './errors.js';
import {t} from './i18n.js';
import BlocksPreview from './blocks-preview.jsx';

const TASK_LABELS = {
    ask: '問題',
    hint1: '提示 1：想法',
    hint2: '提示 2：用哪些積木',
    hint3: '提示 3：程式骨架',
    explain: '解釋這段程式',
    debug: '為什麼不會動？'
};

const TutorTab = ({services}) => {
    const [goal, setGoal] = useState('');
    const [hintLevel, setHintLevel] = useState(0);
    const [question, setQuestion] = useState('');
    const [messages, setMessages] = useState([]);
    const [busy, setBusy] = useState(false);

    const add = message => setMessages(list => [...list, {id: `${Date.now()}-${Math.random()}`, ...message}]);

    const run = async (task, {blockId = null, text = '', runReport = ''} = {}) => {
        const catalog = services.getCatalog();
        if (!catalog) {
            add({kind: 'error', text: t('編輯器還沒準備好，請稍候再試。')});
            return;
        }
        add({kind: 'user', task, text});
        setBusy(true);
        try {
            const answer = await askTutor({
                client: services.client,
                vm: services.vm,
                catalog,
                task,
                goal,
                question: task === 'ask' ? text : '',
                blockId,
                runReport,
                promptOptions: {level: services.settings.level || 'simple', language: services.language}
            });
            add({kind: 'tutor', answer});
        } catch (e) {
            add({kind: 'error', text: describeError(e)});
        } finally {
            setBusy(false);
        }
    };

    // Requests from the block context menu ("explain this", "why doesn't this work").
    const request = services.tutorRequest;
    useEffect(() => {
        if (!request) return;
        services.clearTutorRequest();
        run(request.task, {blockId: request.blockId, runReport: request.runReport || ''});
    }, [request && request.id]);

    if (!services.permissions.tutor) {
        return (
            <div className={styles.body}>
                <div className={classNames(styles.message, styles.messageWarning)}>
                    {services.permissions.exam ? t('考試模式：AI 家教已關閉。') : t('老師已關閉 AI 家教功能。')}
                </div>
            </div>
        );
    }

    const nextHint = () => {
        const level = Math.min(hintLevel + 1, 3);
        setHintLevel(level);
        run(`hint${level}`, {text: goal});
    };

    return (
        <div className={styles.body}>
            <p className={styles.hint}>
                {t('AI 家教不會直接幫你寫程式，而是給提示、解釋和反問，讓你自己完成。在積木上按右鍵也可以請 AI 解釋或找錯。')}
            </p>
            <label className={styles.label}>{t('你想做什麼？')}</label>
            <div className={styles.row}>
                <input
                    className={classNames(styles.input, styles.grow)}
                    value={goal}
                    placeholder={t('例如：讓角色碰到邊緣就反彈')}
                    onChange={e => {
                        setGoal(e.target.value);
                        setHintLevel(0);
                    }}
                />
                <button
                    className={styles.button}
                    disabled={busy || !goal.trim() || hintLevel >= 3}
                    onClick={nextHint}
                >{hintLevel === 0 ? t('給我提示') :
                        (hintLevel >= 3 ? t('提示已用完') : t('再多一點提示（{0}/3）', [hintLevel + 1]))}</button>
            </div>

            {messages.map(message => {
                if (message.kind === 'user') {
                    return (
                        <div key={message.id} className={classNames(styles.message, styles.messageUser)}>
                            <strong>{t(TASK_LABELS[message.task] || '問題')}</strong>
                            {message.text ? `：${message.text}` : ''}
                        </div>
                    );
                }
                if (message.kind === 'error') {
                    return <div key={message.id} className={classNames(styles.message, styles.messageError)}>{message.text}</div>;
                }
                const {answer} = message;
                return (
                    <div key={message.id} className={classNames(styles.message, styles.messageAi)}>
                        {answer.focus && (
                            <details>
                                <summary>{t('你問的程式（{0}）', [answer.focus.targetName])}</summary>
                                <pre className={styles.code}>{answer.focus.text}</pre>
                            </details>
                        )}
                        <div>{answer.message}</div>
                        {answer.question && <div className={styles.tutorQuestion}>{`💭 ${answer.question}`}</div>}
                        {answer.skeleton && (
                            <React.Fragment>
                                <div className={styles.meta}>{t('程式骨架（缺少的部分要自己補上）：')}</div>
                                <BlocksPreview
                                    vm={services.vm}
                                    scripts={answer.skeleton}
                                    height={180}
                                />
                            </React.Fragment>
                        )}
                        {answer.missing.length > 0 && (
                            <ul className={styles.summary}>
                                {answer.missing.map((m, i) => <li key={i}>{t('待完成：{0}', [m])}</li>)}
                            </ul>
                        )}
                        {answer.concepts.length > 0 && (
                            <div className={styles.chips}>
                                {answer.concepts.map(c => <span key={c} className={styles.chip}>{c}</span>)}
                            </div>
                        )}
                    </div>
                );
            })}

            {busy && <div className={styles.status}><div className={styles.spinner} />{t('AI 家教思考中…')}</div>}

            <div className={styles.section}>
                <textarea
                    className={styles.textarea}
                    value={question}
                    disabled={busy}
                    placeholder={t('有什麼不懂的？例如：「重複無限次」和「重複 10 次」有什麼不同？')}
                    onChange={e => setQuestion(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && question.trim()) {
                            run('ask', {text: question.trim()});
                            setQuestion('');
                        }
                    }}
                />
                <div className={styles.row}>
                    <span className={styles.grow} />
                    {messages.length > 0 && (
                        <button
                            className={classNames(styles.button, styles.buttonSecondary)}
                            disabled={busy}
                            onClick={() => {
                                setMessages([]);
                                setHintLevel(0);
                            }}
                        >{t('新對話')}</button>
                    )}
                    <button
                        className={styles.button}
                        disabled={busy || !question.trim()}
                        onClick={() => {
                            run('ask', {text: question.trim()});
                            setQuestion('');
                        }}
                    >{t('問 AI 家教')}</button>
                </div>
            </div>
        </div>
    );
};

TutorTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default TutorTab;
