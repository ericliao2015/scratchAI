import PropTypes from 'prop-types';
import React, {useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {describeError} from './errors.js';
import {t} from './i18n.js';

/**
 * Save and open projects on the class gateway (backend adapters, P6).
 * @param {object} props {services}
 * @returns {React.ReactElement} section
 */
const CloudProjects = ({services}) => {
    const [list, setList] = useState(null);
    const [name, setName] = useState(() => services.getProjectTitle() || '');
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState(null);
    const backend = services.backend;

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

    const refresh = () => guard(t('讀取中…'), async () => setList(await backend.listProjects()));
    const save = () => guard(t('儲存中…'), async () => {
        await backend.saveProject(name.trim(), await services.vm.saveProjectSb3('arraybuffer'));
        setMessage({ok: true, text: t('已存到雲端：{0}', [name.trim()])});
        setList(await backend.listProjects());
    });
    const open = projectName => guard(t('開啟中…'), async () => {
        // eslint-disable-next-line no-alert
        if (!window.confirm(t('開啟「{0}」會取代目前的專案，確定嗎？', [projectName]))) return;
        await services.vm.loadProject(await backend.loadProject(projectName));
        setMessage({ok: true, text: t('已開啟：{0}', [projectName])});
    });

    return (
        <div className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('雲端專案（班級閘道）')}</h3>
            <div className={styles.row}>
                <input
                    className={classNames(styles.input, styles.grow)}
                    value={name}
                    placeholder={t('專案名稱')}
                    onChange={e => setName(e.target.value)}
                />
                <button
                    className={styles.button}
                    disabled={!!busy || !name.trim()}
                    onClick={save}
                >{t('存到雲端')}</button>
                <button
                    className={classNames(styles.button, styles.buttonSecondary)}
                    disabled={!!busy}
                    onClick={refresh}
                >{t('我的雲端專案')}</button>
            </div>
            {list && list.length === 0 && <p className={styles.meta}>{t('雲端還沒有專案')}</p>}
            {list && list.length > 0 && (
                <ul className={styles.summary}>
                    {list.map(project => (
                        <li key={project.name}>
                            <button
                                className={classNames(styles.button, styles.buttonSecondary, styles.buttonSmall)}
                                disabled={!!busy}
                                onClick={() => open(project.name)}
                            >{t('開啟')}</button>
                            {` ${project.name} · ${new Date(project.updatedAt).toLocaleString()}`}
                        </li>
                    ))}
                </ul>
            )}
            {busy && <div className={styles.status}><div className={styles.spinner} />{busy}</div>}
            {message && (
                <div className={classNames(styles.message, message.ok ? styles.messageAi : styles.messageError)}>
                    {message.text}
                </div>
            )}
        </div>
    );
};

CloudProjects.propTypes = {
    services: PropTypes.object.isRequired
};

export default CloudProjects;
