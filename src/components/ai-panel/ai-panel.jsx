import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import GenerateTab from './generate-tab.jsx';
import ImageTab from './image-tab.jsx';
import GradeTab from './grade-tab.jsx';
import BatchTab from './batch-tab.jsx';
import TemplatesTab from './templates-tab.jsx';
import SettingsTab from './settings-tab.jsx';

const TABS = [
    {id: 'generate', label: '產生積木', component: GenerateTab, visible: () => true},
    {id: 'image', label: 'AI 生圖', component: ImageTab, visible: () => true},
    {id: 'grade', label: p => (p.teacher ? '批改' : '自我檢查'), component: GradeTab, visible: () => true},
    {id: 'batch', label: '批次', component: BatchTab, visible: p => p.batch},
    {id: 'templates', label: '範本', component: TemplatesTab, visible: p => p.templates},
    {id: 'settings', label: '設定', component: SettingsTab, visible: () => true}
];

const AIPanel = ({tab, onChangeTab, onClose, services}) => {
    const tabs = TABS.filter(t => t.visible(services.permissions));
    const current = tabs.find(t => t.id === tab) || tabs[0];
    const Component = current.component;
    const {permissions, modeState} = services;
    return (
        <section
            className={styles.panel}
            aria-label="AI 助手"
        >
            <header className={styles.header}>
                <span className={styles.title}>{'AI 助手'}</span>
                <span className={styles.modeBadge}>
                    {permissions.teacher ? '老師' : (permissions.exam ? '考試' : '學生')}
                    {modeState.classConfig && modeState.classConfig.name ? ` · ${modeState.classConfig.name}` : ''}
                </span>
                <button
                    className={styles.iconButton}
                    title="關閉"
                    onClick={onClose}
                >{'×'}</button>
            </header>
            <nav className={styles.tabs}>
                {tabs.map(t => (
                    <button
                        key={t.id}
                        className={classNames(styles.tab, t.id === current.id && styles.tabSelected)}
                        onClick={() => onChangeTab(t.id)}
                    >{typeof t.label === 'function' ? t.label(permissions) : t.label}</button>
                ))}
            </nav>
            <Component
                key={current.id}
                services={services}
            />
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
