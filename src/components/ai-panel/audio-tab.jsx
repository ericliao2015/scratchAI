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
import {AUDIO_PROVIDERS, audioCapabilities, generateAudio, musicPrompt} from '../../ai/audio/services.js';
import {decodeAudio, prepareAudio} from '../../ai/audio/process.js';
import {audioQuota} from '../../ai/mode.js';
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
    const [sfxSeconds, setSfxSeconds] = useState(0);
    const [sfxLoop, setSfxLoop] = useState(false);
    const url = useAudioUrl(sound);

    // Two kinds of AI: a text model that designs synth sounds, or an audio service that makes real audio.
    const caps = audioCapabilities(services.settings);
    const useService = caps.provider !== 'synth';
    const textModelReason = services.hasTextModel() ? '' : t('要先到「設定」設定 AI 模型（文字模型）');
    const classLimit = !permissions.teacher && services.modeState.classConfig ?
        services.modeState.classConfig.audioDailyLimit || 0 : 0;
    const quotaReason = classLimit && audioQuota.used() >= classLimit ?
        t('今天的 AI 音效／音樂次數已用完（{0} 次）', [classLimit]) : '';
    const examReason = permissions.audio ? '' : t('老師已關閉 AI 音效與音樂');
    const serviceReason = examReason || (caps.ready ? quotaReason : t(caps.reason));
    const synthAIReason = examReason || textModelReason;

    const setProvider = provider => services.updateSettings({
        ...services.settings,
        audio: {...(services.settings.audio || {}), provider}
    });

    const fromService = (kind, prompt, label) => guard(t('AI 產生聲音中（可能要數十秒）…'), async () => {
        const raw = await generateAudio({
            settings: services.settings,
            kind,
            prompt,
            durationSeconds: kind === 'sfx' ? sfxSeconds : 30,
            loop: kind === 'sfx' ? sfxLoop : true
        });
        const decoded = await decodeAudio(raw);
        const samples = prepareAudio(decoded, {
            kind,
            loop: kind === 'music' || sfxLoop,
            // ElevenLabs loop mode already returns a seamless loop.
            seamless: kind === 'sfx' && sfxLoop
        });
        audioQuota.add();
        setSound(makeSound(label, samples));
        setName(label);
        recordUsage(services.vm, {mode: 'audio', prompt});
    });

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
            <div className={styles.row}>
                <span>{t('聲音來源')}</span>
                <select
                    className={classNames(styles.select, styles.grow)}
                    value={caps.provider}
                    onChange={e => setProvider(e.target.value)}
                >
                    {Object.entries(AUDIO_PROVIDERS).map(([id, p]) => (<option
                        key={id}
                        value={id}
                    >{t(p.label)}</option>))}
                </select>
            </div>
            <p className={styles.hint}>
                {useService ?
                    t('常用音效與「快速產生」由瀏覽器合成（免費）；標示 🤖 的按鈕會呼叫所選的 AI 服務，可能產生費用。') :
                    t('聲音由瀏覽器即時合成，不需要網路，也不會用到 AI 額度；「AI 設計／AI 作曲」會請文字 AI 設計參數或寫譜（需要先設定 AI 模型）。')}
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
                    <label className={styles.label}>
                        {useService && caps.sfx ? t('🤖 描述你想要的聲音，讓 AI 產生') : t('或描述你想要的聲音，讓 AI 設計')}
                    </label>
                    <div className={styles.row}>
                        <input
                            className={classNames(styles.input, styles.grow)}
                            value={description}
                            placeholder={t('例如：小精靈施放冰凍魔法')}
                            onChange={e => setDescription(e.target.value)}
                        />
                        {useService && caps.sfx ? (
                            <button
                                className={styles.button}
                                disabled={!!busy || !description.trim() || !!serviceReason}
                                onClick={() => fromService('sfx', description.trim(), description.trim().slice(0, 20))}
                            >{t('AI 產生')}</button>
                        ) : (
                            <button
                                className={styles.button}
                                disabled={!!busy || !description.trim() || !!synthAIReason}
                                onClick={designWithAI}
                            >{t('AI 設計')}</button>
                        )}
                    </div>
                    {useService && caps.sfx && (
                        <div className={styles.row}>
                            <span>{t('長度')}</span>
                            <select
                                className={styles.select}
                                style={{width: 'auto'}}
                                value={sfxSeconds}
                                onChange={e => setSfxSeconds(Number(e.target.value))}
                            >
                                {[0, 0.5, 1, 2, 3, 5, 10].map(n => (<option
                                    key={n}
                                    value={n}
                                >{n ? t('{0} 秒', [n]) : t('自動')}</option>))}
                            </select>
                            <label className={styles.checkbox}>
                                <input
                                    type="checkbox"
                                    checked={sfxLoop}
                                    onChange={e => setSfxLoop(e.target.checked)}
                                />
                                {t('可循環（例如引擎聲、雨聲）')}
                            </label>
                        </div>
                    )}
                    {(useService && caps.sfx ? serviceReason : synthAIReason) && (
                        <p className={styles.meta}>{`ⓘ ${useService && caps.sfx ? serviceReason : synthAIReason}`}</p>
                    )}
                    {useService && !caps.sfx && (
                        <p className={styles.meta}>{t('ⓘ {0} 只能產生音樂；音效使用內建合成，或改用 ElevenLabs。', [t(AUDIO_PROVIDERS[caps.provider].label)])}</p>
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
                    <label className={styles.label}>
                        {useService ? t('🤖 讓 AI 產生真實的音樂（約 30 秒，自動處理成可循環）') : t('或描述情境，讓 AI 作曲')}
                    </label>
                    <div className={styles.row}>
                        <input
                            className={classNames(styles.input, styles.grow)}
                            value={mood}
                            placeholder={t('例如：在森林裡探險、魔王出現前')}
                            onChange={e => setMood(e.target.value)}
                        />
                        {useService ? (
                            <button
                                className={styles.button}
                                disabled={!!busy || !!serviceReason}
                                onClick={() => fromService('music', musicPrompt(style, mood.trim()),
                                    `${t(MUSIC_STYLES[style].label)} AI loop`)}
                            >{t('AI 產生音樂')}</button>
                        ) : (
                            <button
                                className={styles.button}
                                disabled={!!busy || !!synthAIReason}
                                onClick={aiMusic}
                            >{t('AI 作曲')}</button>
                        )}
                    </div>
                    {(useService ? serviceReason : synthAIReason) && (
                        <p className={styles.meta}>{`ⓘ ${useService ? serviceReason : synthAIReason}`}</p>
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
