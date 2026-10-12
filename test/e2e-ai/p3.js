/* eslint-disable */
// Browser test for P3: self-test after generation (with one repair), tutor debug run report, test items in grading.
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');

const TEST = {duration: 2, actions: [{at: 0, do: 'greenFlag'}, {at: 0.5, do: 'keyPress', key: 'right arrow'}],
  expect: [{sprite: 'Sprite1', prop: 'x', op: 'increased'}]};
const program = dx => ({type: 'program', explanation: '按右鍵往右走', sprites: [{name: 'Sprite1', scripts: [
  [{opcode: 'event_whenflagclicked'}, {opcode: 'motion_gotoxy', inputs: {X: 0, Y: 0}}],
  [{opcode: 'event_whenkeypressed', fields: {KEY_OPTION: 'right arrow'}}, {opcode: 'motion_changexby', inputs: {DX: dx}}]
]}], test: TEST});

const seen = {generate: 0, testFeedback: false, debugReport: ''};
const reply = body => {
  const system = Array.isArray(body.system) ? body.system.map(b => b.text).join('') : body.system;
  if (system.includes('programming tutor')) {
    const user = body.messages[0].content;
    const i = user.indexOf('# What happened when the project ran');
    seen.debugReport = i >= 0 ? user.slice(i, i + 400) : '';
    return {message: '角色只有在按右鍵時才會移動，綠旗只會讓它回到中間。', question: '你有按右鍵嗎？'};
  }
  seen.generate++;
  if (!system.includes('# Self-test')) throw new Error('self-test prompt missing');
  const last = body.messages[body.messages.length - 1].content;
  if (last.includes('automatic test failed')) {
    seen.testFeedback = true;
    return program(10);
  }
  return program(-10);
};

(async () => {
  const b = await chromium.launch(launchOptions);
  const p = await b.newPage({viewport: {width: 1400, height: 900}});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://api.anthropic.com/v1/messages', route => {
    const body = JSON.parse(route.request().postData());
    route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
      body: JSON.stringify({content: [{type: 'text', text: JSON.stringify(reply(body))}], stop_reason: 'end_turn', usage: {}})});
  });
  await p.addInitScript(() => { try { localStorage.setItem('tw:language', 'zh-tw'); } catch (e) {} });
  await p.goto(`${BASE_URL}editor.html`);
  await p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());
  await p.click('text=/✨ AI/');
  await p.evaluate(() => window.scratchAI.host.updateSettings({...window.scratchAI.host.state.settings,
    providers: {...window.scratchAI.host.state.settings.providers, anthropic: {apiKey: 'x', model: 'claude-opus-5-5', models: []}}}));

  await p.fill('section textarea', '按右鍵往右走');
  await p.click('button:has-text("送出")');
  await p.waitForSelector('text=/已自動測試/', {timeout: 30000});
  const card = await p.textContent('details >> summary >> text=/自動測試/');
  const blocksBefore = await p.evaluate(() => Object.keys(window.scratchAI.vm.editingTarget.blocks._blocks).length);
  const stillOnStage = await p.evaluate(() => window.scratchAI.vm.editingTarget.x);
  await p.screenshot({path: `${OUT}/p3-selftest.png`});
  await p.click('button:has-text("套用到專案")');
  await p.waitForSelector('text=✓ 已套用');
  await p.waitForTimeout(500);

  // Tutor: why doesn't it work? (runs the project in the background first)
  const box = await p.evaluate(() => {
    const ws = window.ScratchBlocks.getMainWorkspace();
    const block = ws.getAllBlocks().find(b => b.type === 'event_whenflagclicked');
    const r = block.getSvgRoot().getBoundingClientRect();
    return {x: r.x + 20, y: r.y + 25};
  });
  await p.mouse.click(box.x, box.y, {button: 'right'});
  await p.click('text=🤖 AI：為什麼不會動？');
  await p.waitForSelector('text=角色只有在按右鍵時才會移動，綠旗只會讓它回到中間。', {timeout: 15000});
  await p.click('summary:has-text("在背景執行了你的程式")');
  await p.waitForTimeout(300);
  await p.screenshot({path: `${OUT}/p3-debug.png`});

  // Grading with a test item (no AI needed).
  await p.evaluate(() => window.scratchAI.host.setTemplates([{id: 'tp', title: '右鍵測試', studentView: 'full', items: [
    {id: 't1', type: 'test', desc: '按右鍵會往右走 10 步', points: 50, test: {duration: 1.5,
      actions: [{at: 0, do: 'greenFlag'}, {at: 0.5, do: 'keyPress', key: 'right arrow'}],
      expect: [{sprite: 'Sprite1', prop: 'x', op: '=', value: 10}, {said: '你好'}]}},
    {id: 'r1', type: 'rule', desc: '用了綠旗', points: 50, check: {usesOpcode: 'event_whenflagclicked'}}]}]));
  await p.click('nav >> text=自我檢查');
  await p.click('button:has-text("開始檢查")');
  await p.waitForSelector('text=按右鍵會往右走 10 步');
  await p.waitForSelector('summary:has-text("執行紀錄")');
  await p.click('summary:has-text("執行紀錄")');
  const gradeText = await p.textContent('section');
  await p.screenshot({path: `${OUT}/p3-grade.png`});

  console.log(JSON.stringify({
    generateCalls: seen.generate,
    testFeedback: seen.testFeedback,
    card,
    blocksBefore,
    stillOnStage,
    debugReport: seen.debugReport.slice(0, 300),
    gradeHas25: gradeText.includes('25/50'),
    gradeNoRendererNote: gradeText.includes('No renderer'),
    gradeSnippet: gradeText.slice(gradeText.indexOf('按右鍵會往右走'), gradeText.indexOf('按右鍵會往右走') + 260),
    errors
  }, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
