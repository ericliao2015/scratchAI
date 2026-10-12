/* eslint-disable */
// Browser end-to-end test for the AI panel. AI APIs are mocked with page.route().
// Usage: build with ROOT=/scratchAI/, serve the parent of build/ as /scratchAI/, then
//   BASE_URL=http://localhost:8765/scratchAI/ node test/e2e-ai/<file>.js
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');
(async () => {
  const b = await chromium.launch(launchOptions);
  const p = await b.newPage({viewport: {width: 1400, height: 900}});
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.route('**/weather-extension.js', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: require('fs').readFileSync(`${__dirname}/weather-extension.js`, 'utf8')}));
  await p.goto(`${BASE_URL}editor.html`);
  await p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());
  const out = await p.evaluate(async extensionUrl => {
    const vm = window.scratchAI.vm;
    await vm.extensionManager.loadExtensionURL('pen');
    await vm.extensionManager.loadExtensionURL(extensionUrl);
    await new Promise(r => setTimeout(r, 1500));
    const catalog = window.scratchAI.getCatalog();
    const pick = op => catalog.blocks[op];
    return {
      pen: !!pick('pen_clear'), penColor: pick('pen_setPenColorParamTo'),
      ext: Object.keys(catalog.blocks).filter(k => k.startsWith('weathertest')),
      temp: pick('weathertest_temperature'), unit: pick('weathertest_setUnit'),
      cats: catalog.categories.map(c => `${c.id}:${c.count}${c.extension ? '*' : ''}`).join(' ')
    };
  }, `${new URL(BASE_URL).origin}/weather-extension.js`);
  console.log(JSON.stringify(out, null, 1).slice(0, 3000));
  // Compile and apply a program that uses both extensions through the real panel code path.
  const result = await p.evaluate(async () => {
    const host = window.scratchAI.host;
    const {vm} = window.scratchAI;
    const ir = {sprites: [{name: 'Sprite1', scripts: [[
      {opcode: 'event_whenflagclicked'},
      {opcode: 'pen_clear'},
      {opcode: 'pen_setPenColorParamTo', inputs: {COLOR_PARAM: 'brightness', VALUE: 50}},
      {opcode: 'weathertest_setUnit', inputs: {UNIT: 'F', N: 2}},
      {opcode: 'looks_say', inputs: {MESSAGE: {opcode: 'weathertest_temperature', inputs: {CITY: 'Tainan'}}}}
    ]]}]};
    // Replace the AI client with a fake one returning the IR.
    const fake = {complete: async () => ({text: JSON.stringify(ir), usage: {}, model: 'fake'})};
    host.client.complete = fake.complete;
    return true;
  });
  console.log('fake client installed', result);
  await p.click('text=✨ AI 助手');
  await p.evaluate(() => window.scratchAI.host.updateSettings({...window.scratchAI.host.state.settings,
    providers: {...window.scratchAI.host.state.settings.providers, anthropic: {apiKey: 'x', model: 'claude-opus-5-5', models: []}}}));
  await p.fill('textarea', '用畫筆和天氣擴充');
  await p.click('button:has-text("送出")');
  await p.waitForSelector('button:has-text("套用到專案")', {timeout: 15000}).catch(async () => console.log(await p.evaluate(() => document.querySelector('section[aria-label="AI 助手"]').innerText)));
  await p.click('button:has-text("套用到專案")');
  await p.waitForSelector('text=✓ 已套用', {timeout: 15000});
  await p.waitForTimeout(800);
  await p.screenshot({path: `${OUT}/e2e-ext.png`});
  const opcodes = await p.evaluate(() => Object.values(window.scratchAI.vm.editingTarget.blocks._blocks).map(b => b.opcode).sort());
  console.log(opcodes.join(' '));
  console.log('errors', errors);
  await b.close();
})();
