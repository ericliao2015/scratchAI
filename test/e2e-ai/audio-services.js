/* eslint-disable */
// Browser test for AI audio services: disabled buttons explain why, Lyria music and ElevenLabs effects (mocked).
const OUT = process.env.OUT || require('os').tmpdir();
const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/scratchAI/';
const launchOptions = process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {};
const {chromium} = require('playwright');

// 35 s stereo 44.1 kHz WAV, as a stand-in for Lyria's MP3.
const wav = (seconds, rate, channels) => {
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2 * channels);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2 * channels, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2 * channels, 28); buf.writeUInt16LE(2 * channels, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2 * channels, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) buf.writeInt16LE(Math.round(Math.sin(i / 20 + c) * 12000), 44 + (i * channels + c) * 2);
  return buf;
};
const pcm = seconds => { const n = Math.round(seconds * 22050); const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 15000 * (1 - i / n)), i * 2); return b; };

(async () => {
  const b = await chromium.launch(launchOptions);
  const p = await b.newPage({viewport: {width: 1400, height: 900}});
  const errors = [];
  const requests = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.route('https://generativelanguage.googleapis.com/**', route => {
    requests.push({url: route.request().url(), key: route.request().headers()['x-goog-api-key'], body: JSON.parse(route.request().postData())});
    route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'},
      body: JSON.stringify({candidates: [{content: {parts: [{inlineData: {mimeType: 'audio/wav', data: wav(35, 44100, 2).toString('base64')}}]}}]})});
  });
  await p.route('https://api.elevenlabs.io/**', route => {
    requests.push({url: route.request().url(), key: route.request().headers()['xi-api-key'], body: JSON.parse(route.request().postData())});
    route.fulfill({status: 200, contentType: 'application/octet-stream', headers: {'access-control-allow-origin': '*'}, body: pcm(1.2)});
  });
  await p.addInitScript(() => { try { localStorage.setItem('tw:language', 'zh-tw'); } catch (e) {} });
  await p.goto(`${BASE_URL}editor.html`);
  await p.waitForFunction(() => window.scratchAI && window.ScratchBlocks && window.ScratchBlocks.getMainWorkspace());
  await p.click('text=/✨ AI/');
  await p.click('nav >> text=AI 音樂');
  const result = {};

  // No text model, built-in synth: the AI button is visible but disabled, with the reason.
  await p.fill('input[placeholder="例如：小精靈施放冰凍魔法"]', '雷聲');
  result.synthDisabled = await p.isDisabled('button:text-is("AI 設計")');
  result.synthReason = await p.isVisible('text=ⓘ 要先到「設定」設定 AI 模型（文字模型）');

  // Lyria without a key: disabled with reason; then with the key in settings.
  await p.selectOption('section select >> nth=0', 'lyria');
  await p.click('button:has-text("背景音樂（循環）")');
  result.lyriaDisabled = await p.isDisabled('button:text-is("AI 產生音樂")');
  result.lyriaReason = await p.isVisible('text=/ⓘ 要先到「設定 → AI 音效／音樂」填入 Gemini KEY/');
  await p.evaluate(() => {
    const s = window.scratchAI.host.state.settings;
    window.scratchAI.host.updateSettings({...s, providers: {...s.providers, gemini: {...s.providers.gemini, apiKey: 'gem-key'}}});
  });
  await p.selectOption('section select >> nth=1', 'space');
  await p.fill('input[placeholder="例如：在森林裡探險、魔王出現前"]', '外星人來了');
  await p.click('button:text-is("AI 產生音樂")');
  await p.waitForSelector('section audio', {timeout: 30000});
  result.musicSeconds = await p.textContent('text=/^\\d+\\.\\d 秒$/');
  result.lyriaRequest = {url: requests[0].url, key: requests[0].key, prompt: requests[0].body.contents[0].parts[0].text.slice(0, 80)};
  await p.check('input[name="audio-target"] >> nth=1');
  await p.click('button:has-text("加入專案")');
  await p.waitForSelector('text=/已加入「太空 AI loop」到舞台/');

  // ElevenLabs sound effect.
  await p.selectOption('section select >> nth=0', 'elevenlabs');
  await p.evaluate(() => {
    const s = window.scratchAI.host.state.settings;
    window.scratchAI.host.updateSettings({...s, audio: {...s.audio, elevenlabsKey: 'el-key'}});
  });
  await p.click('button:text-is("音效")');
  await p.fill('input[placeholder="例如：小精靈施放冰凍魔法"]', '冰凍魔法');
  await p.click('button:text-is("AI 產生")');
  await p.waitForSelector('section audio', {timeout: 30000});
  await p.click('button:has-text("加入專案")');
  await p.waitForSelector('text=/已加入「冰凍魔法」到/');
  result.elevenRequest = {url: requests[1].url, key: requests[1].key, text: requests[1].body.text};
  await p.screenshot({path: `${OUT}/audio-services.png`});

  result.state = await p.evaluate(() => {
    const vm = window.scratchAI.vm;
    const fmt = s => `${s.name}:${(s.sampleCount / s.rate).toFixed(1)}s`;
    return {stage: vm.runtime.getTargetForStage().getSounds().map(fmt),
      sprite: vm.runtime.targets.find(t => t.isOriginal && !t.isStage).getSounds().map(fmt)};
  });
  result.errors = errors;
  console.log(JSON.stringify(result, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
