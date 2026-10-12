/**
 * Checks on a run trace ("after 2 seconds the cat's x is bigger than 100") and a readable
 * summary of what happened during a run, for the AI and for students.
 *
 * Expectation format (all fields optional except one subject):
 *   {sprite: 'Cat', prop: 'x', op: '>', value: 100, at: 'end'}
 *   {var: 'score', op: '>=', value: 1}                     stage or sprite variable
 *   {prop: 'backdrop', op: '=', value: 'Night'}
 *   {said: 'hello', sprite: 'Cat'}                         any speech bubble containing the text
 *   {sprite: 'Cat', prop: 'x', op: 'changed', from: 0}     compared with the value at `from`
 * prop: x, y, direction, size, visible, costume, clones. op: = != > >= < <= changed unchanged
 * increased decreased contains. at: seconds or 'end' (default).
 */

export const OPS = ['=', '!=', '>', '>=', '<', '<=', 'changed', 'unchanged', 'increased', 'decreased', 'contains'];
const SPRITE_PROPS = ['x', 'y', 'direction', 'size', 'visible', 'costume', 'clones'];

const sampleAt = (trace, at) => {
    const samples = trace.samples;
    if (!samples.length) return null;
    if (at === 'end' || typeof at === 'undefined' || at === null || at === '') return samples[samples.length - 1];
    const time = Number(at);
    let found = samples[0];
    for (const s of samples) {
        if (s.t <= time + 1e-6) found = s;
        else break;
    }
    return found;
};

const findVar = (vars, name, sprite) => {
    if (sprite && Object.prototype.hasOwnProperty.call(vars, `${sprite}.${name}`)) return vars[`${sprite}.${name}`];
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    const key = Object.keys(vars).find(k => k.endsWith(`.${name}`));
    return key ? vars[key] : null;
};

const valueIn = (sample, exp) => {
    if (!sample) return null;
    if (typeof exp.var !== 'undefined') return findVar(sample.vars, String(exp.var), exp.sprite);
    if (exp.prop === 'backdrop') return sample.backdrop;
    const sprite = sample.sprites[exp.sprite];
    if (!sprite) return null;
    const prop = SPRITE_PROPS.includes(exp.prop) ? exp.prop : 'x';
    if (prop === 'clones') return sprite.clones || 0;
    return sprite[prop];
};

const num = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
};

const same = (a, b) => {
    if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
    const na = num(a);
    const nb = num(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
        return Math.abs(na - nb) < 1e-6;
    }
    return String(a).toLowerCase() === String(b).toLowerCase();
};

const compare = (op, actual, expected, before) => {
    switch (op) {
    case '!=': return !same(actual, expected);
    case '>': return num(actual) > num(expected);
    case '>=': return num(actual) >= num(expected);
    case '<': return num(actual) < num(expected);
    case '<=': return num(actual) <= num(expected);
    case 'changed': return !same(actual, before);
    case 'unchanged': return same(actual, before);
    case 'increased': return num(actual) > num(before);
    case 'decreased': return num(actual) < num(before);
    case 'contains': return String(Array.isArray(actual) ? actual.join(' ') : actual)
        .toLowerCase()
        .includes(String(expected).toLowerCase());
    default: return same(actual, expected);
    }
};

const show = value => {
    if (value === null || typeof value === 'undefined') return '（不存在）';
    if (Array.isArray(value)) return `[${value.join(', ')}]`;
    return String(value);
};

/**
 * A short human description of an expectation.
 * @param {object} exp expectation
 * @returns {string} description
 */
export const describeExpectation = exp => {
    if (exp.label) return String(exp.label);
    const when = typeof exp.at === 'undefined' || exp.at === 'end' ? '結束時' : `${exp.at} 秒時`;
    if (typeof exp.said !== 'undefined') return `${exp.sprite || '有角色'}說出「${exp.said}」`;
    let subject = `${exp.sprite || '角色'}的 ${exp.prop || 'x'}`;
    if (exp.prop === 'backdrop') subject = '背景';
    if (typeof exp.var !== 'undefined') subject = `變數「${exp.var}」`;
    const op = exp.op || '=';
    if (['changed', 'unchanged', 'increased', 'decreased'].includes(op)) {
        const words = {changed: '有改變', unchanged: '沒有改變', increased: '變大', decreased: '變小'};
        return `${when}${subject}${words[op]}`;
    }
    return `${when}${subject} ${op} ${show(exp.value)}`;
};

/**
 * Check expectations against a trace.
 * @param {object} trace from runScenario
 * @param {object[]} expectations see file comment
 * @returns {object[]} [{pass, label, actual, expected}]
 */
