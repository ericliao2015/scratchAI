/* eslint-disable */
// Browser test for AI sound effects and loop music.
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');

const reply = body => {
  const system = Array.isArray(body.system) ? body.system.map(b => b.text).join('') : body.system;
  if (system.includes('game sound effects')) return {name: '冰凍魔法', params: {wave: 'triangle', freq: 1800, freqEnd: 600, duration: 0.7, vibratoDepth: 1}};
  if (system.includes('background LOOPS')) return {bpm: 96, bars: 4, tracks: [{instrument: 'bell', notes: [[0, 1, 'E5'], [1, 1, 'G5'], [2, 2, 'B5']]}]};
  return {type: 'program', sprites: []};
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
  await p.click('nav >> text=AI 音樂');
  const result = {};

  // Preset effect -> add to sprite.
  await p.click('button:has-text("金幣")');
  await p.waitForSelector('section audio');
  result.audioDuration = await p.$eval('section audio', a => new Promise(r => {
    if (a.readyState >= 1) r(a.duration); else a.addEventListener('loadedmetadata', () => r(a.duration));
  }));
  await p.click('button:has-text("加入專案")');
  await p.waitForSelector('text=/已加入「金幣」到/');

  // AI-designed effect.
  await p.fill('input[placeholder="例如：小精靈施放冰凍魔法"]', '冰凍魔法');
  await p.click('button:has-text("AI 設計")');
  await p.waitForFunction(() => document.querySelector('section input[value="冰凍魔法"]') || [...document.querySelectorAll('section input')].some(i => i.value === '冰凍魔法'));
  await p.click('button:has-text("加入專案")');
  await p.waitForSelector('text=/已加入「冰凍魔法」到/');

  // Loop music on the stage with loop blocks.
  await p.click('button:has-text("背景音樂（循環）")');
  await p.selectOption('section select >> nth=1', 'adventure');
  const t0 = Date.now();
  await p.click('button:has-text("快速產生")');
  await p.waitForSelector('section audio');
  result.quickMs = Date.now() - t0;
  await p.check('input[name="audio-target"] >> nth=1');
  await p.click('button:has-text("加入專案")');
  await p.waitForSelector('text=/已加入「冒險 loop」到舞台/');
  // AI compose
  await p.fill('input[placeholder="例如：在森林裡探險、魔王出現前"]', '森林探險');
  await p.click('button:has-text("AI 作曲")');
  await p.waitForFunction(() => !document.body.innerText.includes('AI 作曲中…'));
  await p.screenshot({path: `${OUT}/audio-tab.png`});

  result.state = await p.evaluate(() => {
    const vm = window.scratchAI.vm;
    const stage = vm.runtime.getTargetForStage();
    const sprite = vm.runtime.targets.find(t => t.isOriginal && !t.isStage);
    return {
      spriteSounds: sprite.getSounds().map(s => s.name),
      stageSounds: stage.getSounds().map(s => `${s.name}:${s.rate}:${Math.round(s.sampleCount / s.rate)}s`),
      stageOpcodes: Object.values(stage.blocks._blocks).map(b => b.opcode).filter(o => !o.endsWith('_menu'))
    };
  });
  result.errors = errors;
  console.log(JSON.stringify(result, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
