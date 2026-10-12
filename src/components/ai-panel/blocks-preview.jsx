import PropTypes from 'prop-types';
import React, {useEffect, useRef, useState} from 'react';
import classNames from 'classnames';
import styles from './ai-panel.css';
import {blocksToWorkspaceXml} from '../../ai/preview.js';
import {STAGE_KEY} from '../../ai/ir/scope.js';
import {t} from './i18n.js';

/**
 * Read-only scratch-blocks workspace showing the blocks a plan will add.
 * @param {object} props props
 * @returns {React.ReactElement} preview
 */
const BlocksPreview = ({vm, scripts, height = 220}) => {
    const groups = scripts.filter(group => group.blocks.length > 0);
    const [index, setIndex] = useState(0);
    const ref = useRef(null);
    const group = groups[Math.min(index, groups.length - 1)];

    useEffect(() => {
        const SB = window.ScratchBlocks;
        if (!SB || !ref.current || !group) return () => {};
        const main = SB.getMainWorkspace && SB.getMainWorkspace();
        let workspace = null;
        try {
            workspace = SB.inject(ref.current, {
                readOnly: true,
                media: main && main.options ? main.options.pathToMedia : undefined, // eslint-disable-line no-undefined
                scrollbars: true,
                zoom: {controls: false, wheel: true, startScale: 0.55},
                rtl: main && main.RTL,
                colours: main && main.options ? main.options.colours : undefined // eslint-disable-line no-undefined
            });
            // inject() makes the new workspace Blockly's "main" one; give that back to the editor.
            if (main) SB.mainWorkspace = main;
            SB.Xml.clearWorkspaceAndLoadFromXml(SB.Xml.textToDom(blocksToWorkspaceXml(vm, group.blocks)), workspace);
            workspace.cleanUp();
            workspace.scrollCenter();
        } catch (e) {
            // A preview problem must never block applying the program.
            // eslint-disable-next-line no-console
            console.warn('[scratchAI] preview failed', e);
        }
        return () => {
            if (workspace) workspace.dispose();
            if (main) SB.mainWorkspace = main;
        };
    }, [group]);

    if (!group) return null;
    return (
        <div className={styles.preview}>
            {groups.length > 1 && (
                <div className={styles.chips}>
                    {groups.map((g, i) => (
                        <button
                            key={g.target}
                            className={classNames(styles.chip, i === index && styles.chipSelected)}
                            onClick={() => setIndex(i)}
                        >{g.target === STAGE_KEY ? t('舞台') : g.target}</button>
                    ))}
                </div>
            )}
            <div
                ref={ref}
                className={styles.previewWorkspace}
                style={{height}}
            />
        </div>
    );
};

BlocksPreview.propTypes = {
    vm: PropTypes.object.isRequired,
    scripts: PropTypes.arrayOf(PropTypes.object).isRequired,
    height: PropTypes.number
};

export default BlocksPreview;
