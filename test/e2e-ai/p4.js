/* eslint-disable */
// Browser test for P4: mission packs, Parsons puzzle, hints, checks and AI-made exercises.
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');

const reply = body => {
  const system = Array.isArray(body.system) ? body.system.map(b => b.text).join('') : body.system;
  if (system.includes('programming exercises ("missions")')) {
    return {title: '跳一下', goal: '按空白鍵時，讓角色往上跳再落下。', scripts: [],
      hints: ['用「當空白鍵被按下」', '用 y 改變'], concepts: ['事件'],
      checks: [{type: 'test', desc: '按空白鍵會往上', points: 1, test: {duration: 1,
        actions: [{at: 0, do: 'keyPress', key: 'space'}], expect: [{prop: 'y', op: 'changed', at: 0.3}]}}]};
  }
  return {type: 'program', sprites: [{name: 'Sprite1', scripts: [[{opcode: 'event_whenflagclicked'}, {opcode: 'motion_movesteps', inputs: {STEPS: 10}}]]}]};
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
  await p.addInitScript(() => { try { localStorage.setItem('tw:language', 'zh-tw'); localStorage.setItem('scratchai:self-test', 'off'); } catch (e) {} });
  await p.goto(`${BASE_URL}editor.html`);
  await p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());
  await p.click('text=/✨ AI/');
  await p.evaluate(() => window.scratchAI.host.updateSettings({...window.scratchAI.host.state.settings,
    providers: {...window.scratchAI.host.state.settings.providers, anthropic: {apiKey: 'x', model: 'claude-opus-5-5', models: []}}}));
  const tabs = await p.$$eval('nav button', els => els.map(e => e.textContent));

  // Mission 1 fails on an empty project.
  await p.click('nav >> text=任務');
  await p.click('button:has-text("動起來！")');
  await p.click('button:text-is("檢查")');
  await p.waitForSelector('text=還差一點，再試試看！');
  await p.click('button:has-text("看提示（1/2）")');
  const hint1 = await p.isVisible('text=提示 1：要先有「當綠旗被點擊」。');

  // Solve it with the generate tab, then check again.
  await p.click('nav >> text=產生積木');
  await p.fill('section textarea', '往右走');
  await p.click('button:has-text("送出")');
  await p.click('button:has-text("套用到專案")');
  await p.waitForSelector('text=✓ 已套用');
  await p.click('nav >> text=任務');
  await p.click('button:has-text("動起來！")');
  await p.click('button:text-is("檢查")');
  await p.waitForSelector('text=🎉 任務完成！');
  const progressText = await p.textContent('text=/完成 \\d\\/5/');

  // Parsons puzzle.
  await p.click('button:has-text("積木排序：數到 5")');
  const topsBefore = await p.evaluate(() => window.ScratchBlocks.getMainWorkspace().getTopBlocks().length);
  await p.click('button:has-text("放上打散的積木")');
  await p.waitForTimeout(600);
  const topsAfter = await p.evaluate(() => window.ScratchBlocks.getMainWorkspace().getTopBlocks().length);
  const scoreVar = await p.evaluate(() => !!window.scratchAI.vm.runtime.getTargetForStage().lookupVariableByNameAndType('分數', ''));
  await p.screenshot({path: `${OUT}/p4-parsons.png`});
  await p.click('button:text-is("檢查")');
  await p.waitForSelector('text=沒有找到結構相同的腳本（檢查積木的順序和位置）');

  // AI exercise.
  await p.fill('input[placeholder="例如：迴圈、變數計分、廣播"]', '跳躍');
  await p.click('button:has-text("出題")');
  await p.waitForSelector('text=按空白鍵時，讓角色往上跳再落下。');
  const packNames = await p.$$eval('section select >> nth=0', els => [...els[0].options].map(o => o.textContent));
  await p.screenshot({path: `${OUT}/p4-ai-mission.png`});
  const progress = await p.evaluate(() => JSON.parse(localStorage.getItem('scratchai:mission-progress')));
  const log = await p.evaluate(() => {
    const stage = window.scratchAI.vm.runtime.getTargetForStage();
    const c = Object.values(stage.comments).find(x => x.text.startsWith('🤖 AI 使用紀錄'));
    return c ? JSON.parse(c.text.slice(c.text.indexOf('{'))).entries.map(e => e.mode) : null;
  });
  console.log(JSON.stringify({tabs, hint1, progressText, topsBefore, topsAfter, scoreVar, packNames, progress, log, errors}, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
