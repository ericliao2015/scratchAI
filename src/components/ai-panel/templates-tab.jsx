import PropTypes from 'prop-types';
import React, {useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {SCORING, STUDENT_VIEWS, emptyTemplate, normalizeTemplate} from '../../ai/grade/template.js';
import {RULE_DESCRIPTIONS} from '../../ai/grade/rules.js';
import {draftTemplate} from '../../ai/grade/grade.js';
import {defaultClassConfig, normalizeClassConfig} from '../../ai/mode.js';
import {PROVIDERS, PROVIDER_ORDER} from '../../ai/providers/index.js';
import {describeError} from './errors.js';
import downloadBlob from '../../lib/download-blob.js';

const readJsonFile = file => file.text().then(text => JSON.parse(text));

const ruleName = check => Object.keys(check || {}).find(key => RULE_DESCRIPTIONS[key]) || 'usesOpcode';

const ruleValueText = check => {
    const name = ruleName(check);
    const value = check ? check[name] : '';
    return typeof value === 'string' ? value : JSON.stringify(value);
};

const parseRuleValue = text => {
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
};

const ItemEditor = ({item, onChange, onRemove}) => (
    <div className={styles.card}>
        <div className={styles.row}>
            <select
                className={styles.select}
                style={{width: 'auto'}}
                value={item.type}
                onChange={e => onChange({...item, type: e.target.value, check: e.target.value === 'rule' ? {usesOpcode: ''} : undefined})}
            >
                <option value="rule">{'規則（程式判斷，免費）'}</option>
                <option value="ai">{'AI 判斷'}</option>
            </select>
            <input
                className={styles.input}
                style={{width: '4.5rem'}}
                type="number"
                value={item.points}
                title="配分"
                onChange={e => onChange({...item, points: Number(e.target.value)})}
            />
            <span>{'分'}</span>
            <button
                className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                onClick={onRemove}
            >{'刪除'}</button>
        </div>
        <input
            className={styles.input}
            style={{marginTop: '0.25rem'}}
            placeholder="這一項的說明（學生會看到）"
            value={item.desc}
            onChange={e => onChange({...item, desc: e.target.value})}
        />
        {item.type === 'rule' && (
            <div className={styles.row} style={{marginTop: '0.25rem'}}>
                <select
                    className={classNames(styles.select, styles.grow)}
                    value={ruleName(item.check)}
                    onChange={e => onChange({...item, check: {[e.target.value]: true}})}
                >
                    {Object.entries(RULE_DESCRIPTIONS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                </select>
                <input
                    className={classNames(styles.input, styles.grow)}
                    placeholder='值，例如 event_whenflagclicked 或 {"min": 2}'
                    value={ruleValueText(item.check)}
                    onChange={e => onChange({...item, check: {...item.check, [ruleName(item.check)]: parseRuleValue(e.target.value)}})}
                />
                <input
                    className={styles.input}
                    style={{width: '6rem'}}
                    placeholder="限定角色"
                    value={(item.check && item.check.sprite) || ''}
                    onChange={e => {
                        const check = {...item.check};
                        if (e.target.value) check.sprite = e.target.value;
                        else delete check.sprite;
                        onChange({...item, check});
                    }}
                />
            </div>
        )}
    </div>
);
ItemEditor.propTypes = {
    item: PropTypes.object.isRequired,
    onChange: PropTypes.func.isRequired,
    onRemove: PropTypes.func.isRequired
};

const ClassConfigEditor = ({services}) => {
    const {templates, modeState} = services;
    const [config, setConfig] = useState(() => ({
        ...defaultClassConfig(),
        ...(modeState.classConfig || {}),
        templates: []
    }));
    const [selected, setSelected] = useState(() => templates.map(t => t.id));

    const exportConfig = () => {
        const data = {
            ...config,
            teacherPinHash: modeState.pinHash || '',
            templates: templates.filter(t => selected.includes(t.id))
        };
        downloadBlob(`class-${config.name || 'config'}.json`, new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
    };

    const applyHere = () => {
        services.setModeState({
            ...modeState,
            classConfig: normalizeClassConfig({
                ...config, teacherPinHash: modeState.pinHash || '', templates: templates.filter(t => selected.includes(t.id))
            })
        });
    };

    const feature = (key, label) => (
        <label className={styles.checkbox}>
            <input
                type="checkbox"
                checked={config.features[key] !== false}
                onChange={e => setConfig({...config, features: {...config.features, [key]: e.target.checked}})}
            />
            {label}
        </label>
    );

    return (
        <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{'班級設定檔'}</h3>
            <p className={styles.hint}>
                {'匯出 class.json 給學生。學生用「設定 → 匯入班級設定」或網址 ?class=設定檔網址 套用。檔案不含任何 KEY；含老師 PIN 的雜湊，學生無法自行切到老師模式。'}
            </p>
            <label className={styles.label}>{'班級名稱'}</label>
            <input
                className={styles.input}
                value={config.name}
                onChange={e => setConfig({...config, name: e.target.value})}
            />
            <label className={styles.checkbox}>
                <input
                    type="checkbox"
                    checked={config.exam}
                    onChange={e => setConfig({...config, exam: e.target.checked})}
                />
                {'考試模式（關閉 AI 產生積木與生圖）'}
            </label>
            {feature('generate', '允許 AI 產生積木')}
            {feature('image', '允許 AI 生圖')}
            {feature('selfCheck', '允許學生自我檢查')}
            <div className={styles.row}>
                <span>{'每人每天生圖上限'}</span>
                <input
                    className={styles.input}
                    style={{width: '5rem'}}
                    type="number"
                    min="0"
                    value={config.imageDailyLimit}
                    onChange={e => setConfig({...config, imageDailyLimit: Number(e.target.value)})}
                />
                <span className={styles.meta}>{'0 = 不限'}</span>
            </div>
            <label className={styles.label}>{'允許的平台（都不勾 = 全部）'}</label>
            {PROVIDER_ORDER.map(id => (
                <label key={id} className={styles.checkbox}>
                    <input
                        type="checkbox"
                        checked={config.providers.includes(id)}
                        onChange={e => setConfig({
                            ...config,
                            providers: e.target.checked ? [...config.providers, id] : config.providers.filter(p => p !== id)
                        })}
                    />
                    {PROVIDERS[id].label}
                </label>
            ))}
            <label className={styles.label}>{'學生預設說明方式'}</label>
            <select
                className={styles.select}
                value={config.level}
                onChange={e => setConfig({...config, level: e.target.value})}
            >
                <option value="simple">{'簡易'}</option>
                <option value="advanced">{'進階'}</option>
            </select>
            <label className={styles.label}>{'包含的範本（學生自我檢查用）'}</label>
            {templates.map(t => (
                <label key={t.id} className={styles.checkbox}>
                    <input
                        type="checkbox"
                        checked={selected.includes(t.id)}
                        onChange={e => setSelected(e.target.checked ? [...selected, t.id] : selected.filter(id => id !== t.id))}
                    />
                    {`${t.title}（學生可見度：${STUDENT_VIEWS[t.studentView]}）`}
                </label>
            ))}
            <div className={styles.row} style={{marginTop: '0.5rem'}}>
                <button
                    className={styles.button}
                    onClick={exportConfig}
                >{'匯出 class.json'}</button>
                <button
                    className={classNames(styles.button, styles.buttonSecondary)}
                    onClick={applyHere}
                >{'套用到這台電腦'}</button>
            </div>
            <p className={styles.hint}>{'注意：設定檔在學生的瀏覽器裡可以被讀取，請不要在範本說明中放標準答案。'}</p>
        </div>
    );
};
ClassConfigEditor.propTypes = {services: PropTypes.object.isRequired};

const TemplatesTab = ({services}) => {
    const {templates, setTemplates} = services;
    const [editing, setEditing] = useState(null);
    const [draftText, setDraftText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const save = template => {
        const normalized = normalizeTemplate(template);
        const exists = templates.some(t => t.id === normalized.id);
        setTemplates(exists ? templates.map(t => (t.id === normalized.id ? normalized : t)) : [...templates, normalized]);
        setEditing(null);
    };

    const draft = async () => {
        setBusy(true);
        setError('');
        try {
            setEditing(await draftTemplate({client: services.client, text: draftText, language: services.language}));
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy(false);
        }
    };

    const importFile = async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
            const json = await readJsonFile(file);
            const list = Array.isArray(json) ? json : (Array.isArray(json.templates) ? json.templates : [json]);
            setTemplates([...templates, ...list.map(normalizeTemplate)]);
        } catch (err) {
            setError(`匯入失敗：${err.message}`);
        }
    };

    if (editing) {
        const total = editing.items.reduce((n, i) => n + (Number(i.points) || 0), 0);
        return (
            <div className={styles.body}>
                <label className={styles.label}>{'範本名稱'}</label>
                <input
                    className={styles.input}
                    value={editing.title}
                    onChange={e => setEditing({...editing, title: e.target.value})}
                />
                <div className={styles.grid2}>
                    <div>
                        <label className={styles.label}>{'計分方式'}</label>
                        <select
                            className={styles.select}
                            value={editing.scoring}
                            onChange={e => setEditing({...editing, scoring: e.target.value})}
                        >
                            {Object.entries(SCORING).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={styles.label}>{'通過門檻（項數）'}</label>
                        <input
                            className={styles.input}
                            type="number"
                            min="0"
                            placeholder="全部"
                            value={editing.passThreshold === null ? '' : editing.passThreshold}
                            onChange={e => setEditing({...editing, passThreshold: e.target.value === '' ? null : Number(e.target.value)})}
                        />
                    </div>
                </div>
                <label className={styles.label}>{'學生自我檢查時可以看到'}</label>
                <select
                    className={styles.select}
                    value={editing.studentView}
                    onChange={e => setEditing({...editing, studentView: e.target.value})}
                >
                    {Object.entries(STUDENT_VIEWS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <label className={styles.label}>{'評語語氣'}</label>
                <select
                    className={styles.select}
                    value={editing.feedbackStyle}
                    onChange={e => setEditing({...editing, feedbackStyle: e.target.value})}
                >
                    <option value="student">{'給學生：鼓勵、提示方向，不給答案'}</option>
                    <option value="teacher">{'給老師：精確、直接'}</option>
                </select>
                <label className={styles.label}>{'作業說明（給 AI 參考，選填）'}</label>
                <textarea
                    className={styles.textarea}
                    value={editing.notes}
                    onChange={e => setEditing({...editing, notes: e.target.value})}
                />
                <h3 className={styles.sectionTitle}>{`項目（配分合計 ${total}）`}</h3>
                {editing.items.map((item, index) => (
                    <ItemEditor
                        key={item.id}
                        item={item}
                        onChange={changed => setEditing({...editing, items: editing.items.map((it, i) => (i === index ? changed : it))})}
                        onRemove={() => setEditing({...editing, items: editing.items.filter((it, i) => i !== index)})}
                    />
                ))}
                <div className={styles.row}>
                    <button
                        className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                        onClick={() => setEditing({
                            ...editing,
                            items: [...editing.items, {id: `r${Date.now()}`, type: 'rule', desc: '', points: 10, check: {usesOpcode: ''}}]
                        })}
                    >{'+ 規則項目'}</button>
                    <button
                        className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                        onClick={() => setEditing({
                            ...editing,
                            items: [...editing.items, {id: `a${Date.now()}`, type: 'ai', desc: '', points: 10}]
                        })}
                    >{'+ AI 項目'}</button>
                </div>
                <div className={styles.row} style={{marginTop: '0.75rem'}}>
                    <button
                        className={styles.button}
                        onClick={() => save(editing)}
                    >{'儲存範本'}</button>
                    <button
                        className={classNames(styles.button, styles.buttonSecondary)}
                        onClick={() => setEditing(null)}
                    >{'取消'}</button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.body}>
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{'批改範本'}</h3>
                {templates.length === 0 && <p className={styles.hint}>{'還沒有範本。'}</p>}
                {templates.map(t => (
                    <div key={t.id} className={classNames(styles.card, styles.row)}>
                        <div className={styles.grow}>
                            <div>{t.title}</div>
                            <div className={styles.meta}>
                                {`${t.items.length} 項 · ${SCORING[t.scoring]} · 學生：${STUDENT_VIEWS[t.studentView]}`}
                            </div>
                        </div>
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            onClick={() => setEditing(t)}
                        >{'編輯'}</button>
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            onClick={() => downloadBlob(`${t.title}.json`, new Blob([JSON.stringify(t, null, 2)], {type: 'application/json'}))}
                        >{'匯出'}</button>
                        <button
                            className={classNames(styles.button, styles.buttonDanger, styles.buttonSmall)}
                            onClick={() => window.confirm(`刪除「${t.title}」？`) && setTemplates(templates.filter(x => x.id !== t.id))}
                        >{'刪除'}</button>
                    </div>
                ))}
                <div className={styles.row}>
                    <button
                        className={styles.button}
                        onClick={() => setEditing(emptyTemplate())}
                    >{'新增範本'}</button>
                    <label className={classNames(styles.button, styles.buttonSecondary)}>
                        {'匯入 JSON'}
                        <input
                            type="file"
                            accept=".json,application/json"
                            style={{display: 'none'}}
                            onChange={importFile}
                        />
                    </label>
                </div>
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{'用文字產生範本'}</h3>
                <textarea
                    className={styles.textarea}
                    value={draftText}
                    placeholder={'把作業要求貼上來，例如：\n1. 綠旗開始時貓咪回到中間（20 分）\n2. 用方向鍵控制移動（30 分）\n3. 碰到蘋果加 1 分，用變數記分（50 分）'}
                    onChange={e => setDraftText(e.target.value)}
                />
                <button
                    className={styles.button}
                    disabled={busy || !draftText.trim()}
                    onClick={draft}
                >{busy ? 'AI 整理中…' : '產生範本草稿'}</button>
                {error && <div className={classNames(styles.message, styles.messageError)}>{error}</div>}
            </div>

            <ClassConfigEditor services={services} />
        </div>
    );
};

TemplatesTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default TemplatesTab;
