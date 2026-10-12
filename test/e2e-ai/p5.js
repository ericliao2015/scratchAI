/* eslint-disable */
// Browser test for P5/P6: class gateway (Node server + mock upstream), teacher classroom tab,
// student settings, generation through the gateway, hand-in, usage and batch hand-off, local model option.
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');
const http = require('http');
const path = require('path');
const {spawn} = require('child_process');

const UPSTREAM_PORT = 8798;
const GATEWAY_PORT = 8797;
const GATEWAY = `http://localhost:${GATEWAY_PORT}`;

// OpenAI-compatible mock model behind the gateway.
const upstreamCalls = [];
const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    upstreamCalls.push({url: req.url, auth: req.headers.authorization});
    res.writeHead(200, {'Content-Type': 'application/json'});
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({data: [{id: 'mock-model'}]}));
    const program = {type: 'program', explanation: '往右走', sprites: [{name: 'Sprite1', scripts: [[
      {opcode: 'event_whenflagclicked'}, {opcode: 'motion_movesteps', inputs: {STEPS: 10}}]]}]};
    res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(program)}, finish_reason: 'stop'}],
      usage: {prompt_tokens: 1200, completion_tokens: 80}}));
  });
}).listen(UPSTREAM_PORT);

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const gateway = spawn(process.execPath, [path.join(__dirname, '../../server/node.js')], {
    env: {...process.env, PORT: String(GATEWAY_PORT), DATA_DIR: ':memory:', ADMIN_TOKEN: 'teacher-secret',
      ALLOWED_ORIGINS: '*', COMPATIBLE_URL: `http://localhost:${UPSTREAM_PORT}/v1`, COMPATIBLE_KEY: 'up-key',
      NODE_OPTIONS: '--no-warnings'},
    stdio: 'inherit'
  });
  await sleep(1200);
  const b = await chromium.launch(launchOptions);
  const result = {};
  try {
    const p = await b.newPage({viewport: {width: 1400, height: 900}});
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(() => { try { localStorage.setItem('tw:language', 'zh-tw'); localStorage.setItem('scratchai:self-test', 'off'); } catch (e) {} });
    await p.goto(`${BASE_URL}editor.html`);
    await p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());
    await p.click('text=/✨ AI/');

    // Teacher: connect and create a class.
    await p.evaluate(() => window.scratchAI.host.setModeState({...window.scratchAI.host.state.modeState, mode: 'teacher'}));
    await p.click('nav >> text=班級');
    await p.fill('input[placeholder="https://blockai-gateway.example.workers.dev"]', process.env.GW || 'http://localhost:8797');
    await p.fill('input[type=password]', 'teacher-secret');
    await p.click('button:text-is("連線")');
    await p.waitForSelector('text=還沒有班級');
    await p.click('summary:has-text("+ 新增班級")');
    await p.fill('section details input >> nth=0', '六年甲班');
    await p.fill('section details textarea', 'compatible/mock-model');
    await p.click('button:has-text("建立班級")');
    await p.waitForSelector('text=/六年甲班（代碼 [A-Z0-9]{6}）/');
    const code = (await p.textContent('text=/六年甲班（代碼 [A-Z0-9]{6}）/')).match(/代碼 ([A-Z0-9]{6})/)[1];
    result.code = code;

    // Student: settings -> class gateway.
    await p.evaluate(() => window.scratchAI.host.setModeState({...window.scratchAI.host.state.modeState, mode: 'student'}));
    await p.click('nav >> text=設定');
    await p.selectOption('section select >> nth=0', 'gateway');
    await p.fill('input[placeholder="https://blockai-gateway.example.workers.dev"]', 'http://localhost:8797');
    await p.fill('input[placeholder="ABC234"]', code.toLowerCase());
    await p.fill('input[placeholder="例如：05"]', '07');
    await p.click('button:has-text("載入清單")');
    await p.waitForSelector('text=已載入 1 個模型');
    result.cloudSection = await p.isVisible('text=雲端專案（班級閘道）');
    // local model option is listed; headless Chromium has no WebGPU
    await p.selectOption('section select >> nth=0', 'webllm');
    result.webgpuWarning = await p.isVisible('text=這個瀏覽器不支援 WebGPU，無法使用本機模型。');
    await p.screenshot({path: `${OUT}/p5-webllm.png`});
    await p.selectOption('section select >> nth=0', 'gateway');

    // Generate through the gateway.
    await p.click('nav >> text=產生積木');
    await p.fill('section textarea', '往右走');
    await p.click('button:has-text("送出")');
    await p.click('button:has-text("套用到專案")');
    await p.waitForSelector('text=✓ 已套用');
    result.upstreamAuth = upstreamCalls.filter(c => c.url.endsWith('/chat/completions')).map(c => c.auth)[0];

    // Hand in.
    await p.click('nav >> text=自我檢查');
    await p.click('button:has-text("繳交給老師")');
    await p.waitForSelector('text=/已繳交/');

    // Cloud save.
    await p.click('nav >> text=設定');
    await p.fill('input[placeholder="專案名稱"]', '我的第一個遊戲');
    await p.click('button:has-text("存到雲端")');
    await p.waitForSelector('text=已存到雲端：我的第一個遊戲');

    // Teacher sees usage and the submission, sends it to batch grading.
    await p.evaluate(() => window.scratchAI.host.setModeState({...window.scratchAI.host.state.modeState, mode: 'teacher'}));
    await p.click('nav >> text=班級');
    await p.waitForSelector('text=/六年甲班 · /');
    await p.click('button:has-text("六年甲班 · ")');
    await p.waitForSelector('text=繳交的作業（1）');
    result.usageRow = await p.textContent('table >> nth=0');
    await p.screenshot({path: `${OUT}/p5-classroom.png`, fullPage: true});
    await p.click('button:has-text("全部送到批次批改")');
    await p.waitForTimeout(800);
    result.batchFiles = await p.textContent('section');
    result.batchHasFile = result.batchFiles.includes('已選擇 1 份作業');
    result.errors = errors;
  } finally {
    await b.close();
    gateway.kill();
    upstream.close();
  }
  delete result.batchFiles;
  console.log(JSON.stringify(result, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
