/**
 * Prompt for making practice exercises (missions) with AI.
 */
import {RULE_DESCRIPTIONS} from '../grade/rules.js';

const KIND_TEXT = {
    build: `"build": the student writes the program from scratch. Leave "scripts" empty.`,
    parsons: `"parsons": put the complete SOLUTION in "scripts". The editor splits it into single blocks and
shuffles them; the student puts them back together. Keep it to 4-10 blocks. Add a "matchesScript" rule check
with the same script, and a test check.`,
    bugfix: `"bugfix": put a program with ONE or TWO realistic bugs in "scripts" (wrong number, wrong order,
missing loop, wrong key, ...). The student finds and fixes them. Do not mention the bug in "goal"; describe
what the program SHOULD do. The checks must fail on the given program and pass when it is fixed.`
};

const LEVEL_TEXT = {
    simple: 'The student may be 8 to 12 years old: short sentences, everyday words, small tasks.',
    advanced: 'The student is comfortable with programming: tasks may combine several ideas.'
};

/**
 * @param {object} options {catalogText, level, language}
 * @returns {string} system prompt
 */
export const buildMissionSystemPrompt = ({catalogText, level = 'simple', language = '繁體中文'}) => `You create
small Scratch 3 programming exercises ("missions") for self-study. Reply with ONE JSON object only:
{
  "title": "short title",
  "goal": "what the student must make, as the student will read it",
  "scripts": [ [ <block>, ... ] ],
  "variables": [{"name": "score", "value": 0}],
  "hints": ["hint 1: the idea", "hint 2: which blocks", "hint 3: almost the answer"],
  "checks": [ <check>, ... ],
  "concepts": ["loop", "event", ...]
}
${LEVEL_TEXT[level] || LEVEL_TEXT.simple}
Write "title", "goal" and "hints" in ${language}. Do not name sprites: missions run on any sprite.

<block> is {"opcode": "...", "inputs": {...}, "fields": {...}, "substacks": {"SUBSTACK": [ <block>, ... ]}}
with opcodes from the catalog below. Variable fields take the variable name; declare variables in "variables".

<check> is one of:
- {"type": "test", "desc": "...", "points": 1, "test": {"duration": 2,
   "actions": [{"at": 0, "do": "greenFlag"}, {"at": 0.5, "do": "keyPress", "key": "space"}],
   "expect": [{"prop": "x", "op": "increased"}, {"var": "score", "op": "=", "value": 5}, {"said": "Hi"}]}}
  The project is run in the background with these actions. actions: greenFlag, keyPress/keyDown/keyUp ("key"),
  click ("sprite"), clickStage, broadcast ("message"), answer ("text"). expect: {"prop": x|y|direction|size|
  visible|costume|clones, "op", "value", "at": seconds or "end", "from": seconds} (any sprite), {"var": name, ...},
  {"said": text}. op: = != > >= < <= changed unchanged increased decreased contains.
  Only check what is certain: no random values, no "touching" results.
- {"type": "rule", "desc": "...", "points": 1, "check": {...}} with one of:
${Object.entries(RULE_DESCRIPTIONS).map(([key, text]) => `  {"${key}": ...} ${text}`)
        .join('\n')}
Prefer test checks for behaviour and rule checks for "uses block X". 1 to 3 checks.

# Block catalog
${catalogText}`;

/**
 * @param {object} options {topic, kind}
 * @returns {string} user message
 */
export const buildMissionUserMessage = ({topic, kind}) => `Make one mission of kind ${KIND_TEXT[kind] || KIND_TEXT.build}

Topic: ${topic}`;
