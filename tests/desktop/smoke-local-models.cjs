'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('playwright/test');
const { sourceElectronExecutable } = require('./test-runtime.cjs');

const ROOT = path.resolve(__dirname, '../..');
const executable = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || process.env.SOLUTION_TOOL_EXECUTABLE || process.env.BID_EXECUTABLE;
const run = path.join(ROOT, '.cache', 'validation', 'local-models-smoke-' + Date.now());
const profile = path.join(run, 'profile');
fs.mkdirSync(profile, { recursive: true });
const report = { run, packaged: Boolean(executable), checks: [], errors: [] };
const calls = [];
const servers = [];
const modes = { ollama: 'models', lmstudio: 'models', openai: 'models' };
const localToken = 'synthetic-local-session-token';
const cloudToken = 'synthetic-cloud-session-key';
const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWioAAAAASUVORK5CYII=';
const settingsKey = 'cavwic-lab-model-settings';
const projectKey = 'cavwic-solution-workspace';
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'skill-workspace', 'projects', 'fixture-project', 'project.json'), 'utf8'));
fixture.bidFileChecklist = [{ id: 'local-model-smoke', title: '技术方案', category: 'technical', notes: '虚构本地服务验收', status: 'pending', outputFormat: 'md', templateSourceIds: [], selectedTemplateSourceIds: [], referenceSourceIds: [], selectedReferenceSourceIds: [], detailRequirements: '仅使用虚构内容。', generatedFiles: [] }];
let application;
const passed = name => { report.checks.push(name); console.log('PASS ' + name); };
const localCard = page => page.getByTestId('model-channel-local');
const modelInput = page => page.getByTestId('local-model');
const endpointInput = page => page.getByTestId('local-endpoint');
const runtimeInput = page => page.getByTestId('local-runtime');
const tokenInput = page => page.getByTestId('local-api-key');
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), settingsKey);
const read = async page => { await page.getByTestId('local-catalog-read').click(); await expect(page.getByTestId('local-catalog-read')).toBeEnabled(); };
const save = async page => { await page.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.model-settings-notice')).toHaveText('配置已保存。'); };

async function serverFor(runtime) {
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    calls.push({ runtime, method: request.method, url: request.url, authorization: request.headers.authorization || '', body });
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET') {
      if (modes[runtime] === 'error') { response.writeHead(503); response.end('{"error":{"message":"Synthetic service unavailable"}}'); return; }
      const models = modes[runtime] === 'empty' ? [] : [`${runtime}-fixture-a`, `${runtime}-fixture-b`];
      response.end(JSON.stringify(runtime === 'ollama' ? { models: models.map(name => ({ name, model: name, size: 1 })) } : { data: models.map(id => ({ id, object: 'model' })) }));
      return;
    }
    response.end(JSON.stringify(runtime === 'ollama'
      ? { model: body.model, done: true, message: { role: 'assistant', content: '# 虚构 Ollama 结果' } }
      : { model: body.model, choices: [{ message: { content: '# 虚构兼容服务结果' } }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function launch() {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: executable || sourceElectronExecutable(), args: executable ? [] : [ROOT], env, timeout: 30000 });
  const page = await application.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('model-mode-local').waitFor();
  return page;
}

async function screenshot(page, name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const data = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(run, name), Buffer.from(data, 'base64'));
}

async function noSecretStorage(page) {
  const data = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'));
  assert.equal(data.includes(localToken), false); assert.equal(data.includes(cloudToken), false);
}

(async () => {
  const [ollamaBase, lmBase, openaiBase] = await Promise.all(['ollama', 'lmstudio', 'openai'].map(serverFor));
  const endpoints = { ollama: ollamaBase + '/ollama/api/chat?fixture=1', lmstudio: lmBase + '/lm/v1', openai: openaiBase + '/custom/v1/chat/completions?fixture=1' };
  let page = await launch();
  await page.evaluate(({ fixture, projectKey }) => localStorage.setItem(projectKey, JSON.stringify(fixture)), { fixture, projectKey });
  await page.reload();
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  await page.getByRole('button', { name: '投标', exact: true }).click();
  await page.locator('.bid-output-summary').click();
  const originalUrl = page.url();
  await page.getByRole('radio', { name: '本地模型', exact: true }).click();
  await expect(localCard(page)).toBeVisible();
  await expect(runtimeInput(page)).toHaveValue('ollama');
  assert.equal(new URL(await endpointInput(page).inputValue()).port, '11434');
  await expect(modelInput(page)).toHaveValue('');
  await endpointInput(page).fill(endpoints.ollama);
  await tokenInput(page).fill(localToken);
  await read(page);
  await expect(page.getByTestId('local-catalog-select').locator('option[value="ollama-fixture-a"]')).toHaveCount(1);
  await expect(modelInput(page)).toHaveValue('');
  assert.equal(await localCard(page).locator('.model-test-status.verified').count(), 0);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(calls.at(-1).url, '/ollama/api/tags?fixture=1'); assert.equal(calls.at(-1).authorization, 'Bearer ' + localToken);
  await page.getByTestId('local-catalog-select').selectOption('ollama-fixture-a');
  await expect(modelInput(page)).toHaveValue('ollama-fixture-a');
  await save(page);
  assert.equal(await page.evaluate(() => window.bidDesktop.getLocalApiKey()), localToken);
  passed('本地模型点击即展开，Ollama 默认地址和自定义地址可用，读取目录不自动选模型、不伪造验证状态');

  await localCard(page).getByRole('button', { name: '测试生成', exact: true }).click();
  await expect(localCard(page).locator('.model-test-status')).toHaveText('生成测试通过');
  const ollamaText = calls.at(-1);
  assert.equal(ollamaText.url, '/ollama/api/chat?fixture=1'); assert.equal(ollamaText.body.model, 'ollama-fixture-a');
  assert.equal(ollamaText.body.stream, false); assert.equal(ollamaText.body.think, false);
  const ollamaImage = await page.evaluate(async ({ settingsKey, imageData }) => window.bidDesktop.modelChat({ settings: JSON.parse(localStorage.getItem(settingsKey)), apiKey: 'must-not-reach-local', prompt: '虚构图像识别验收', task: 'ocr', images: [imageData] }), { settingsKey, imageData });
  assert.deepEqual(ollamaImage, { content: '# 虚构 Ollama 结果', provider: 'local', model: 'ollama-fixture-a' });
  assert.deepEqual(calls.at(-1).body.messages.at(-1).images, [imageData.split(',')[1]]);
  assert.equal(calls.at(-1).authorization, 'Bearer ' + localToken);
  passed('Ollama 原生 /api/chat 文本与图像请求生效，图像发送纯 Base64，输出记录实际本地模型');

  await modelInput(page).fill('ollama-manual-id');
  modes.ollama = 'empty';
  await read(page);
  await expect(page.locator('.model-settings-notice')).toContainText('暂无可用模型');
  await expect(page.getByTestId('local-catalog-select')).toHaveCount(0);
  await expect(modelInput(page)).toHaveValue('ollama-manual-id');
  modes.ollama = 'error';
  await read(page);
  await expect(page.locator('.model-settings-notice')).toContainText('无法读取模型');
  await expect(modelInput(page)).toHaveValue('ollama-manual-id');
  assert.equal(await localCard(page).locator('.model-test-status.verified').count(), 0);
  modes.ollama = 'models';
  await save(page);
  passed('空目录与服务错误提供明确提示，手填模型和地址保留，旧目录与验证状态清除');

  await runtimeInput(page).selectOption('lmstudio');
  assert.equal(new URL(await endpointInput(page).inputValue()).port, '1234');
  await expect(modelInput(page)).toHaveValue('');
  await endpointInput(page).fill(endpoints.lmstudio); await modelInput(page).fill('lmstudio-manual-id');
  await read(page);
  await expect(modelInput(page)).toHaveValue('lmstudio-manual-id');
  assert.equal(calls.at(-1).url, '/lm/v1/models');
  await page.getByTestId('local-catalog-select').selectOption('lmstudio-fixture-b');
  await save(page);
  await localCard(page).getByRole('button', { name: '测试生成', exact: true }).click();
  await expect(localCard(page).locator('.model-test-status')).toHaveText('生成测试通过');
  assert.equal(calls.at(-1).url, '/lm/v1/chat/completions'); assert.equal(calls.at(-1).body.model, 'lmstudio-fixture-b');
  await runtimeInput(page).selectOption('ollama');
  await expect(endpointInput(page)).toHaveValue(endpoints.ollama); await expect(modelInput(page)).toHaveValue('ollama-manual-id');
  await runtimeInput(page).selectOption('lmstudio');
  await expect(endpointInput(page)).toHaveValue(endpoints.lmstudio); await expect(modelInput(page)).toHaveValue('lmstudio-fixture-b');
  passed('LM Studio 预设、/v1/models 与 Chat Completions 可用，服务切换分别保留地址和模型');

  await runtimeInput(page).selectOption('openai');
  assert.equal(new URL(await endpointInput(page).inputValue()).port, '8080');
  await endpointInput(page).fill(endpoints.openai); await modelInput(page).fill('openai-manual-id');
  await read(page);
  assert.equal(calls.at(-1).url, '/custom/v1/models?fixture=1');
  await expect(modelInput(page)).toHaveValue('openai-manual-id');
  await page.getByTestId('local-catalog-select').selectOption('openai-fixture-a');
  await save(page);
  const openaiImage = await page.evaluate(async ({ settingsKey, imageData }) => window.bidDesktop.modelChat({ settings: JSON.parse(localStorage.getItem(settingsKey)), apiKey: 'must-not-reach-local', prompt: '虚构兼容图像验收', task: 'ocr', images: [imageData] }), { settingsKey, imageData });
  assert.equal(openaiImage.provider, 'local'); assert.equal(openaiImage.model, 'openai-fixture-a');
  assert.equal(calls.at(-1).url, '/custom/v1/chat/completions?fixture=1');
  assert.equal(calls.at(-1).body.messages.at(-1).content[1].image_url.url, imageData);
  assert.equal(calls.at(-1).authorization, 'Bearer ' + localToken);
  passed('其他 OpenAI 兼容服务保留自定义路径与查询，模型目录和多模态 Chat Completions 请求正确');

  await page.getByRole('radio', { name: 'API', exact: true }).click();
  const cloud = page.getByTestId('model-channel-cloud');
  await cloud.getByLabel('接口地址', { exact: true }).fill(openaiBase + '/cloud/v1/chat/completions');
  await cloud.getByLabel('模型名称', { exact: true }).fill('cloud-fixture-model');
  await cloud.locator('input[type="password"]').fill(cloudToken); await save(page);
  await cloud.getByRole('button', { name: '测试生成', exact: true }).click();
  await expect(cloud.locator('.model-test-status')).toHaveText('生成测试通过');
  assert.equal(calls.at(-1).authorization, 'Bearer ' + cloudToken); assert.equal(calls.at(-1).url, '/cloud/v1/chat/completions');
  await page.getByRole('radio', { name: '本地模型', exact: true }).click();
  await expect(localCard(page)).toBeVisible();
  await expect(runtimeInput(page)).toHaveValue('openai');
  await tokenInput(page).fill(''); await read(page);
  assert.equal(calls.at(-1).authorization, '');
  assert.equal(await localCard(page).locator('.model-test-status.verified').count(), 0);
  await tokenInput(page).fill(localToken); await save(page); await read(page);
  assert.equal(calls.at(-1).authorization, 'Bearer ' + localToken);
  assert.equal(await page.evaluate(() => window.bidDesktop.getApiKey()), cloudToken);
  assert.equal(await page.evaluate(() => window.bidDesktop.getLocalApiKey()), localToken);
  await noSecretStorage(page);
  assert.equal(page.url(), originalUrl);
  await expect(page.locator('.stage-rail > button.active')).toHaveAccessibleName('投标');
  await expect(page.locator('.bid-output-summary')).toHaveAttribute('aria-expanded', 'true');
  passed('本地令牌与云 API 密钥隔离，空草稿令牌不会回落到旧密钥，目录和保存不离开当前项目或页面');

  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(1480, 960); win.webContents.setZoomFactor(1); });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await screenshot(page, 'local-services-1480.png');
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(760, 780); win.webContents.setZoomFactor(1.25); });
  for (const locale of ['zh', 'en']) {
    if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(async theme => { document.documentElement.dataset.theme = theme; await window.bidDesktop.setTheme(theme); }, theme);
      const geometry = await page.evaluate(() => ({ noOverflow: document.documentElement.scrollWidth <= innerWidth + 1, controls: [...document.querySelectorAll('.lab-header button')].map(element => { const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { name: element.textContent.trim() || element.id, inside: r.width > 0 && r.height > 0 && r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight, hit: hit === element || element.contains(hit) }; }) }));
      assert.equal(geometry.noOverflow, true);
      for (const control of geometry.controls) { assert.ok(control.inside, `${control.name} outside viewport`); assert.ok(control.hit, `${control.name} is covered`); }
      await screenshot(page, `local-services-760-125-${locale}-${theme}.png`);
    }
  }
  if (await page.locator('html').getAttribute('data-locale') !== 'zh') await page.locator('#global-locale-toggle').click();
  await page.reload(); await expect(page.locator('[data-ready="true"]')).toBeVisible();
  await page.getByRole('radio', { name: '本地模型', exact: true }).click();
  await expect(tokenInput(page)).toHaveValue(localToken);
  await expect(modelInput(page)).toHaveValue('openai-fixture-a');
  await noSecretStorage(page);
  passed('760 窄窗 125% 深浅中英文顶栏无溢出，重新加载保留本次会话令牌与配置');

  await application.close(); application = null;
  page = await launch();
  assert.equal(await page.evaluate(() => window.bidDesktop.getLocalApiKey()), '');
  assert.equal(await page.evaluate(() => window.bidDesktop.getApiKey()), '');
  await page.getByRole('radio', { name: '本地模型', exact: true }).click();
  await expect(tokenInput(page)).toHaveValue(''); await expect(runtimeInput(page)).toHaveValue('openai');
  await expect(endpointInput(page)).toHaveValue(endpoints.openai); await expect(modelInput(page)).toHaveValue('openai-fixture-a');
  await runtimeInput(page).selectOption('ollama'); await expect(endpointInput(page)).toHaveValue(endpoints.ollama); await expect(modelInput(page)).toHaveValue('ollama-manual-id');
  await runtimeInput(page).selectOption('lmstudio'); await expect(endpointInput(page)).toHaveValue(endpoints.lmstudio); await expect(modelInput(page)).toHaveValue('lmstudio-fixture-b');
  const project = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), projectKey);
  assert.equal(project.id, fixture.id); assert.equal(project.name, fixture.name); assert.equal(project.bidFileChecklist[0].generatedFiles.length, 0);
  await noSecretStorage(page);
  passed('重启清空本地令牌与云密钥，三个服务地址和模型、项目内容完整保留');
  assert.deepEqual(report.errors, []); report.success = true;
})().catch(async error => {
  report.success = false; report.failure = error.stack || String(error); process.exitCode = 1; console.error(report.failure);
  if (application) { const page = await application.firstWindow(); await screenshot(page, 'failure.png').catch(() => {}); fs.writeFileSync(path.join(run, 'failure.html'), await page.content()); }
}).finally(async () => {
  if (application) await application.close().catch(() => {});
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify({ ...report, calls: calls.map(({ authorization, body, ...call }) => ({ ...call, model: body?.model, credential: authorization === 'Bearer ' + localToken ? 'local-session' : authorization === 'Bearer ' + cloudToken ? 'cloud-session' : authorization ? 'unexpected' : 'none' })) }, null, 2));
  console.log('Report: ' + path.join(run, 'report.json'));
});
