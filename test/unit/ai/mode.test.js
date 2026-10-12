import {defaultModeState, normalizeClassConfig, permissions} from '../../../src/ai/mode.js';
import {normalizeTemplate} from '../../../src/ai/grade/template.js';

describe('modes', () => {
    test('student without class config can use everything except teacher tools', () => {
        expect(permissions(defaultModeState())).toMatchObject({
            teacher: false, generate: true, image: true, selfCheck: true, batch: false, templates: false
        });
    });

    test('teacher mode unlocks batch and templates even with a class config', () => {
        const state = {...defaultModeState(), mode: 'teacher', classConfig: normalizeClassConfig({exam: true})};
        expect(permissions(state)).toMatchObject({teacher: true, batch: true, templates: true, generate: true});
    });

    test('exam mode turns off generation and images', () => {
        const state = {...defaultModeState(), classConfig: normalizeClassConfig({exam: true})};
        expect(permissions(state)).toMatchObject({exam: true, generate: false, image: false, selfCheck: true});
    });

    test('class config features and key stripping', () => {
        const config = normalizeClassConfig({features: {image: false}, apiKey: 'secret', keys: {a: 1}, templates: 'x'});
        expect(config.apiKey).toBeUndefined();
        expect(config.keys).toBeUndefined();
        expect(config.templates).toEqual([]);
        expect(permissions({...defaultModeState(), classConfig: config})).toMatchObject({generate: true, image: false});
        expect(() => normalizeClassConfig(null)).toThrow();
    });

    test('templates are normalized', () => {
        const t = normalizeTemplate({items: [{id: 'a', type: 'rule', check: {hasLoop: true}}, {id: 'a', points: 'x'}],
            studentView: 'nope', scoring: 'passfail'});
        expect(t.items.map(i => i.id)).toEqual(['a', 'a-2']);
        expect(t.items[1]).toMatchObject({type: 'ai', points: 10, check: null});
        expect(t).toMatchObject({studentView: 'itemResult', scoring: 'passfail', passThreshold: null});
    });
});

describe('AI modes', () => {
    test('tutor only and generate only', () => {
        const tutorOnly = permissions({...defaultModeState(), classConfig: normalizeClassConfig({aiMode: 'tutor'})});
        expect(tutorOnly).toMatchObject({generate: false, tutor: true});
        const generateOnly = permissions({...defaultModeState(), classConfig: normalizeClassConfig({aiMode: 'generate'})});
        expect(generateOnly).toMatchObject({generate: true, tutor: false});
        const exam = permissions({...defaultModeState(), classConfig: normalizeClassConfig({exam: true})});
        expect(exam).toMatchObject({generate: false, tutor: false});
        expect(normalizeClassConfig({aiMode: 'weird'}).aiMode).toBe('both');
    });
});
