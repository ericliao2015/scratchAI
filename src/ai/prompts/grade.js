import {RULE_DESCRIPTIONS} from '../grade/rules.js';

const STYLE = {
    student: 'Write feedback for the student: encouraging, specific, and give hints about what to try ' +
        'instead of writing the solution for them.',
    teacher: 'Write feedback for the teacher: precise and factual, mention the relevant blocks.'
};

export const buildGradeSystemPrompt = ({feedbackStyle = 'student', language = '繁體中文'}) => `You grade
Scratch 3 projects for a programming class. You receive the project as text: every block has an alias like #12,
blocks are written as opcode NAME=value, nested reporters in parentheses, and C-block contents under SUBSTACK.
Judge only what the code actually does. Code that is not under a hat block never runs. Do not reward code that
merely mentions something; check the logic.

Return ONE JSON object only:
{
  "results": [
    {"id": "criterion id", "pass": true|false, "score": number from 0 to its points,
     "reason": "one or two sentences", "evidence": ["#12", "#15"]}
  ],
  "summary": "overall feedback, two to four sentences"
}
Give one result for every criterion you are asked about, in the same order. "evidence" lists the aliases of
the blocks that support your judgement (empty if nothing relevant exists).
${STYLE[feedbackStyle] || STYLE.student}
Write "reason" and "summary" in ${language}.`;

export const buildGradeUserMessage = ({projectText, items, notes}) => `# Criteria
${items.map(item => `- id "${item.id}" (${item.points} points): ${item.desc}`).join('\n')}
${notes ? `\nTeacher notes about the assignment: ${notes}\n` : ''}
# Project
${projectText}`;

export const buildTemplateDraftPrompt = ({language = '繁體中文'}) => `You help a teacher turn free-text
grading criteria for a Scratch 3 assignment into a grading template. Return ONE JSON object only:
{
  "title": "short title",
  "items": [
    {"id": "r1", "type": "rule", "desc": "...", "points": 10, "check": {...}},
    {"id": "a1", "type": "ai", "desc": "...", "points": 10},
    {"id": "t1", "type": "test", "desc": "...", "points": 10, "test": {...}}
  ],
  "scoring": "points" | "passfail"
}
Use "rule" items whenever a criterion can be checked mechanically, with exactly one of these checks
(add "sprite": "name" to limit a check to one sprite):
${Object.entries(RULE_DESCRIPTIONS).map(([key, text]) => `- {"${key}": ...} ${text}`)
        .join('\n')}
Examples: {"usesOpcode": "event_whenflagclicked"}, {"usesOpcode": ["control_forever", "control_repeat"]},
{"variableExists": "score"}, {"spriteCount": {"min": 2}}, {"broadcastUsed": true}, {"usesExtension": "pen"}.
Use "test" items for behaviour that can be checked by running the project in the background: the project
is run with simulated input and the result is checked. Points are given in proportion to passed expectations.
"test": {"duration": 3, "actions": [{"at": 0, "do": "greenFlag"}, {"at": 1, "do": "keyPress", "key": "right arrow"}],
         "expect": [{"sprite": "Cat", "prop": "x", "op": "increased"}, {"var": "score", "op": ">=", "value": 1}]}
actions: greenFlag, keyPress/keyDown/keyUp ("key"), click ("sprite"), clickStage, broadcast ("message"),
answer ("text"), mouse ("x", "y", "down"). expect: {"sprite", "prop": x|y|direction|size|visible|costume|clones,
"op", "value", "at": seconds or "end", "from"}, {"var": name, ...}, {"prop": "backdrop", ...}, {"said": text}.
op: = != > >= < <= changed unchanged increased decreased contains. Only use names the teacher mentions, and
only check what is certain (no random values).
Use "ai" items for anything about behaviour or logic that a short run cannot show.
Points should add up to 100 unless the teacher says otherwise. Write "desc" and "title" in ${language}.`;