export const checkExpectations = (trace, expectations = []) => expectations.map(exp => {
    const label = describeExpectation(exp);
    if (typeof exp.said !== 'undefined') {
        const text = String(exp.said).toLowerCase();
        const until = typeof exp.at === 'undefined' || exp.at === 'end' ? Infinity : Number(exp.at);
        const hit = trace.said.find(s => s.t <= until + 1e-6 &&
            (!exp.sprite || s.sprite === exp.sprite) && s.text.toLowerCase().includes(text));
        return {
            pass: !!hit,
            label,
            actual: trace.said.length ? trace.said.map(s => `${s.sprite}: ${s.text}`).slice(0, 5)
                .join(' / ') : '（沒有說話）',
            expected: String(exp.said)
        };
    }
    // A sprite check without a sprite name passes when any sprite satisfies it.
    if (typeof exp.var === 'undefined' && exp.prop !== 'backdrop' && !exp.sprite) {
        const last = trace.samples[trace.samples.length - 1];
        const names = last ? Object.keys(last.sprites) : [];
        const tries = names.map(name => checkExpectations(trace, [{...exp, sprite: name}])[0]);
        const hit = tries.find(r => r.pass) || tries[0];
        return hit ? {...hit, label} : {pass: false, label, actual: '（沒有角色）', expected: String(exp.value)};
    }
    const actual = valueIn(sampleAt(trace, exp.at), exp);
    const before = valueIn(sampleAt(trace, typeof exp.from === 'undefined' ? 0 : exp.from), exp);
    const op = OPS.includes(exp.op) ? exp.op : '=';
    const pass = actual !== null && typeof actual !== 'undefined' && compare(op, actual, exp.value, before);
    const relative = ['changed', 'unchanged', 'increased', 'decreased'].includes(op);
    return {
        pass,
        label,
        actual: relative ? `${show(before)} → ${show(actual)}` : show(actual),
        expected: relative ? op : `${op} ${show(exp.value)}`
    };
});

const round = n => Math.round(n * 10) / 10;

/**
 * Describe a run in a few lines, for the AI (debugging, self-checks) and for people.
 * @param {object} trace from runScenario
 * @param {object} [options] {maxLines}
 * @returns {string} report
 */
export const summarizeTrace = (trace, {maxLines = 40} = {}) => {
    const lines = [];
    const actions = trace.actions.map(a => `${a.at}s ${a.do}${a.key ? ` ${a.key}` : ''}${a.sprite ? ` ${a.sprite}` : ''}` +
        `${a.message ? ` ${a.message}` : ''}`);
    lines.push(`Ran for ${trace.duration}s. Actions: ${actions.join(', ') || 'none'}.`);
    if (trace.hasRenderer === false) lines.push('(No renderer: "touching" blocks always report false in this run.)');
    const first = trace.samples[0];
    const last = trace.samples[trace.samples.length - 1];
    if (!first || !last) return lines.join('\n');
    for (const name of Object.keys(last.sprites)) {
        const a = first.sprites[name] || last.sprites[name];
        const b = last.sprites[name];
        const moves = trace.samples.filter((s, i) => i > 0 && s.sprites[name] &&
            trace.samples[i - 1].sprites[name] &&
            (s.sprites[name].x !== trace.samples[i - 1].sprites[name].x ||
             s.sprites[name].y !== trace.samples[i - 1].sprites[name].y));
        const costumes = [...new Set(trace.samples.map(s => s.sprites[name] && s.sprites[name].costume))]
            .filter(Boolean);
        const parts = [`position (${round(a.x)}, ${round(a.y)}) → (${round(b.x)}, ${round(b.y)})`];
        if (moves.length) parts.push(`moving during ${round(moves[0].t)}s–${round(moves[moves.length - 1].t)}s`);
        else parts.push('never moved');
        if (a.direction !== b.direction) parts.push(`direction ${a.direction} → ${b.direction}`);
        if (a.size !== b.size) parts.push(`size ${a.size} → ${b.size}`);
        if (a.visible !== b.visible) parts.push(`visible ${a.visible} → ${b.visible}`);
        if (costumes.length > 1) parts.push(`costumes used: ${costumes.slice(0, 6).join(', ')}`);
        const maxClones = Math.max(0, ...trace.samples.map(s => (s.sprites[name] && s.sprites[name].clones) || 0));
        if (maxClones) parts.push(`up to ${maxClones} clones`);
        lines.push(`Sprite "${name}": ${parts.join('; ')}.`);
    }
    for (const key of Object.keys(last.vars)) {
        const values = [];
        for (const s of trace.samples) {
            const v = show(s.vars[key]);
            if (values[values.length - 1] !== v) values.push(v);
        }
        const shown = values.length > 8 ? [...values.slice(0, 4), '…', ...values.slice(-3)] : values;
        lines.push(`Variable "${key}": ${values.length > 1 ? shown.join(' → ') : `${shown[0]} (never changed)`}.`);
    }
    if (first.backdrop !== last.backdrop) lines.push(`Backdrop: ${first.backdrop} → ${last.backdrop}.`);
    if (trace.said.length) {
        const said = trace.said.slice(0, 8).map(s => `${round(s.t)}s ${s.sprite}: "${s.text}"`);
        lines.push(`Speech: ${said.join('; ')}${trace.said.length > 8 ? ' …' : ''}.`);
    } else {
        lines.push('Nobody said or thought anything.');
    }
    return lines.slice(0, maxLines).join('\n');
};
