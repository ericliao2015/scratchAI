/* eslint-disable */
// Browser end-to-end test for the AI panel. AI APIs are mocked with page.route().
// Usage: build with ROOT=/scratchAI/, serve the parent of build/ as /scratchAI/, then
//   BASE_URL=http://localhost:8765/scratchAI/ node test/e2e-ai/<file>.js
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const fs = require('fs');
const {chromium} = require('playwright');
(async () => {
  const b = await chromium.launch(launchOptions);
  const ctx = await b.newContext({viewport: {width: 1400, height: 900}, acceptDownloads: true});
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));

  // A fake generated picture: red circle on a white background.
  const tmp = await ctx.newPage();
  const pngBase64 = await tmp.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#e33'; g.beginPath(); g.arc(128, 128, 70, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(110, 110, 12, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png').split(',')[1];
  });
  await tmp.close();

  const anthropicCalls = [];
  await p.route('https://api.anthropic.com/v1/messages', async route => {
    const body = JSON.parse(route.request().postData());
    if (Array.isArray(body.system)) body.system = body.system.map(b => b.text).join('');
    anthropicCalls.push(body.system.slice(0, 60));
    let text;
    if (body.system.includes('review picture requests')) text = '{"ok": true, "reason": ""}';
    else if (body.system.includes('You grade')) {
      const ids = (body.messages[0].content.match(/- id "(\w+)"/g) || []).map(s => s.match(/"(\w+)"/)[1]);
      const alias = (body.messages[0].content.match(/#\d+ control_forever/) || ['#1'])[0].split(' ')[0];
      text = JSON.stringify({results: ids.map(id => ({id, pass: true, score: 50, reason: '有用重複無限次讓角色一直動', evidence: [alias]})), summary: '很棒！'});
    } else text = JSON.stringify({type: 'program', sprites: [{name: 'Sprite1', scripts: [[{opcode: 'event_whenflagclicked'}, {opcode: 'control_forever', substacks: {SUBSTACK: [{opcode: 'motion_turnright', inputs: {DEGREES: 5}}]}}]]}]});
    await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
      body: JSON.stringify({content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 100, output_tokens: 50}})});
  });
  let agnesBody = null;
  await p.route('https://apihub.agnes-ai.com/v1/images/generations', async route => {
    agnesBody = JSON.parse(route.request().postData());
    await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
      body: JSON.stringify({data: [{b64_json: pngBase64}]})});
  });

  await p.addInitScript(() => { try { localStorage.setItem('tw:language', 'zh-tw'); } catch (e) {} });
  await p.goto(`${BASE_URL}editor.html`);
  await p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());
  const blankSb3 = await p.evaluate(async () => Array.from(new Uint8Array(await window.scratchAI.vm.saveProjectSb3('arraybuffer'))));
  fs.writeFileSync(`${OUT}/blank.sb3`, Buffer.from(blankSb3));
  await p.click('text=✨ AI 助手');
  await p.click('nav >> text=設定');
  await p.fill('input[placeholder="貼上你的 KEY"]', 'sk-test');
  const imageKey = p.locator('h3:has-text("AI 生圖") + label + input');
  await imageKey.fill('agnes-key');

  // --- generate a small program first
  await p.click('nav >> text=產生積木');
  await p.fill('textarea', '讓角色一直轉');
  await p.click('button:has-text("送出")');
  await p.click('button:has-text("套用到專案")');
  await p.waitForSelector('text=✓ 已套用');

  // --- AI image
  await p.click('nav >> text=AI 生圖');
  await p.fill('textarea', '紅色的球');
  await p.click('button:has-text("開始畫")');
  await p.waitForSelector('button:has-text("加入造型")', {timeout: 20000});
  await p.screenshot({path: `${OUT}/e2e-image.png`});
  const before = await p.evaluate(() => window.scratchAI.vm.editingTarget.getCostumes().length);
  await p.click('button:has-text("加入造型")');
  await p.waitForSelector('text=已加入', {timeout: 10000});
  const costume = await p.evaluate(() => {
    const t = window.scratchAI.vm.editingTarget; const c = t.getCostumes()[t.getCostumes().length - 1];
    return {count: t.getCostumes().length, name: c.name, format: c.dataFormat, res: c.bitmapResolution, size: c.size, center: [c.rotationCenterX, c.rotationCenterY]};
  });
  console.log('image', JSON.stringify({before, costume, prompt: agnesBody.prompt.slice(0, 60), size: agnesBody.size}));

  // --- self check with free text
  await p.click('nav >> text=自我檢查');
  await p.fill('textarea', '角色會一直轉圈');
  await p.click('button:has-text("開始檢查")');
  await p.waitForSelector('text=很棒！', {timeout: 20000});
  await p.click('button:has-text("Sprite1：")');
  await p.waitForTimeout(800);
  await p.screenshot({path: `${OUT}/e2e-grade.png`});

  // --- teacher mode, template, batch grading
  await p.click('nav >> text=設定');
  await p.fill('input[placeholder="PIN"]', '1234');
  await p.click('button:has-text("老師模式")');
  await p.waitForSelector('nav >> text=批次');
  await p.click('nav >> text=範本');
  await p.click('button:has-text("新增範本")');
  await p.click('button:has-text("+ AI 項目")');
  await p.locator('input[placeholder="這一項的說明（學生會看到）"]').nth(1).fill('角色會轉圈');
  await p.click('button:has-text("儲存範本")');
  await p.screenshot({path: `${OUT}/e2e-templates.png`});

  const sb3 = await p.evaluate(async () => Array.from(new Uint8Array(await window.scratchAI.vm.saveProjectSb3('arraybuffer'))));
  fs.writeFileSync(`${OUT}/01_王小明.sb3`, Buffer.from(sb3));
  await p.click('nav >> text=批次');
  await p.setInputFiles('input[type=file][accept=".sb3,.zip"]', [
    {name: '01_王小明.sb3', mimeType: 'application/x.scratch.sb3', buffer: Buffer.from(sb3)},
    {name: '02_李小華.sb3', mimeType: 'application/x.scratch.sb3', buffer: fs.readFileSync(`${OUT}/blank.sb3`)},
    {name: 'notes.png', mimeType: 'image/png', buffer: fs.readFileSync(`${OUT}/e2e-image.png`)}
  ]);
  await p.click('button:has-text("開始批改")');
  await p.waitForSelector('button:has-text("下載報告（zip）")', {timeout: 20000});
  await p.screenshot({path: `${OUT}/e2e-batch.png`});
  const [download] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("下載報告（zip）")')]);
  await download.saveAs(`${OUT}/report.zip`);
  console.log('download', download.suggestedFilename());
  console.log('anthropic calls', anthropicCalls.length);
  console.log('errors', errors);
  await b.close();
})();
