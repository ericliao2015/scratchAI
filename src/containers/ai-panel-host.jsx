import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VM from 'scratch-vm';
import AIPanel from '../components/ai-panel/ai-panel.jsx';
import makeToolboxXML from '../lib/make-toolbox-xml';
import {
    getBackdropLibrary, getCostumeLibrary, getSoundLibrary, getSpriteLibrary
} from '../lib/libraries/tw-async-libraries';
import {buildCatalogFromEditor} from '../ai/catalog/catalog.js';
import {createAIClient} from '../ai/providers/runner.js';
import {buildChain} from '../ai/providers/tiers.js';
import {fetchJson} from '../ai/providers/http.js';
import {loadSettings, saveSettings} from '../ai/settings.js';
import {loadClassConfigFromUrl, loadModeState, permissions, saveModeState} from '../ai/mode.js';
import {loadTemplates, saveTemplates} from '../ai/grade/template.js';
import {makeIRImageGenerator} from '../ai/image/index.js';
import {applyPlan} from '../ai/apply/apply.js';
import {setLocale} from '../components/ai-panel/i18n.js';

export const TOGGLE_EVENT = 'scratchai:toggle-panel';

const LANGUAGES = {
    'zh-tw': '繁體中文',
    'zh-cn': '简体中文',
    'en': 'English',
    'ja': '日本語',
    'ko': '한국어'
};

class AIPanelHost extends React.Component {
    constructor (props) {
        super(props);
        const modeState = loadModeState();
        this.state = {
            open: false,
            tab: 'generate',
            settings: loadSettings(),
            modeState,
            templates: loadTemplates(),
            notice: ''
        };
        this.catalog = null;
        this.librariesPromise = null;
        this.client = createAIClient({
            getSettings: () => this.state.settings,
            onEvent: event => {
                if (event.type === 'fallback') {
                    // eslint-disable-next-line no-console
                    console.info(`[scratchAI] ${event.from.model} → ${event.to.model} (${event.reason})`);
                }
            }
        });
        this.handleToggle = this.handleToggle.bind(this);
        this.invalidateCatalog = this.invalidateCatalog.bind(this);
        this.handleClose = this.handleClose.bind(this);
        this.handleChangeTab = this.handleChangeTab.bind(this);
    }

    componentDidMount () {
        window.addEventListener(TOGGLE_EVENT, this.handleToggle);
        const vm = this.props.vm;
        vm.on('EXTENSION_ADDED', this.invalidateCatalog);
        vm.on('BLOCKSINFO_UPDATE', this.invalidateCatalog);
        vm.on('targetsUpdate', this.invalidateCatalog);
        // Handy for debugging and automated tests.
        window.scratchAI = {vm, host: this, getCatalog: () => this.getCatalog()};
        loadClassConfigFromUrl()
            .then(classConfig => {
                if (!classConfig) return;
                this.setModeState({...this.state.modeState, classConfig});
                if (classConfig.level) this.updateSettings({...this.state.settings, level: classConfig.level});
            })
            .catch(e => this.setState({notice: e.message, open: true, tab: 'settings'}));
    }

    componentWillUnmount () {
        window.removeEventListener(TOGGLE_EVENT, this.handleToggle);
        const vm = this.props.vm;
        vm.removeListener('EXTENSION_ADDED', this.invalidateCatalog);
        vm.removeListener('BLOCKSINFO_UPDATE', this.invalidateCatalog);
        vm.removeListener('targetsUpdate', this.invalidateCatalog);
    }

    handleToggle (event) {
        const tab = event && event.detail && event.detail.tab;
        this.setState(state => ({open: tab ? true : !state.open, tab: tab || state.tab}));
    }

    handleClose () {
        this.setState({open: false});
    }

    handleChangeTab (tab) {
        this.setState({tab});
    }

    invalidateCatalog () {
        this.catalog = null;
    }

    getCatalog () {
        if (!this.catalog) {
            try {
                this.catalog = buildCatalogFromEditor(this.props.vm, makeToolboxXML);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error('[scratchAI] could not build block catalog', e);
                this.catalog = null;
            }
        }
        return this.catalog;
    }

    getLibraries () {
        if (!this.librariesPromise) {
            this.librariesPromise = Promise.all([
                getCostumeLibrary(), getSpriteLibrary(), getBackdropLibrary(), getSoundLibrary()
            ])
                .then(([costumes, sprites, backdrops, sounds]) => ({costumes, sprites, backdrops, sounds}))
                .catch(() => ({costumes: [], sprites: [], backdrops: [], sounds: []}));
        }
        return this.librariesPromise;
    }

