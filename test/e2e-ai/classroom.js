/* eslint-disable */
// Browser end-to-end test: batch modification and class configuration files.
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const fs = require('fs');
const JSZip = require('@turbowarp/jszip');
const {chromium} = require('playwright');

const ANSWER = {
  type: 'program',
  explanation: '每份作業都加入按空白鍵跳躍的程式。',
  sprites: [{name: 'Sprite1', scripts: [[
    {opcode: 'event_whenkeypressed', fields: {KEY_OPTION: 'space'}},
    {opcode: 'control_repeat', inputs: {TIMES: 10}, substacks: {SUBSTACK: [{opcode: 'motion_changeyby', inputs: {DY: 10}}]}},
    {opcode: 'control_repeat', inputs: {TIMES: 10}, substacks: {SUBSTACK: [{opcode: 'motion_changeyby', inputs: {DY: -10}}]}}
  ]]}]
};

const ready = p => p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());

(async () => {
  const b = await chromium.launch(launchOptions);
  const ctx = await b.newContext({viewport: {width: 1400, height: 900}, acceptDownloads: true});
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  let calls = 0;
  await p.route('https://api.anthropic.com/v1/messages', async route => {
    calls++;
    await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
      body: JSON.stringify({content: [{type: 'text', text: JSON.stringify(ANSWER)}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}})});
  });
  await p.addInitScript(() => { try { localStorage.setItem('tw:language', 'zh-tw'); } catch (e) {} });
  await p.goto(`${BASE_URL}editor.html`);
  await ready(p);
  const sb3 = Buffer.from(await p.evaluate(async () => Array.from(new Uint8Array(await window.scratchAI.vm.saveProjectSb3('arraybuffer')))));

  await p.click('text=✨ AI 助手');
  await p.click('nav >> text=設定');
  await p.fill('input[placeholder="貼上你的 KEY"]', 'sk-test');
  await p.fill('input[placeholder="PIN"]', '2468');
  await p.click('button:has-text("老師模式")');
  await p.waitForSelector('nav >> text=批次');

  // --- batch modify, unified
  await p.click('nav >> text=批次');
  await p.click('button:has-text("批次修改")');
  await p.setInputFiles('input[type=file][accept=".sb3,.zip"]', [
    {name: '01_甲.sb3', mimeType: 'application/octet-stream', buffer: sb3},
    {name: '02_乙.sb3', mimeType: 'application/octet-stream', buffer: sb3},
    {name: '03_丙.sb3', mimeType: 'application/octet-stream', buffer: sb3}
  ]);
  await p.fill('textarea', '每份都加入按空白鍵跳躍');
  await p.click('button:has-text("先用第一份預覽")');
  await p.waitForSelector('text=以「01_甲.sb3」為範例產生', {timeout: 20000});
  await p.click('button:has-text("套用到全部 3 份")');
  await p.waitForSelector('button:has-text("下載修改結果（zip）")', {timeout: 30000});
  await p.screenshot({path: `${OUT}/e2e-batch-modify.png`});
  const [download] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("下載修改結果（zip）")')]);
  const zipPath = `${OUT}/modified.zip`;
  await download.saveAs(zipPath);
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
  const project = await JSZip.loadAsync(await zip.file('projects/02_乙.sb3').async('nodebuffer'));
  const json = JSON.parse(await project.file('project.json').async('string'));
  const opcodes = Object.values(json.targets[1].blocks).map(b => b.opcode);
  console.log('zip', names.join(', '));
  console.log('modified project has jump script:', opcodes.includes('event_whenkeypressed'), 'AI calls:', calls);

  // --- class config: exam mode
  await p.click('nav >> text=範本');
  await p.fill('h3:has-text("班級設定檔") ~ input >> nth=0', '五年一班');
  await p.check('text=考試模式（關閉 AI 產生積木與生圖）');
  const [configDownload] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("匯出 class.json")')]);
  const configPath = `${OUT}/class.json`;
  await configDownload.saveAs(configPath);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('class config', JSON.stringify({name: config.name, exam: config.exam, hasPin: !!config.teacherPinHash, keys: JSON.stringify(config).includes('sk-test')}));

  // --- student imports the config in a fresh browser profile
  const student = await (await b.newContext({viewport: {width: 1400, height: 900}})).newPage();
  await student.addInitScript(() => { try { localStorage.setItem('tw:language', 'zh-tw'); } catch (e) {} });
  await student.goto(`${BASE_URL}editor.html`);
  await ready(student);
  await student.click('text=✨ AI 助手');
  await student.click('nav >> text=設定');
  await student.setInputFiles('text=匯入班級設定檔 >> input[type=file]', {name: 'class.json', mimeType: 'application/json', buffer: fs.readFileSync(configPath)});
  await student.waitForSelector('text=已套用班級設定：五年一班');
  const tabs = await student.$$eval('nav button', els => els.map(e => e.textContent));
  await student.fill('input[placeholder="PIN"]', '0000');
  await student.click('button:has-text("老師模式")');
  const wrongPin = await student.isVisible('text=PIN 不正確');
  await student.click('nav >> text=產生積木');
  const examMessage = await student.isVisible('text=考試模式：AI 產生積木已關閉。');
  await student.screenshot({path: `${OUT}/e2e-student-exam.png`});
  console.log('student', JSON.stringify({tabs, wrongPin, examMessage}));
  console.log('errors', errors);
  await b.close();
})();
