import PropTypes from 'prop-types';
import React, {useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {PROVIDERS, PROVIDER_ORDER} from '../../ai/providers/index.js';
import {TIER_LABELS, defaultModel, groupModels} from '../../ai/providers/tiers.js';
import {STRATEGIES, forgetKeys} from '../../ai/settings.js';
import {hashPin, normalizeClassConfig} from '../../ai/mode.js';
import {describeError} from './errors.js';
import {t} from './i18n.js';

const ModelPicker = ({providerId, config, onChange}) => {
    const groups = groupModels(providerId, config.models && config.models.length ? config.models : null);
    const known = groups.some(g => g.models.includes(config.model));
    return (
        <React.Fragment>
            <select
                className={styles.select}
                value={known ? config.model : '__custom__'}
                onChange={e => onChange(e.target.value === '__custom__' ? '' : e.target.value)}
            >
                {groups.map(group => (
                    <optgroup
                        key={group.tier || 'unranked'}
                        label={group.tier ? t(TIER_LABELS[group.tier]) : t('未分級')}
                    >
                        {group.models.map(model => <option key={model} value={model}>{model}</option>)}
                    </optgroup>
                ))}
                <option value="__custom__">{t('其他（自行輸入）')}</option>
            </select>
            {!known && (
                <input
                    className={styles.input}
                    placeholder={t('模型名稱')}
                    value={config.model}
                    onChange={e => onChange(e.target.value.trim())}
                />
            )}
        </React.Fragment>
    );
};
ModelPicker.propTypes = {
    providerId: PropTypes.string.isRequired,
    config: PropTypes.object.isRequired,
    onChange: PropTypes.func.isRequired
};

const SettingsTab = ({services}) => {
    const {settings, updateSettings, modeState, setModeState, permissions} = services;
    const classConfig = modeState.classConfig;
    const allowedProviders = classConfig && classConfig.providers.length && !permissions.teacher ?
        PROVIDER_ORDER.filter(id => classConfig.providers.includes(id)) : PROVIDER_ORDER;
    const providerId = allowedProviders.includes(settings.active) ? settings.active : allowedProviders[0];
    const provider = PROVIDERS[providerId];
    const config = settings.providers[providerId];
    const [showKey, setShowKey] = useState(false);
    const [busy, setBusy] = useState('');
    const [notice, setNotice] = useState(null);
    const [pin, setPin] = useState('');

    const setConfig = patch => updateSettings({
        ...settings,
        providers: {...settings.providers, [providerId]: {...config, ...patch}}
    });

    const loadModels = async () => {
        setBusy('models');
        setNotice(null);
        try {
            const models = await provider.listModels({apiKey: config.apiKey, baseUrl: config.baseUrl});
            const model = config.model && models.includes(config.model) ? config.model : defaultModel(providerId, models);
            setConfig({models, model});
            setNotice({ok: true, text: t('已載入 {0} 個模型', [models.length])});
        } catch (e) {
            setNotice({ok: false, text: describeError(e)});
        } finally {
            setBusy('');
        }
    };

    const test = async () => {
        setBusy('test');
        setNotice(null);
        try {
            const model = config.model || defaultModel(providerId, null);
            const result = await provider.complete({
                apiKey: config.apiKey,
                baseUrl: config.baseUrl,
                model,
                messages: [{role: 'user', content: 'Reply with the JSON {"ok": true} only.'}],
                json: true,
                maxTokens: 2000
            });
            if (!config.model) setConfig({model});
            setNotice({ok: true, text: t('連線成功（{0}）：{1}', [model, result.text.slice(0, 60)])});
        } catch (e) {
            setNotice({ok: false, text: describeError(e)});
        } finally {
            setBusy('');
        }
    };

    const testImage = async () => {
        setBusy('image');
        setNotice(null);
        try {
            await services.testImageProvider();
            setNotice({ok: true, text: t('生圖服務連線成功')});
        } catch (e) {
            setNotice({ok: false, text: describeError(e)});
        } finally {
            setBusy('');
        }
    };

    const configured = PROVIDER_ORDER.filter(id => {
        const c = settings.providers[id];
        return c.model && (id === 'compatible' ? c.baseUrl : c.apiKey);
    });

    const enterTeacher = async () => {
        if (!pin) return;
        const hash = await hashPin(pin);
        // A class config carries the teacher's PIN so students cannot set their own.
        const expected = (classConfig && classConfig.teacherPinHash) || modeState.pinHash;
        if (expected && expected !== hash) {
            setNotice({ok: false, text: t('PIN 不正確')});
            return;
        }
        setModeState({...modeState, mode: 'teacher', pinHash: hash});
        setPin('');
        setNotice({ok: true, text: expected ? t('已切換到老師模式') : t('已設定 PIN 並切換到老師模式')});
    };

    return (
        <div className={styles.body}>
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{t('AI 模型')}</h3>
                <label className={styles.label}>{t('1. 平台')}</label>
                <select
                    className={styles.select}
                    value={providerId}
                    onChange={e => updateSettings({...settings, active: e.target.value})}
                >
                    {allowedProviders.map(id => <option key={id} value={id}>{PROVIDERS[id].label}</option>)}
                </select>

                {provider.needsBaseUrl && (
                    <React.Fragment>
                        <label className={styles.label}>{t('伺服器網址')}</label>
                        <input
                            className={styles.input}
                            value={config.baseUrl || ''}
                            placeholder="http://localhost:11434/v1"
                            onChange={e => setConfig({baseUrl: e.target.value.trim()})}
                            onBlur={() => !config.models.length && loadModels()}
                        />
                        <p className={styles.hint}>{t('Ollama 需設定環境變數 OLLAMA_ORIGINS 允許本網站。')}</p>
                    </React.Fragment>
                )}

                <label className={styles.label}>{`2. API KEY${provider.requiresKey ? '' : t('（選填）')}`}</label>
                <div className={styles.row}>
                    <input
                        className={classNames(styles.input, styles.grow)}
                        type={showKey ? 'text' : 'password'}
                        autoComplete="off"
                        value={config.apiKey}
                        placeholder={t('貼上你的 KEY')}
                        onChange={e => setConfig({
                            apiKey: e.target.value.trim(),
                            // Start with the provider's best known model; the list can be loaded later.
                            model: config.model || defaultModel(providerId, config.models)
                        })}
                    />
                    <button
                        className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                        onClick={() => setShowKey(!showKey)}
                    >{showKey ? t('隱藏') : t('顯示')}</button>
                </div>
                {provider.keyUrl && (
                    <p className={styles.hint}>
                        {t('取得 KEY：')}
                        <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">{provider.keyUrl}</a>
                    </p>
                )}

                <label className={styles.label}>{t('3. 模型')}</label>
                <div className={styles.row}>
                    <div className={styles.grow}>
                        <ModelPicker
                            providerId={providerId}
                            config={config}
                            onChange={model => setConfig({model})}
                        />
                    </div>
                    <button
                        className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                        disabled={!!busy || (provider.requiresKey && !config.apiKey)}
                        onClick={loadModels}
                    >{busy === 'models' ? t('載入中…') : t('載入清單')}</button>
                </div>
                <div className={styles.row} style={{marginTop: '0.5rem'}}>
                    <button
                        className={styles.button}
                        disabled={!!busy || (provider.requiresKey && !config.apiKey)}
                        onClick={test}
                    >{busy === 'test' ? t('測試中…') : t('測試連線')}</button>
                </div>
                {notice && (
                    <div className={classNames(styles.message, notice.ok ? styles.messageAi : styles.messageError)}>
                        {notice.text}
                    </div>
                )}
                <p className={styles.hint}>
                    {t('已設定的平台：{0}。', [configured.map(id => PROVIDERS[id].label).join(t('、')) || t('（無）')]) +
                        t('可以同時設定多個平台作為備援。')}
                </p>
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{t('額度用完時')}</h3>
                {Object.entries(STRATEGIES).map(([id, label]) => (
                    <label key={id} className={styles.checkbox}>
                        <input
                            type="radio"
                            name="strategy"
                            checked={settings.strategy === id}
                            onChange={() => updateSettings({...settings, strategy: id})}
                        />
                        {t(label)}
                    </label>
                ))}
                <label className={styles.checkbox}>
                    <input
                        type="checkbox"
                        checked={settings.crossProvider !== false}
                        onChange={e => updateSettings({...settings, crossProvider: e.target.checked})}
                    />
                    {t('所有模型都不能用時，改用其他已設定的平台')}
                </label>
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{t('說明方式')}</h3>
                <label className={styles.checkbox}>
                    <input
                        type="radio"
                        name="level"
                        checked={(settings.level || 'simple') === 'simple'}
                        onChange={() => updateSettings({...settings, level: 'simple'})}
                    />
                    {t('簡易：AI 會先問清楚需求，用簡單的話解釋')}
                </label>
                <label className={styles.checkbox}>
                    <input
                        type="radio"
                        name="level"
                        checked={settings.level === 'advanced'}
                        onChange={() => updateSettings({...settings, level: 'advanced'})}
                    />
                    {t('進階：直接產生，精簡說明')}
                </label>
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{t('AI 生圖（Agnes AI）')}</h3>
                <label className={styles.label}>{'API KEY'}</label>
                <input
                    className={styles.input}
                    type="password"
                    autoComplete="off"
                    value={settings.image.apiKey}
                    onChange={e => updateSettings({...settings, image: {...settings.image, apiKey: e.target.value.trim()}})}
                />
                <label className={styles.label}>{t('模型')}</label>
                <select
                    className={styles.select}
                    value={settings.image.model}
                    onChange={e => updateSettings({...settings, image: {...settings.image, model: e.target.value}})}
                >
                    <option value="agnes-image-2.1-flash">{'agnes-image-2.1-flash'}</option>
                    <option value="agnes-image-2.0-flash">{'agnes-image-2.0-flash'}</option>
                </select>
                <label className={styles.label}>{t('服務網址')}</label>
                <input
                    className={styles.input}
                    value={settings.image.baseUrl}
                    onChange={e => updateSettings({...settings, image: {...settings.image, baseUrl: e.target.value.trim()}})}
                />
                <p className={styles.hint}>{t('如果瀏覽器無法直接連線，可改填老師架設的代理伺服器網址。')}</p>
                <button
                    className={classNames(styles.button, styles.buttonSecondary)}
                    disabled={!!busy || !settings.image.apiKey}
                    onClick={testImage}
                >{busy === 'image' ? t('測試中…') : t('測試生圖')}</button>
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{t('KEY 的保存')}</h3>
                <label className={styles.checkbox}>
                    <input
                        type="checkbox"
                        checked={settings.remember}
                        onChange={e => updateSettings({...settings, remember: e.target.checked})}
                    />
                    <span>
                        {t('在這台裝置記住 KEY')}
                        <span className={styles.hint}>{t('（共用電腦請不要勾選；不勾選時關閉分頁就會清除）')}</span>
                    </span>
                </label>
                <button
                    className={classNames(styles.button, styles.buttonDanger, styles.buttonSmall)}
                    onClick={() => {
                        updateSettings(forgetKeys(settings));
                        setNotice({ok: true, text: t('已清除這台裝置上的所有 KEY')});
                    }}
                >{t('清除此裝置上的 KEY')}</button>
            </div>

            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{t('模式')}</h3>
                {classConfig && (
                    <p className={styles.hint}>
                        {t('已套用班級設定：{0}{1}', [classConfig.name || t('（未命名）'), classConfig.exam ? t('（考試模式）') : ''])}
                    </p>
                )}
                {permissions.teacher ? (
                    <div className={styles.row}>
                        <span className={styles.grow}>{t('目前是老師模式')}</span>
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            onClick={() => setModeState({...modeState, mode: 'student'})}
                        >{t('切換到學生模式')}</button>
                    </div>
                ) : (
                    <React.Fragment>
                        <p className={styles.hint}>
                            {(modeState.pinHash || (classConfig && classConfig.teacherPinHash)) ?
                                t('輸入老師 PIN 進入老師模式。') : t('第一次使用：設定一組 PIN 並進入老師模式。')}
                        </p>
                        <div className={styles.row}>
                            <input
                                className={classNames(styles.input, styles.grow)}
                                type="password"
                                value={pin}
                                placeholder="PIN"
                                onChange={e => setPin(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && enterTeacher()}
                            />
                            <button
                                className={classNames(styles.button, styles.buttonSmall)}
                                onClick={enterTeacher}
                            >{t('老師模式')}</button>
                        </div>
                    </React.Fragment>
                )}
                {!classConfig && (
                    <label className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}>
                        {t('匯入班級設定檔')}
                        <input
                            type="file"
                            accept=".json,application/json"
                            style={{display: 'none'}}
                            onChange={async e => {
                                const file = e.target.files[0];
                                e.target.value = '';
                                if (!file) return;
                                try {
                                    const config = normalizeClassConfig(JSON.parse(await file.text()));
                                    setModeState({...modeState, classConfig: config, mode: 'student'});
                                    updateSettings({...settings, level: config.level || settings.level});
                                    setNotice({ok: true, text: t('已套用班級設定：{0}', [config.name || t('（未命名）')])});
                                } catch (err) {
                                    setNotice({ok: false, text: t('匯入失敗：{0}', [err.message])});
                                }
                            }}
                        />
                    </label>
                )}
                {permissions.teacher && classConfig && (
                    <button
                        className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                        onClick={() => setModeState({...modeState, classConfig: null})}
                    >{t('移除班級設定')}</button>
                )}
            </div>
        </div>
    );
};

SettingsTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default SettingsTab;
