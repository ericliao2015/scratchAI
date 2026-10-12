/**
 * Built-in starter mission pack. Checks do not name sprites, so they work with any project.
 */
import {normalizeMissionPack} from './pack.js';

const TEXT = {
    zh: {
        title: '入門任務包',
        description: '五個小任務，從讓角色動起來到修好程式。',
        walk: ['動起來！', '按下綠旗後，讓角色往右走。', ['要先有「當綠旗被點擊」。', '「移動 10 點」或「x 改變 10」可以讓角色往右。']],
        keys: ['方向鍵', '按右鍵時角色往右走，按左鍵時往左走。', ['「當 (向右) 鍵被按下」可以接收按鍵。', '往左走可以用負的數字，例如 x 改變 -10。']],
        hello: ['打招呼', '按下綠旗後，讓角色說「你好」。', ['外觀類有「說出 ( )」積木。'], '你好'],
        score: ['積木排序：數到 5', '把打散的積木拼回去：按下綠旗後，分數從 0 開始，一次加 1，加到 5。', ['先找出帽子積木（最上面圓圓的那個）。', '「重複 5 次」要把「分數改變 1」包在裡面。'], '分數'],
        spin: ['找錯誤：轉不停', '這段程式本來想讓角色一直轉圈，可是只轉了一下就停了。把它修好！', ['程式只執行了一次「右轉」。', '想想看：哪個積木可以讓裡面的積木一直重複？']],
        greenFlag: '使用「當綠旗被點擊」',
        moves: '按下綠旗後角色往右移動',
        right: '按右鍵往右走',
        left: '按左鍵往左走',
        says: '角色說出「你好」',
        counts: '分數最後是 5',
        shape: '積木順序正確',
        spins: '角色一直在轉'
    },
    en: {
        title: 'Starter missions',
        description: 'Five small missions, from making a sprite move to fixing a program.',
        walk: ['Get moving!', 'When the green flag is clicked, make the sprite walk to the right.', ['Start with "when green flag clicked".', '"move 10 steps" or "change x by 10" moves the sprite to the right.']],
        keys: ['Arrow keys', 'Walk right when the right arrow is pressed and left when the left arrow is pressed.', ['"when (right arrow) key pressed" reacts to a key.', 'Use a negative number to go left, e.g. change x by -10.']],
        hello: ['Say hello', 'When the green flag is clicked, make the sprite say "Hello".', ['The Looks category has a "say ( )" block.'], 'Hello'],
        score: ['Parsons: count to 5', 'Put the shuffled blocks back together: when the green flag is clicked, score starts at 0 and goes up by 1 until it is 5.', ['Find the hat block first (the one with a round top).', '"repeat 5" must wrap "change score by 1".'], 'score'],
        spin: ['Fix it: keep spinning', 'This program should make the sprite spin forever, but it only turns once. Fix it!', ['The "turn right" block runs only once.', 'Which block repeats the blocks inside it forever?']],
        greenFlag: 'Uses "when green flag clicked"',
        moves: 'The sprite moves right after the green flag',
        right: 'Right arrow moves right',
        left: 'Left arrow moves left',
        says: 'The sprite says "Hello"',
        counts: 'score ends at 5',
        shape: 'Blocks are in the right order',
        spins: 'The sprite keeps turning'
    }
};

const flag = {at: 0, do: 'greenFlag'};

/**
 * @param {string} [locale] UI locale
 * @returns {object} normalized pack
 */
export const samplePack = (locale = 'zh-tw') => {
    const x = String(locale).startsWith('zh') ? TEXT.zh : TEXT.en;
    const scoreVar = x.score[3];
    const scoreScript = [
        {opcode: 'event_whenflagclicked'},
        {opcode: 'data_setvariableto', fields: {VARIABLE: scoreVar}, inputs: {VALUE: 0}},
        {opcode: 'control_repeat',
            inputs: {TIMES: 5},
            substacks: {SUBSTACK: [
                {opcode: 'data_changevariableby', fields: {VARIABLE: scoreVar}, inputs: {VALUE: 1}},
                {opcode: 'control_wait', inputs: {DURATION: 0.1}}
            ]}}
    ];
    return normalizeMissionPack({
        id: 'starter',
        title: x.title,
        description: x.description,
        missions: [
            {
                id: 'walk',
                title: x.walk[0],
                goal: x.walk[1],
                hints: x.walk[2],
                concepts: ['event', 'motion'],
                checks: [
                    {id: 'c1', type: 'rule', desc: x.greenFlag, points: 1, check: {usesOpcode: 'event_whenflagclicked'}},
                    {id: 'c2',
                        type: 'test',
                        desc: x.moves,
                        points: 1,
                        test: {duration: 1.5,
                            actions: [flag],
                            expect: [{prop: 'x', op: 'increased'}]}}
                ]
            },
            {
                id: 'keys',
                title: x.keys[0],
                goal: x.keys[1],
                hints: x.keys[2],
                concepts: ['event', 'keyboard'],
                checks: [
                    {id: 'c1',
                        type: 'test',
                        desc: x.right,
                        points: 1,
                        test: {duration: 1,
                            actions: [
                                flag, {at: 0.3, do: 'keyPress', key: 'right arrow'}],
                            expect: [{prop: 'x', op: 'increased', from: 0.2}]}},
                    {id: 'c2',
                        type: 'test',
                        desc: x.left,
                        points: 1,
                        test: {duration: 1,
                            actions: [
                                flag, {at: 0.3, do: 'keyPress', key: 'left arrow'}],
                            expect: [{prop: 'x', op: 'decreased', from: 0.2}]}}
                ]
            },
            {
                id: 'hello',
                title: x.hello[0],
                goal: x.hello[1],
                hints: x.hello[2],
                concepts: ['looks'],
                checks: [{id: 'c1',
                    type: 'test',
                    desc: x.says,
                    points: 1,
                    test: {duration: 2,
                        actions: [flag],
                        expect: [{said: x.hello[3]}]}}]
            },
            {
                id: 'score',
                kind: 'parsons',
                title: x.score[0],
                goal: x.score[1],
                hints: x.score[2],
                concepts: ['variable', 'loop'],
                variables: [{name: scoreVar, value: 0}],
                scripts: [scoreScript],
                checks: [
                    {id: 'c1', type: 'rule', desc: x.shape, points: 1, check: {matchesScript: scoreScript}},
                    {id: 'c2',
                        type: 'test',
                        desc: x.counts,
                        points: 1,
                        test: {duration: 2,
                            actions: [flag],
                            expect: [{var: scoreVar, op: '=', value: 5}]}}
                ]
            },
            {
                id: 'spin',
                kind: 'bugfix',
                title: x.spin[0],
                goal: x.spin[1],
                hints: x.spin[2],
                concepts: ['loop'],
                scripts: [[{opcode: 'event_whenflagclicked'}, {opcode: 'motion_turnright', inputs: {DEGREES: 15}}]],
                checks: [
                    {id: 'c1',
                        type: 'test',
                        desc: x.spins,
                        points: 1,
                        test: {duration: 2,
                            actions: [flag],
                            expect: [{prop: 'direction', op: 'changed', from: 0.5, at: 1.5}]}}
                ]
            }
        ]
    });
};
