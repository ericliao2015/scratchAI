import PropTypes from 'prop-types';
import React, {useEffect, useRef, useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import GenerateTab from './generate-tab.jsx';
import ImageTab from './image-tab.jsx';
import GradeTab from './grade-tab.jsx';
import BatchTab from './batch-tab.jsx';
import TemplatesTab from './templates-tab.jsx';
import SettingsTab from './settings-tab.jsx';
import TutorTab from './tutor-tab.jsx';
import MissionsTab from './missions-tab.jsx';
import ClassroomTab from './classroom-tab.jsx';
import AudioTab from './audio-tab.jsx';
import {t} from './i18n.js';

const TABS = [
    {id: 'generate', label: '產生積木', component: GenerateTab, visible: p => p.generate || !p.tutor},
    {id: 'tutor', label: 'AI 家教', component: TutorTab, visible: p => p.tutor},
    {id: 'missions', label: '任務', component: MissionsTab, visible: p => p.missions},
    {id: 'image', label: 'AI 生圖', component: ImageTab, visible: () => true},
    {id: 'audio', label: 'AI 音樂', component: AudioTab, visible: p => p.audio || p.teacher},
    {id: 'grade', label: p => (p.teacher ? t('批改') : t('自我檢查')), component: GradeTab, visible: () => true},
    {id: 'batch', label: '批次', component: BatchTab, visible: p => p.batch},
    {id: 'templates', label: '範本', component: TemplatesTab, visible: p => p.templates},
    {id: 'classroom', label: '班級', component: ClassroomTab, visible: p => p.teacher},
    {id: 'settings', label: '設定', component: SettingsTab, visible: () => true}
];

const WIDTH_KEY = 'scratchai:panel-width';
const MIN_WIDTH = 320;

const loadWidth = () => {
    try {
        return Number(window.localStorage.getItem(WIDTH_KEY)) || 440;
    } catch (e) {
        return 440;
    }
};

const clampWidth = width => Math.max(MIN_WIDTH, Math.min(width, Math.max(MIN_WIDTH, window.innerWidth * 0.8)));

const AIPanel = ({tab, onChangeTab, onClose, services}) => {
    const [width, setWidth] = useState(() => clampWidth(loadWidth()));
    const [collapsed, setCollapsed] = useState(false);
    const dragging = useRef(false);

    useEffect(() => {
        const move = e => {
            if (!dragging.current) return;
            setWidth(clampWidth(window.innerWidth - e.clientX));
        };
        const up = () => {
            if (!dragging.current) return;
            dragging.current = false;
            document.body.style.userSelect = '';
            setWidth(current => {
                try {
                    window.localStorage.setItem(WIDTH_KEY, String(Math.round(current)));
                } catch (e) {
                    // ignore
                }
                return current;
            });
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        return () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
    }, []);

    const tabs = TABS.filter(entry => entry.visible(services.permissions));
    const current = tabs.find(entry => entry.id === tab) || tabs[0];
    const Component = current.component;
    const {permissions, modeState} = services;
    return (
        <section
            className={classNames(styles.panel, collapsed && styles.panelCollapsed)}
            style={{width}}
            aria-label={t('AI 助手')}
        >
            {!collapsed && (
                <div
                    className={styles.resizeHandle}
                    title={t('拖曳調整寬度')}
                    onMouseDown={e => {
                        e.preventDefault();
                        dragging.current = true;
                        document.body.style.userSelect = 'none';
                    }}
                />
            )}
            <header className={styles.header}>
                <span className={styles.title}>{t('AI 助手')}</span>
                <span className={styles.modeBadge}>
                    {permissions.teacher ? t('老師') : (permissions.exam ? t('考試') : t('學生'))}
                    {modeState.classConfig && modeState.classConfig.name ? ` · ${modeState.classConfig.name}` : ''}
                </span>
                <button
                    className={styles.iconButton}
                    title={collapsed ? t('展開') : t('縮小')}
                    onClick={() => setCollapsed(!collapsed)}
                >{collapsed ? '▢' : '－'}</button>
                <button
                    className={styles.iconButton}
                    title={t('關閉')}
                    onClick={onClose}
                >{'×'}</button>
            </header>
            {collapsed ? null : (
                <React.Fragment>
            <nav className={styles.tabs}>
                {tabs.map(entry => (
                    <button
                        key={entry.id}
                        className={classNames(styles.tab, entry.id === current.id && styles.tabSelected)}
                        onClick={() => onChangeTab(entry.id)}
                    >{typeof entry.label === 'function' ? entry.label(permissions) : t(entry.label)}</button>
                ))}
            </nav>
            <Component
                key={current.id}
                services={services}
            />
                </React.Fragment>
            )}
        </section>
    );
};

AIPanel.propTypes = {
    tab: PropTypes.string.isRequired,
    onChangeTab: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
    services: PropTypes.object.isRequired
};

export default AIPanel;