    updateSettings (settings) {
        saveSettings(settings);
        this.setState({settings});
    }

    setModeState (modeState) {
        saveModeState(modeState);
        this.setState({modeState});
    }

    setTemplates (templates) {
        saveTemplates(templates);
        this.setState({templates});
    }

    cleanUpWorkspace () {
        setTimeout(() => {
            const workspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
            if (workspace) workspace.cleanUp();
        }, 100);
    }

    highlightBlock (targetName, blockId) {
        const vm = this.props.vm;
        const target = vm.runtime.targets.find(t => t.isOriginal &&
            (t.isStage ? targetName === 'Stage' : t.getName() === targetName));
        if (!target) return;
        if (!vm.editingTarget || vm.editingTarget.id !== target.id) vm.setEditingTarget(target.id);
        setTimeout(() => {
            const workspace = window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace();
            if (!workspace || !workspace.getBlockById(blockId)) return;
            workspace.centerOnBlock(blockId);
            workspace.glowBlock(blockId, true);
            setTimeout(() => workspace.glowBlock(blockId, false), 2500);
        }, 300);
    }

    async addCostumes (costumes, {kind, destination, spriteName}) {
        const vm = this.props.vm;
        const plan = {sprites: [], scripts: [], variables: [], broadcasts: [], stage: {backdrops: []}};
        const specs = costumes.map(c => ({
            name: c.name,
            data: c.data,
            dataFormat: c.dataFormat,
            rotationCenterX: c.rotationCenterX,
            rotationCenterY: c.rotationCenterY,
            bitmapResolution: c.bitmapResolution
        }));
        let where;
        if (kind === 'backdrop') {
            plan.stage.backdrops = specs;
            where = '舞台';
        } else {
            const editing = vm.editingTarget;
            const useCurrent = destination === 'current' && editing && !editing.isStage;
            where = useCurrent ? editing.getName() : (spriteName || 'AI 角色');
            plan.sprites.push({name: where, isNew: !useCurrent, costumes: specs, props: {}});
        }
        await applyPlan(vm, plan);
        return where;
    }

    async testImageProvider () {
        const image = this.state.settings.image;
        await fetchJson(`${image.baseUrl.replace(/\/+$/, '')}/models`, {
            method: 'GET',
            headers: {Authorization: `Bearer ${image.apiKey}`},
            provider: 'agnes',
            timeout: 30000
        });
    }

    services () {
        const {settings, modeState, templates} = this.state;
        const perms = permissions(modeState);
        const host = this;
        return {
            vm: this.props.vm,
            client: this.client,
            settings,
            modeState,
            templates,
            permissions: perms,
            language: LANGUAGES[this.props.locale] || LANGUAGES[(this.props.locale || '').split('-')[0]] ||
                'the same language as the user',
            updateSettings: s => host.updateSettings(s),
            setModeState: s => host.setModeState(s),
            setTemplates: t => host.setTemplates(t),
            getCatalog: () => host.getCatalog(),
            getLibraries: () => host.getLibraries(),
            hasTextModel: () => buildChain(host.state.settings).length > 0,
            canGenerateImages: () => perms.image && !!settings.image.apiKey,
            generateImage: makeIRImageGenerator(settings, this.client),
            addCostumes: (costumes, options) => host.addCostumes(costumes, options),
            cleanUpWorkspace: () => host.cleanUpWorkspace(),
            highlightBlock: (target, id) => host.highlightBlock(target, id),
            getProjectTitle: () => this.props.projectTitle,
            testImageProvider: () => host.testImageProvider(),
            notice: this.state.notice
        };
    }

    render () {
        setLocale(this.props.locale);
        if (!this.state.open) return null;
        return (
            <AIPanel
                tab={this.state.tab}
                services={this.services()}
                onChangeTab={this.handleChangeTab}
                onClose={this.handleClose}
            />
        );
    }
}

AIPanelHost.propTypes = {
    locale: PropTypes.string,
    projectTitle: PropTypes.string,
    vm: PropTypes.instanceOf(VM).isRequired
};

const mapStateToProps = state => ({
    locale: state.locales.locale,
    projectTitle: state.scratchGui.projectTitle
});

export default connect(mapStateToProps)(AIPanelHost);
