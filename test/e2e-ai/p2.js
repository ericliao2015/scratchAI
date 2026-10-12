/* eslint-disable */
// Browser test for tutor mode: right-click explain, hint ladder, AI markers and tutor-only class settings.
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');

const reply = body => {
  const system = Array.isArray(body.system) ? body.system.map(b => b.text).join('') : body.system;
  const user = body.messages[0].content;
  if (!system.includes('programming tutor')) {
    return {type: 'program', sprites: [{name: 'Sprite1', scripts: [[{opcode: 'event_whenflagclicked'}, {opcode: 'motion_movesteps', inputs: {STEPS: 10}}]]}]};
  }
  if (user.includes('hint level 3')) {
    return {message: '照骨架完成，把轉動放進迴圈。', skeleton: {sprite: 'Sprite1', scripts: [[{opcode: 'event_whenflagclicked'}, {opcode: 'control_forever'}]]}, missing: ['迴圈裡的轉動積木']};
  }
  if (user.includes('Explain the given script')) return {message: '這段程式在按下綠旗後讓角色移動 10 步。', question: '如果改成 -10 會怎樣？', concepts: ['事件']};
  return {message: '你需要一個可以一直重複的積木。', question: '哪個積木會一直重複？', concepts: ['迴圈']};
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

  // Generate a script so there is something to right-click; it gets an AI marker comment.
  await p.fill('section textarea', '移動');
  await p.click('button:has-text("送出")');
  await p.click('button:has-text("套用到專案")');
  await p.waitForSelector('text=✓ 已套用');
  await p.waitForTimeout(600);
  const marker = await p.evaluate(() => Object.values(window.scratchAI.vm.editingTarget.comments).map(c => c.text));

  // Right-click the move block.
  const box = await p.evaluate(() => {
    const ws = window.ScratchBlocks.getMainWorkspace();
    const block = ws.getAllBlocks().find(b => b.type === 'motion_movesteps');
    const r = block.getSvgRoot().getBoundingClientRect();
    return {x: r.x + 15, y: r.y + 10};
  });
  await p.mouse.click(box.x, box.y, {button: 'right'});
  await p.waitForSelector('text=🤖 AI 解釋這段程式');
  await p.screenshot({path: `${OUT}/p2-context-menu.png`});
  await p.click('text=🤖 AI 解釋這段程式');
  await p.waitForSelector('text=這段程式在按下綠旗後讓角色移動 10 步。', {timeout: 15000});

  // Hint ladder 1 -> 3.
  await p.fill('input[placeholder="例如：讓角色碰到邊緣就反彈"]', '一直轉圈');
  await p.click('button:has-text("給我提示")');
  await p.waitForSelector('text=你需要一個可以一直重複的積木。');
  await p.click('button:has-text("再多一點提示（2/3）")');
  await p.waitForTimeout(800);
  await p.click('button:has-text("再多一點提示（3/3）")');
  await p.waitForSelector('text=待完成：迴圈裡的轉動積木', {timeout: 15000});
  await p.waitForTimeout(500);
  await p.screenshot({path: `${OUT}/p2-tutor.png`});
  const skeletonShown = await p.$$eval('section .blocklySvg', els => els.length);

  // Grading shows the AI share.
  await p.click('nav >> text=自我檢查');
  await p.fill('section textarea', '角色會移動');
  const log = await p.evaluate(() => {
    const stage = window.scratchAI.vm.runtime.getTargetForStage();
    const c = Object.values(stage.comments).find(x => x.text.startsWith('🤖 AI 使用紀錄'));
    return c ? JSON.parse(c.text.slice(c.text.indexOf('{'))).entries.map(e => e.mode) : null;
  });

  // Tutor-only class settings hide the generate tab.
  await p.evaluate(() => window.scratchAI.host.setModeState({...window.scratchAI.host.state.modeState,
    classConfig: {version: 1, name: 'T', exam: false, aiMode: 'tutor', features: {generate: true, image: true, selfCheck: true}, providers: [], models: {}, templates: []}}));
  await p.waitForTimeout(300);
  const tabs = await p.$$eval('nav button', els => els.map(e => e.textContent));
  console.log(JSON.stringify({marker, skeletonShown, log, tabs, errors}));
  await b.close();
})();
