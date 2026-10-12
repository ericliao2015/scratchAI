/* eslint-disable */
// Browser end-to-end test for the AI panel. AI APIs are mocked with page.route().
// Usage: build with ROOT=/scratchAI/, serve the parent of build/ as /scratchAI/, then
//   BASE_URL=http://localhost:8765/scratchAI/ node test/e2e-ai/<file>.js
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');
const program = {
  type: 'program',
  explanation: '我做了一個接蘋果遊戲：貓咪用左右鍵移動，蘋果從上面掉下來，接到就加 1 分。',
  broadcasts: [],
  stage: {variables: [{name: '分數', value: 0}]},
  sprites: [
    {name: 'Sprite1', scripts: [[
      {opcode: 'event_whenflagclicked'},
      {opcode: 'data_setvariableto', fields: {VARIABLE: '分數'}, inputs: {VALUE: 0}},
      {opcode: 'motion_gotoxy', inputs: {X: 0, Y: -140}},
      {opcode: 'control_forever', substacks: {SUBSTACK: [
        {opcode: 'control_if', inputs: {CONDITION: {opcode: 'sensing_keypressed', inputs: {KEY_OPTION: 'left arrow'}}}, substacks: {SUBSTACK: [{opcode: 'motion_changexby', inputs: {DX: -10}}]}},
        {opcode: 'control_if', inputs: {CONDITION: {opcode: 'sensing_keypressed', inputs: {KEY_OPTION: 'right arrow'}}}, substacks: {SUBSTACK: [{opcode: 'motion_changexby', inputs: {DX: 10}}]}}
      ]}}
    ]]},
    {name: '蘋果', costumes: [{svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="22" r="16" fill="#e33"/><rect x="18" y="2" width="4" height="8" fill="#5a3"/></svg>', name: 'apple'}],
     scripts: [[
      {opcode: 'event_whenflagclicked'},
      {opcode: 'control_forever', substacks: {SUBSTACK: [
        {opcode: 'motion_gotoxy', inputs: {X: {opcode: 'operator_random', inputs: {FROM: -200, TO: 200}}, Y: 170}},
        {opcode: 'control_repeat_until', inputs: {CONDITION: {opcode: 'operator_lt', inputs: {OPERAND1: {opcode: 'motion_yposition'}, OPERAND2: -170}}}, substacks: {SUBSTACK: [
          {opcode: 'motion_changeyby', inputs: {DY: -5}},
          {opcode: 'control_if', inputs: {CONDITION: {opcode: 'sensing_touchingobject', inputs: {TOUCHINGOBJECTMENU: 'Sprite1'}}}, substacks: {SUBSTACK: [
            {opcode: 'data_changevariableby', fields: {VARIABLE: '分數'}, inputs: {VALUE: 1}},
            {opcode: 'motion_sety', inputs: {Y: -180}}
          ]}}
        ]}}
      ]}}
    ]]}
  ]
};
(async () => {
  const b = await chromium.launch(launchOptions);
  const p = await b.newPage({viewport: {width: 1400, height: 900}});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  let requestBody = null;
  await p.route('https://api.anthropic.com/v1/messages', async route => {
    requestBody = JSON.parse(route.request().postData());
    await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
      body: JSON.stringify({content: [{type: 'text', text: JSON.stringify(program)}], stop_reason: 'end_turn', usage: {input_tokens: 9000, output_tokens: 800}})});
  });
  await p.goto(`${BASE_URL}editor.html`);
  await p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());
  await p.click('text=✨ AI 助手');
  await p.click('nav >> text=設定');
  await p.fill('input[placeholder="貼上你的 KEY"]', 'sk-test');
  await p.screenshot({path: `${OUT}/e2e-settings.png`});
  await p.click('nav >> text=產生積木');
  await p.fill('textarea', '做一個接蘋果遊戲');
  await p.click('button:has-text("送出")');
  await p.waitForSelector('button:has-text("套用到專案")', {timeout: 20000});
  await p.screenshot({path: `${OUT}/e2e-preview.png`});
  await p.click('button:has-text("套用到專案")');
  await p.waitForSelector('text=✓ 已套用', {timeout: 20000});
  await p.waitForTimeout(800);
  await p.screenshot({path: `${OUT}/e2e-applied.png`});
  const state = await p.evaluate(() => {
    const vm = window.scratchAI.vm;
    return {
      sprites: vm.runtime.targets.filter(t => t.isOriginal && !t.isStage).map(t => t.getName()),
      vars: Object.values(vm.runtime.getTargetForStage().variables).map(v => v.name),
      appleBlocks: Object.keys(vm.runtime.getSpriteTargetByName('蘋果').blocks._blocks).length,
      catalogSize: Object.keys(window.scratchAI.getCatalog().blocks).length
    };
  });
  console.log(JSON.stringify(state));
  console.log('model', requestBody.model, 'system chars', requestBody.system.length, 'has catalog', requestBody.system.includes('motion_movesteps'));
  console.log('errors', errors);
  // Start the project for a moment to make sure it runs.
  await p.evaluate(() => window.scratchAI.vm.greenFlag());
  await p.waitForTimeout(1500);
  await p.screenshot({path: `${OUT}/e2e-running.png`});
  await b.close();
})();
