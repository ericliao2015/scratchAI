/**
 * Backend adapters (P6). Everything the editor needs from "a server" goes through one of
 * these, so a school can plug in its own system later by adding an adapter:
 *
 *   identity ()                        -> {name, className, kind}
 *   capabilities                       -> {submit, cloudProjects}
 *   submit ({data, fileName, assignment, report, summary})  -> {id, createdAt}
 *   listSubmissions ()                 -> [{id, assignment, fileName, createdAt, ...}]
 *   saveProject (name, data)           -> {name, updatedAt}
 *   listProjects ()                    -> [{name, size, updatedAt}]
 *   loadProject (name)                 -> ArrayBuffer
 *
 * "local" keeps everything on this computer (downloads files); "gateway" uses the class
 * gateway in server/.
 */
import JSZip from '@turbowarp/jszip';
import {gatewayRequest, gatewayToken} from '../providers/gateway.js';
import {fromBase64, toBase64} from './base64.js';

const download = (name, blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const localBackend = () => ({
    kind: 'local',
    capabilities: {submit: true, cloudProjects: false},
    identity: () => Promise.resolve({name: '', className: '', kind: 'local'}),
    // Without a server, "submitting" packs the project and the report for the student to hand in.
    async submit ({data, fileName, report}) {
        const zip = new JSZip();
        zip.file(fileName, data);
        if (report) zip.file(fileName.replace(/\.sb3$/i, '_report.md'), report);
        download(fileName.replace(/\.sb3$/i, '.zip'), await zip.generateAsync({type: 'blob'}));
        return {id: null, createdAt: new Date().toISOString(), downloaded: true};
    },
    listSubmissions: () => Promise.resolve([]),
    saveProject: () => Promise.reject(new Error('沒有設定伺服器，無法存到雲端')),
    listProjects: () => Promise.resolve([]),
    loadProject: () => Promise.reject(new Error('沒有設定伺服器'))
});

/**
 * @param {object} options {baseUrl, classCode, student, fetchImpl}
 * @returns {object} backend
 */
export const gatewayBackend = ({baseUrl, classCode, student, fetchImpl}) => {
    const token = gatewayToken(classCode, student);
    const call = (path, method = 'GET', body) => gatewayRequest({baseUrl, token, path, method, body, fetchImpl});
    return {
        kind: 'gateway',
        capabilities: {submit: true, cloudProjects: true},
        async identity () {
            const me = await call('/v1/whoami');
            return {name: me.student, className: me.className, kind: 'gateway', features: me.features};
        },
        submit: ({data, fileName, assignment, report, summary}) => call('/v1/submissions', 'POST', {
            project: toBase64(data), fileName, assignment, report, summary
        }),
        listSubmissions: async () => (await call('/v1/submissions')).data,
        saveProject: (name, data) => call(`/v1/projects/${encodeURIComponent(name)}`, 'PUT', {project: toBase64(data)}),
        listProjects: async () => (await call('/v1/projects')).data,
        loadProject: async name => fromBase64((await call(`/v1/projects/${encodeURIComponent(name)}`)).project)
    };
};

/**
 * The backend for the current settings: the class gateway when it is set up, else local.
 * @param {object} settings AI settings
 * @returns {object} backend
 */
export const backendFor = settings => {
    const gateway = settings && settings.providers && settings.providers.gateway;
    if (gateway && gateway.baseUrl && gateway.classCode && gateway.student) {
        return gatewayBackend({baseUrl: gateway.baseUrl, classCode: gateway.classCode, student: gateway.student});
    }
    return localBackend();
};

/**
 * Teacher side of the class gateway.
 * @param {object} options {baseUrl, adminToken, fetchImpl}
 * @returns {object} admin client
 */
export const gatewayAdmin = ({baseUrl, adminToken, fetchImpl}) => {
    const call = (path, method = 'GET', body) => gatewayRequest({baseUrl, token: adminToken, path, method, body, fetchImpl});
    return {
        health: () => call('/v1/health'),
        listClasses: async () => (await call('/v1/admin/classes')).data,
        createClass: klass => call('/v1/admin/classes', 'POST', klass),
        updateClass: (code, patch) => call(`/v1/admin/classes/${code}`, 'PATCH', patch),
        deleteClass: code => call(`/v1/admin/classes/${code}`, 'DELETE'),
        usage: (code, days = 7) => call(`/v1/admin/classes/${code}/usage?days=${days}`),
        listSubmissions: async code => (await call(`/v1/admin/classes/${code}/submissions`)).data,
        getSubmission: async (code, id) => {
            const body = await call(`/v1/admin/classes/${code}/submissions/${id}`);
            return {...body, data: fromBase64(body.project)};
        },
        deleteSubmission: (code, id) => call(`/v1/admin/classes/${code}/submissions/${id}`, 'DELETE')
    };
};

export {toBase64, fromBase64};
