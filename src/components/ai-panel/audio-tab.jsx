import PropTypes from 'prop-types';
import React, {useEffect, useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {
    MUSIC_STYLES, SFX_PRESETS, addSoundToTarget, composeLoop, composeWithAI, designSfx, makeSound, mutateSfx,
    renderScore, renderSfx
} from '../../ai/audio/index.js';
import {compileProgram} from '../../ai/ir/compile.js';
import {applyPlan} from '../../ai/apply/apply.js';
import {modelFromVM} from '../../ai/project/model.js';
import {recordUsage} from '../../ai/provenance.js';
import {describeError} from './errors.js';
import {t} from './i18n.js';

const SFX_ICONS = {
    jump: '🦘',
    coin: '🪙',
    laser: '🔫',
    explosion: '💥',
    hit: '🤕',
    powerup: '⭐',
    click: '🖱️',
    boing: '🏀',
    magic: '✨',
    win: '🏆',
    lose: '😢',
    alarm: '🚨',
    step: '👣',
    pop: '🫧'
};

// Short audio preview from WAV bytes.
const useAudioUrl = sound => {
    const [url, setUrl] = useState('');
    useEffect(() => {
        if (!sound) return () => {};
        const next = URL.createObjectURL(new Blob([sound.wav], {type: 'audio/wav'}));
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [sound]);
    return url;
};

const AudioTab = ({services}) => {
    const {permissions} = services;
    const [mode, setMode] = useState('sfx');
    const [preset, setPreset] = useState('jump');
    const [params, setParams] = useState(SFX_PRESETS.jump.params);
    const [description, setDescription] = useState('');
    const [style, setStyle] = useState('happy');
    const [bars, setBars] = useState(8);
    const [tempo, setTempo] = useState(MUSIC_STYLES.happy.bpm);
    const [mood, setMood] = useState('');
    const [sound, setSound] = useState(null);
    const [name, setName] = useState('');
    const [target, setTarget] = useState('sprite');
    const [loopBlocks, setLoopBlocks] = useState(true);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState(null);
    const url = useAudioUrl(sound);
    const canUseAI = permissions.audio && services.hasTextModel();

    const guard = async (label, work) => {
        setBusy(label);
        setMessage(null);
        try {
            await work();
        } catch (e) {
            setMessage({ok: false, text: describeError(e)});
        } finally {
            setBusy('');
        }
    };

    // Rendering takes a moment for long loops; let the "working" message paint first.
    const later = work => new Promise(resolve => setTimeout(() => resolve(work()), 30));

    const playSfx = (nextParams, soundName) => {
        setParams(nextParams);
        const made = makeSound(soundName, renderSfx(nextParams, {seed: Date.now() % 100000}));
        setSound(made);
        setName(soundName);
    };

    const choosePreset = id => {
        setPreset(id);
        playSfx(SFX_PRESETS[id].params, t(SFX_PRESETS[id].label));
    };

    const designWithAI = () => guard(t('AI 設計音效中…'), async () => {
        const designed = await designSfx({client: services.client, description, language: services.language});
        playSfx(designed.params, designed.name);
        recordUsage(services.vm, {mode: 'audio', prompt: description});
    });

    const quickMusic = () => guard(t('作曲中…'), () => later(() => {
        const score = composeLoop({style, bars, bpm: tempo, seed: Date.now() % 100000});
        setSound(makeSound(`${t(MUSIC_STYLES[style].label)} loop`, renderScore(score)));
        setName(`${t(MUSIC_STYLES[style].label)} loop`);
    }));

    const aiMusic = () => guard(t('AI 作曲中…'), async () => {
        const score = await composeWithAI({client: services.client, style, description: mood, bars});
        await later(() => {
            setSound(makeSound(`${t(MUSIC_STYLES[style].label)} loop`, renderScore({...score, bpm: tempo || score.bpm})));
            setName(`${t(MUSIC_STYLES[style].label)} loop`);
        });
        recordUsage(services.vm, {mode: 'audio', prompt: `${style} ${mood}`.trim()});
    });

    const addToProject = () => guard(t('加入中…'), async () => {
        const vm = services.vm;
        const destination = target === 'stage' || !vm.editingTarget || vm.editingTarget.isStage ?
            vm.runtime.getTargetForStage() : vm.editingTarget;
        const added = await addSoundToTarget(vm, {...sound, name: name.trim() || sound.name}, destination.id);
        if (mode === 'music' && loopBlocks) {
            // when green flag clicked -> forever -> play sound until done
            const catalog = services.getCatalog();
            const script = [{opcode: 'event_whenflagclicked'}, {opcode: 'control_forever',
                substacks: {SUBSTACK: [
                    {opcode: 'sound_playuntildone', inputs: {SOUND_MENU: added}}
                ]}}];
            const ir = destination.isStage ? {type: 'program', stage: {scripts: [script]}} :
                {type: 'program', sprites: [{name: destination.getName(), scripts: [script]}]};
            const compiled = compileProgram(ir, {catalog, model: modelFromVM(vm)});
            if (!compiled.errors.length) await applyPlan(vm, compiled.plan);
        }
        setMessage({ok: true, text: t('已加入「{0}」到{1}', [added, destination.isStage ? t('舞台') : destination.getName()])});
    });

    return (
        <div className={styles.body}>
            <div className={styles.tabs}>
                <button
                    className={classNames(styles.tab, mode === 'sfx' && styles.tabSelected)}
                    onClick={() => {
                        setMode('sfx');
                        setSound(null);
                    }}
                >{t('音效')}</button>
                <button
                    className={classNames(styles.tab, mode === 'music' && styles.tabSelected)}
                    onClick={() => {
                        setMode('music');
                        setSound(null);
                    }}
                >{t('背景音樂（循環）')}</button>
            </div>
            <p className={styles.hint}>
                {t('聲音由瀏覽器即時合成，不需要網路，也不會用到 AI 額度；「AI 設計／AI 作曲」才會使用 AI。')}
            </p>

            {mode === 'sfx' && (
                <React.Fragment>
                    <label className={styles.label}>{t('常用音效（點一下試聽）')}</label>
                    <div className={styles.chips}>
                        {Object.entries(SFX_PRESETS).map(([id, p]) => (
                            <button
                                key={id}
                                className={classNames(styles.chip, preset === id && styles.chipSelected)}
                                onClick={() => choosePreset(id)}
                            >{`${SFX_ICONS[id] || '🔊'} ${t(p.label)}`}</button>
                        ))}
                    </div>
                    <div className={styles.row}>
                        <button
                            className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                            disabled={!!busy}
                            onClick={() => playSfx(mutateSfx(params, Date.now() % 100000), name || t('音效'))}
                        >{t('🎲 換一個類似的')}</button>
                    </div>
                    {canUseAI && (
                        <React.Fragment>
                            <label className={styles.label}>{t('或描述你想要的聲音，讓 AI 設計')}</label>
                            <div className={styles.row}>
                                <input
                                    className={classNames(styles.input, styles.grow)}
                                    value={description}
                                    placeholder={t('例如：小精靈施放冰凍魔法')}
                                    onChange={e => setDescription(e.target.value)}
                                />
                                <button
                                    className={styles.button}
                                    disabled={!!busy || !description.trim()}
                                    onClick={designWithAI}
                                >{t('AI 設計')}</button>
                            </div>
                        </React.Fragment>
                    )}
                </React.Fragment>
            )}

            {mode === 'music' && (
                <React.Fragment>
                    <label className={styles.label}>{t('風格')}</label>
                    <select
                        className={styles.select}
                        value={style}
                        onChange={e => {
                            setStyle(e.target.value);
                            setTempo(MUSIC_STYLES[e.target.value].bpm);
                        }}
                    >
                        {Object.entries(MUSIC_STYLES).map(([id, s]) => (<option
                            key={id}
                            value={id}
                        >{t(s.label)}</option>))}
                    </select>
                    <div className={styles.row}>
                        <span>{t('長度')}</span>
                        <select
                            className={styles.select}
                            style={{width: 'auto'}}
                            value={bars}
                            onChange={e => setBars(Number(e.target.value))}
                        >
                            {[4, 8, 16].map(n => (<option
                                key={n}
                                value={n}
                            >{t('{0} 小節', [n])}</option>))}
                        </select>
                        <span>{t('速度')}</span>
                        <input
                            type="range"
                            min="60"
                            max="180"
                            value={tempo}
                            onChange={e => setTempo(Number(e.target.value))}
                        />
                        <span className={styles.meta}>{`${tempo} BPM`}</span>
                    </div>
                    <div className={styles.row}>
                        <button
                            className={styles.button}
                            disabled={!!busy}
                            onClick={quickMusic}
                        >{sound ? t('🎲 換一首') : t('快速產生')}</button>
                    </div>
                    {canUseAI && (
                        <React.Fragment>
                            <label className={styles.label}>{t('或描述情境，讓 AI 作曲')}</label>
                            <div className={styles.row}>
                                <input
                                    className={classNames(styles.input, styles.grow)}
                                    value={mood}
                                    placeholder={t('例如：在森林裡探險、魔王出現前')}
                                    onChange={e => setMood(e.target.value)}
                                />
                                <button
                                    className={styles.button}
                                    disabled={!!busy}
                                    onClick={aiMusic}
                                >{t('AI 作曲')}</button>
                            </div>
                        </React.Fragment>
                    )}
                </React.Fragment>
            )}

            {busy && <div className={styles.status}><div className={styles.spinner} />{busy}</div>}

            {sound && (
                <div className={styles.card}>
                    <audio
                        key={url}
                        className={styles.audio}
                        src={url}
                        controls
                        autoPlay
                        loop={mode === 'music'}
                    />
                    <div className={styles.meta}>{t('{0} 秒', [sound.seconds.toFixed(1)])}</div>
                    <label className={styles.label}>{t('名稱')}</label>
                    <input
                        className={styles.input}
                        value={name}
                        onChange={e => setName(e.target.value)}
                    />
                    <div className={styles.row}>
                        <label className={styles.checkbox}>
                            <input
                                type="radio"
                                name="audio-target"
                                checked={target === 'sprite'}
                                onChange={() => setTarget('sprite')}
                            />
                            {t('目前角色')}
                        </label>
                        <label className={styles.checkbox}>
                            <input
                                type="radio"
                                name="audio-target"
                                checked={target === 'stage'}
                                onChange={() => setTarget('stage')}
                            />
                            {t('舞台')}
                        </label>
                    </div>
                    {mode === 'music' && (
                        <label className={styles.checkbox}>
                            <input
                                type="checkbox"
                                checked={loopBlocks}
                                onChange={e => setLoopBlocks(e.target.checked)}
                            />
                            {t('同時加入循環播放積木（當綠旗被點擊 → 重複無限次 → 播放音效直到結束）')}
                        </label>
                    )}
                    <button
                        className={styles.button}
                        disabled={!!busy}
                        onClick={addToProject}
                    >{t('加入專案')}</button>
                </div>
            )}
            {message && (
                <div className={classNames(styles.message, message.ok ? styles.messageAi : styles.messageError)}>
                    {message.text}
                </div>
            )}
        </div>
    );
};

AudioTab.propTypes = {
    services: PropTypes.object.isRequired
};

export default AudioTab;
