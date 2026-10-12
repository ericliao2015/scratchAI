/* eslint-disable */
// Browser test for block preview, Ctrl+Z undo, panel collapse and the English UI.
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');

const PROGRAM = {
  type: 'program', explanation: 'Spin forever.',
  stage: {variables: [{name: 'speed', value: 3}]},
  sprites: [{name: 'Sprite1', scripts: [[
    {opcode: 'event_whenkeypressed', fields: {KEY_OPTION: 'space'}},
    {opcode: 'control_repeat', inputs: {TIMES: 10}, substacks: {SUBSTACK: [{opcode: 'motion_turnright', inputs: {DEGREES: {var: 'speed'}}}]}}
  ]]}]
};

const run = async (locale) => {
  const b = await chromium.launch(launchOptions);
  const p = await b.newPage({viewport: {width: 1400, height: 900}});
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://api.anthropic.com/v1/messages', route => route.fulfill({status: 200, contentType: 'application/json',
    headers: {'access-control-allow-origin': '*'},
    body: JSON.stringify({content: [{type: 'text', text: JSON.stringify(PROGRAM)}], stop_reason: 'end_turn',
      usage: {input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 6000}})}));
  await p.addInitScript(l => { try { localStorage.setItem('tw:language', l); } catch (e) {} }, locale);
  await p.goto(`${BASE_URL}editor.html${locale === 'en' ? '?locale=en' : ''}`);
  await p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());
  await p.click('text=/✨ AI/');
  const tabs = await p.$$eval('nav button', els => els.map(e => e.textContent));
  await p.evaluate(() => window.scratchAI.host.updateSettings({...window.scratchAI.host.state.settings,
    providers: {...window.scratchAI.host.state.settings.providers, anthropic: {apiKey: 'x', model: 'claude-opus-5-5', models: []}}}));
  await p.fill('section textarea', 'spin');
  await p.keyboard.press('Control+Enter');
  await p.waitForSelector('section .blocklySvg', {timeout: 15000});
  await p.waitForTimeout(500);
  await p.screenshot({path: `${OUT}/p1-preview-${locale}.png`});
  const previewBlocks = await p.$$eval('section .blocklyDraggable', els => els.length);
  const before = await p.evaluate(() => Object.keys(window.scratchAI.vm.editingTarget.blocks._blocks).length);
  await p.click(locale === 'en' ? 'button:has-text("Apply to project")' : 'button:has-text("套用到專案")');
  await p.waitForTimeout(800);
  const after = await p.evaluate(() => ({
    blocks: Object.keys(window.scratchAI.vm.editingTarget.blocks._blocks).length,
    speed: Object.values(window.scratchAI.vm.runtime.getTargetForStage().variables).find(v => v.name === 'speed')
  }));
  const ctrlZHint = await p.isVisible(locale === 'en' ? 'text=Ctrl+Z' : 'text=也可以按 Ctrl+Z 復原。');
  await p.click('.injectionDiv .blocklyMainBackground', {position: {x: 500, y: 450}, force: true});
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(800);
  const undoneByKey = await p.evaluate(() => Object.keys(window.scratchAI.vm.editingTarget.blocks._blocks).length);
  const undoStack = await p.evaluate(() => window.ScratchBlocks.getMainWorkspace().undoStack_.length);
  await p.evaluate(() => window.ScratchBlocks.getMainWorkspace().undo(false));
  await p.waitForTimeout(500);
  const undone = await p.evaluate(() => Object.keys(window.scratchAI.vm.editingTarget.blocks._blocks).length);
  console.log('undo', {undoneByKey, undoStack, undone, active: await p.evaluate(() => document.activeElement && document.activeElement.tagName)});
  // collapse
  await p.click('section header button >> nth=0');
  const collapsedHeight = await p.$eval('section[aria-label]', el => el.getBoundingClientRect().height);
  await p.screenshot({path: `${OUT}/p1-collapsed-${locale}.png`});
  console.log(locale, JSON.stringify({tabs, previewBlocks, before, after: after.blocks, speed: after.speed && after.speed.value, ctrlZHint, undone, collapsedHeight, errors}));
  await b.close();
};

(async () => { await run('zh-tw'); await run('en'); })();
