import PropTypes from 'prop-types';
import React, {useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {generateCostumes} from '../../ai/image/index.js';
import {STYLES} from '../../ai/image/prompt.js';
import {DEFAULT_OPTIONS} from '../../ai/image/process.js';
import {imageQuota} from '../../ai/mode.js';
import {describeError} from './errors.js';
import {t} from './i18n.js';

const OPTION_LABELS = [
    ['removeBackground', '去背（透明背景）'],
    ['trim', '自動裁切透明邊'],
    ['center', '造型中心置中'],
    ['scale', '縮放到適合舞台的大小'],
    ['flip', '多一個左右翻轉的造型'],
    ['vectorize', '轉成向量圖（可在造型編輯器修改）'],
    ['compress', '壓縮檔案大小']
];

const ImageTab = ({services}) => {
    const [description, setDescription] = useState('');
    const [kind, setKind] = useState('sprite');
    const [style, setStyle] = useState('cartoon');
    const [options, setOptions] = useState(DEFAULT_OPTIONS);
    const [frames, setFrames] = useState(1);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [results, setResults] = useState([]);
    const [selected, setSelected] = useState([]);
    const [destination, setDestination] = useState('current');
    const [newName, setNewName] = useState('');
    const [done, setDone] = useState('');

    const limit = services.modeState.classConfig && !services.permissions.teacher ?
        services.modeState.classConfig.imageDailyLimit : 0;
    const used = imageQuota.used();

    if (!services.permissions.image) {
        return (
            <div className={styles.body}>
                <div className={classNames(styles.message, styles.messageWarning)}>
                    {services.permissions.exam ? t('考試模式：AI 生圖已關閉。') : t('老師已關閉 AI 生圖功能。')}
                </div>
            </div>
        );
    }

    const run = async () => {
        if (!description.trim()) return;
        if (limit && used >= limit) {
            setError(t('今天的生圖次數已用完（每天 {0} 張）。', [limit]));
            return;
        }
        setBusy(true);
        setError('');
        setDone('');
        try {
            const costumes = await generateCostumes({
                settings: services.settings,
                description: description.trim(),
                kind,
                style,
                processing: options,
                frames: kind === 'backdrop' ? 1 : frames,
                client: services.hasTextModel() ? services.client : null,
                onStatus: (key, args) => setStatus(t(key, args))
            });
            imageQuota.add();
            setResults(costumes);
            setSelected(costumes.map((c, i) => i));
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy(false);
            setStatus('');
        }
    };

    const add = async () => {
        setBusy(true);
        setError('');
        try {
            const base = (newName || description).trim().slice(0, 20) || (kind === 'backdrop' ? 'backdrop' : 'costume');
            const costumes = selected.map(i => results[i]).map((c, i) => ({
                ...c,
                name: `${base}${c.suffix || (i ? `-${i + 1}` : '')}`
            }));
            const where = await services.addCostumes(costumes, {
                kind,
                destination: kind === 'backdrop' ? 'stage' : destination,
                spriteName: newName.trim() || description.trim().slice(0, 20)
            });
            setDone(t('已加入 {0} 個{1}到「{2}」', [costumes.length, kind === 'backdrop' ? t('背景') : t('造型'), where]));
        } catch (e) {
            setError(describeError(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={styles.body}>
            <div className={styles.section}>
                <label className={styles.label}>{t('想畫什麼？')}</label>
                <textarea
                    className={styles.textarea}
                    value={description}
                    placeholder={kind === 'backdrop' ? t('例如：夜晚的森林，有月亮和螢火蟲') : t('例如：戴太空頭盔的橘色小貓')}
                    onChange={e => setDescription(e.target.value)}
                />
                <div className={styles.grid2}>
                    <div>
                        <label className={styles.label}>{t('用途')}</label>
                        <select
                            className={styles.select}
                            value={kind}
                            onChange={e => setKind(e.target.value)}
                        >
                            <option value="sprite">{t('角色造型')}</option>
                            <option value="backdrop">{t('舞台背景')}</option>
                        </select>
                    </div>
                    <div>
                        <label className={styles.label}>{t('風格')}</label>
                        <select
                            className={styles.select}
                            value={style}
                            onChange={e => setStyle(e.target.value)}
                        >
                            {Object.entries(STYLES).map(([id, s]) => <option key={id} value={id}>{t(s.label)}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {kind === 'sprite' && (
                <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>{t('後製選項')}</h3>
                    {OPTION_LABELS.map(([key, label]) => (
                        <label key={key} className={styles.checkbox}>
                            <input
                                type="checkbox"
                                checked={!!options[key]}
                                onChange={e => setOptions({...options, [key]: e.target.checked})}
                            />
                            {t(label)}
                        </label>
                    ))}
                    {options.scale && (
                        <div className={styles.row}>
                            <span>{t('大小（長邊）')}</span>
                            <input
                                type="range"
                                min="40"
                                max="300"
                                value={options.size}
                                className={styles.grow}
                                onChange={e => setOptions({...options, size: Number(e.target.value)})}
                            />
                            <span>{t('{0} 點', [options.size])}</span>
                        </div>
                    )}
                    {options.removeBackground && (
                        <div className={styles.row}>
                            <span>{t('去背容許誤差')}</span>
                            <input
                                type="range"
                                min="10"
                                max="120"
                                value={options.tolerance}
                                className={styles.grow}
                                onChange={e => setOptions({...options, tolerance: Number(e.target.value)})}
                            />
                            <span>{options.tolerance}</span>
                        </div>
                    )}
                    <div className={styles.row}>
                        <span>{t('動畫造型')}</span>
                        <select
                            className={styles.select}
                            style={{width: 'auto'}}
                            value={frames}
                            onChange={e => setFrames(Number(e.target.value))}
                        >
                            <option value={1}>{t('1 張（不做動畫）')}</option>
                            <option value={3}>{t('3 張（走路）')}</option>
                            <option value={5}>{t('5 張（走路、跳、揮手）')}</option>
                        </select>
                    </div>
                </div>
            )}

            <div className={styles.row}>
                <button
                    className={styles.button}
                    disabled={busy || !description.trim()}
                    onClick={run}
                >{results.length ? t('重畫') : t('開始畫')}</button>
                {limit > 0 && <span className={styles.meta}>{t('今天已用 {0}/{1} 張', [used, limit])}</span>}
            </div>

            {busy && (
                <div className={styles.status}>
                    <div className={styles.spinner} />
                    <span>{status || t('處理中…')}</span>
                </div>
            )}
            {error && <div className={classNames(styles.message, styles.messageError)}>{error}</div>}

            {results.length > 0 && (
                <div className={styles.section}>
                    <h3 className={styles.sectionTitle}>{t('預覽')}</h3>
                    <div className={styles.grid2}>
                        {results.map((costume, i) => (
                            <label
                                key={i}
                                className={styles.card}
                            >
                                <img
                                    className={styles.previewImage}
                                    src={costume.previewUrl}
                                    alt=""
                                />
                                <span className={styles.checkbox}>
                                    <input
                                        type="checkbox"
                                        checked={selected.includes(i)}
                                        onChange={e => setSelected(e.target.checked ?
                                            [...selected, i].sort() : selected.filter(n => n !== i))}
                                    />
                                    {`${costume.dataFormat.toUpperCase()} · ${Math.round(costume.data.length / 1024)} KB`}
                                </span>
                            </label>
                        ))}
                    </div>
                    {kind === 'sprite' && (
                        <React.Fragment>
                            <label className={styles.label}>{t('加到')}</label>
                            <select
                                className={styles.select}
                                value={destination}
                                onChange={e => setDestination(e.target.value)}
                            >
                                <option value="current">{t('目前選取的角色')}</option>
                                <option value="new">{t('新角色')}</option>
                            </select>
                            {destination === 'new' && (
                                <input
                                    className={styles.input}
                                    placeholder={t('新角色名稱')}
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                />
                            )}
                        </React.Fragment>
                    )}
                    <div className={styles.row} style={{marginTop: '0.5rem'}}>
                        <button
                            className={styles.button}
                            disabled={busy || selected.length === 0}
                            onClick={add}
                        >{kind === 'backdrop' ? t('加入舞台背景') : t('加入造型')}</button>
                    </div>
                    {done && <div className={styles.pass}>{done}</div>}
                </div>
            )}
        </div>
    );
};

ImageTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default ImageTab;
