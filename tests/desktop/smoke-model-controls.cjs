'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('playwright/test');
const { sourceElectronExecutable } = require('./test-runtime.cjs');
const { collectWorkbenchLayout, assertWorkbenchLayout } = require('./layout-contract.cjs');

const ROOT = path.resolve(__dirname, '../..');
const executable = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || process.env.SOLUTION_TOOL_EXECUTABLE || process.env.BID_EXECUTABLE;
const run = path.join(ROOT, '.cache', 'validation', 'model-controls-smoke-' + Date.now());
const profile = path.join(run, 'profile');
const workspace = path.join(run, '虚构验证项目');
fs.mkdirSync(workspace, { recursive: true });
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'skill-workspace', 'projects', 'fixture-project', 'project.json'), 'utf8'));
fixture.bidFileChecklist = [{ id: 'model-smoke', title: '技术方案', category: 'technical', notes: '虚构 UI 测试', status: 'pending', outputFormat: 'md', templateSourceIds: [], selectedTemplateSourceIds: [], referenceSourceIds: [], selectedReferenceSourceIds: [], detailRequirements: '仅使用虚构测试内容。', generatedFiles: [] }];
const report = { run, packaged: Boolean(executable), checks: [], errors: [] };
const calls = [];
let failLocal = false;
let application;
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const provider = request.url.startsWith('/local/') ? 'local' : 'cloud';
  calls.push({ provider, model: body.model, authorization: request.headers.authorization || '' });
  response.writeHead(provider === 'local' && failLocal ? 503 : 200, { 'Content-Type': 'application/json' });
  response.end(provider === 'local' && failLocal ? '{"error":{"message":"Synthetic local failure"}}' : JSON.stringify({ model: body.model, choices: [{ message: { content: `# 技术方案\n\n虚构 ${provider} 模型验证。` } }] }));
});
const passed = name => { report.checks.push(name); console.log('PASS ' + name); };
const settingsKey = 'cavwic-lab-model-settings';
const projectKey = 'cavwic-solution-workspace';

async function launch() {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: executable || sourceElectronExecutable(), args: executable ? [] : [ROOT], env, timeout: 30000 });
  const page = await application.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 20000 });
  return page;
}

async function storedSettings(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), settingsKey); }
async function project(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), projectKey); }
async function screenshot(name) {
  const page = await application.firstWindow();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const data = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(path.join(run, name), Buffer.from(data, 'base64'));
}
async function showModelControls(page) {
  await page.evaluate(() => { const section = document.getElementById('workbench-model-controls'), offset = document.querySelector('.lab-header').getBoundingClientRect().height + 14; scrollTo({ top: Math.max(0, scrollY + section.getBoundingClientRect().top - offset), behavior: 'instant' }); });
}
async function expectPanelBelowHeader(page, selector) {
  await expect.poll(() => page.evaluate(selector => {
    const panel = document.querySelector(selector), header = document.querySelector('.lab-header');
    if (!panel || !panel.getClientRects().length) return false;
    const box = panel.getBoundingClientRect(), headerBox = header.getBoundingClientRect();
    return box.top >= headerBox.bottom - 1 && box.top < innerHeight - 30;
  }, selector)).toBe(true);
}
async function inspectTopbar(page, wide = false) {
  await page.locator('.lab-header .model-provider-strip').waitFor();
  const layout = await page.evaluate(collectWorkbenchLayout);
  assertWorkbenchLayout(layout, wide ? 'wide model controls' : 'model controls');
  return layout;
}
function card(page, title) { return page.locator('.model-channel-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }); }
function route(page, name) { return page.locator('.model-routing label').filter({ has: page.getByText(name, { exact: true }) }).locator('select'); }
async function save(page) { await page.locator('#workbench-model-controls').getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.model-settings-notice')).toHaveText('配置已保存。'); }

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const localEndpoint = base + '/local/v1/chat/completions';
  const cloudEndpoint = base + '/cloud/v1/chat/completions';
  let page = await launch();
  await page.evaluate(({ fixture, localEndpoint, cloudEndpoint, settingsKey, projectKey }) => {
    localStorage.setItem(projectKey, JSON.stringify(fixture));
    localStorage.setItem(settingsKey, JSON.stringify({ schemaVersion: '2.0.0', provider: 'local', localRuntime: 'openai', localEndpoint, localModel: 'local-fixture-model', cloudEndpoint, cloudModel: 'api-fixture-model' }));
  }, { fixture, localEndpoint, cloudEndpoint, settingsKey, projectKey });
  await page.reload();
  await expect(page.locator('[data-ready="true"]')).toBeVisible();
  const url = page.url();
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(1480, 960); win.webContents.setZoomFactor(1); });
  await inspectTopbar(page, true);
  await screenshot('topbar-1480.png');
  await page.getByRole('button', { name: '投标', exact: true }).click();
  await page.locator('.bid-output-summary').click();
  await expect(page.locator('.bid-output-summary')).toHaveAttribute('aria-expanded', 'true');
  assert.equal(await page.locator('#global-model-settings').count(), 0);
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await inspectTopbar(page, true);
  await page.locator('.lab-header').getByRole('button', { name: '展开模型设置', exact: true }).click();
  await expectPanelBelowHeader(page, '#workbench-model-settings');
  await expect(card(page, '本地模型').getByLabel('模型名称', { exact: true })).toHaveValue('local-fixture-model');
  await expect(page.getByTestId('local-endpoint')).toHaveValue(localEndpoint);
  await save(page);
  assert.equal(page.url(), url);
  assert.equal((await project(page)).id, fixture.id);
  await expect(page.locator('.stage-rail > button.active')).toHaveAccessibleName('投标');
  await expect(page.locator('.bid-output-summary')).toHaveAttribute('aria-expanded', 'true');
  assert.equal((await storedSettings(page)).schemaVersion, '3.0.0');
  passed('旧本地配置原值迁移，内联展开和保存保留项目、投标页及展开状态，顶栏无单独模型按钮');

  await page.getByRole('radio', { name: '模型套餐', exact: true }).click();
  await card(page, '模型套餐').getByLabel('模型名称', { exact: true }).fill('subscription-fixture-no-real-call');
  await save(page);
  assert.equal((await storedSettings(page)).provider, 'codex');
  await page.getByRole('radio', { name: 'API', exact: true }).click();
  await card(page, 'API').getByLabel('接口地址', { exact: true }).fill(cloudEndpoint);
  await card(page, 'API').getByLabel('模型名称', { exact: true }).fill('api-fixture-model');
  await card(page, 'API').locator('input[type="password"]').fill('synthetic-memory-only-key');
  await save(page);
  assert.equal((await storedSettings(page)).provider, 'cloud');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('cavwic-lab-api-key')), null);
  assert.equal(JSON.stringify(await storedSettings(page)).includes('synthetic-memory-only-key'), false);
  await page.getByRole('radio', { name: '混合', exact: true }).click();
  const enabled = page.getByRole('group', { name: '启用通道', exact: true });
  await enabled.getByLabel('本地模型', { exact: true }).check();
  await enabled.getByLabel('模型套餐', { exact: true }).check();
  await enabled.getByLabel('API', { exact: true }).check();
  await route(page, '资料分析').selectOption('local');
  await route(page, '文件生成').selectOption('cloud');
  await route(page, '图像识别').selectOption('codex');
  await save(page);
  assert.deepEqual((await storedSettings(page)).hybridRoutes, { analysis: 'local', draft: 'cloud', ocr: 'codex' });
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(1480, 960); win.webContents.setZoomFactor(1); });
  await showModelControls(page);
  await inspectTopbar(page, true);
  await screenshot('hybrid-1480.png');
  await enabled.getByLabel('API', { exact: true }).uncheck();
  await expect(route(page, '文件生成')).toHaveValue('local');
  assert.equal(await route(page, '文件生成').locator('option[value="cloud"]').count(), 0);
  await enabled.getByLabel('模型套餐', { exact: true }).uncheck();
  await enabled.getByLabel('本地模型', { exact: true }).click();
  await expect(enabled.getByLabel('本地模型', { exact: true })).toBeChecked();
  await expect(page.locator('.model-settings-notice')).toContainText('请至少保留一个模型通道');
  await enabled.getByLabel('API', { exact: true }).check();
  await route(page, '文件生成').selectOption('cloud');
  await save(page);
  assert.equal((await storedSettings(page)).localModel, 'local-fixture-model');
  assert.equal((await storedSettings(page)).codexModel, 'subscription-fixture-no-real-call');
  passed('本地模型、模型套餐、API 和混合可用，任务仅可选启用通道，关闭通道修复路由，至少保留一个通道，模型参数不丢失');

  await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, workspace);
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await page.locator('.project-header').getByRole('button', { name: '项目设置', exact: true }).click();
  await expectPanelBelowHeader(page, '.project-settings-panel');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '是，继续', exact: true }).click();
  await expect(page.getByLabel('项目路径', { exact: true })).toHaveValue(path.basename(workspace));
  await page.getByRole('button', { name: '关闭项目设置', exact: true }).click();
  await page.getByRole('button', { name: '收起模型设置', exact: true }).click();
  await page.getByRole('button', { name: '生成文件', exact: true }).click();
  await expect.poll(async () => (await project(page)).bidFileChecklist[0].generatedFiles.length, { timeout: 15000 }).toBe(1);
  const cloudRecord = (await project(page)).bidFileChecklist[0].generatedFiles[0];
  assert.equal(cloudRecord.provider, 'cloud'); assert.equal(cloudRecord.model, 'api-fixture-model');
  assert.match(fs.readFileSync(path.join(workspace, ...cloudRecord.relativePath.split('/')), 'utf8'), /cloud 模型验证/);
  assert.equal(calls.at(-1).provider, 'cloud'); assert.equal(calls.at(-1).authorization, 'Bearer synthetic-memory-only-key');
  await page.getByRole('radio', { name: '本地模型', exact: true }).click();
  await page.getByRole('button', { name: '生成文件', exact: true }).click();
  await expect.poll(async () => (await project(page)).bidFileChecklist[0].generatedFiles.length, { timeout: 15000 }).toBe(2);
  const localRecord = (await project(page)).bidFileChecklist[0].generatedFiles[1];
  assert.equal(localRecord.provider, 'local'); assert.equal(localRecord.model, 'local-fixture-model');
  assert.match(fs.readFileSync(path.join(workspace, ...localRecord.relativePath.split('/')), 'utf8'), /local 模型验证/);
  assert.equal(calls.at(-1).provider, 'local'); assert.equal(calls.at(-1).authorization, '');
  const callsBefore = calls.length;
  failLocal = true;
  await page.getByRole('button', { name: '生成文件', exact: true }).click();
  await expect(page.locator('.workbench-notice')).toContainText('投标文件生成失败');
  assert.equal(calls.length, callsBefore + 1);
  assert.equal(calls.at(-1).provider, 'local');
  assert.equal((await project(page)).bidFileChecklist[0].generatedFiles.length, 2);
  passed('混合文件生成真实经过原生 API 通道，本地生成经过原生本地通道，输出记录提供实际通道和模型，本地失败不改走 API 或覆盖旧文件');

  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(760, 780); win.webContents.setZoomFactor(1.25); });
  if (await page.getByRole('button', { name: '展开模型设置', exact: true }).count()) await page.getByRole('button', { name: '展开模型设置', exact: true }).click();
  await showModelControls(page);
  for (const locale of ['zh', 'en']) {
    if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-locale', locale);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(async theme => { document.documentElement.dataset.theme = theme; localStorage.setItem('cavwic-lab-theme', theme); await window.bidDesktop.setTheme(theme); }, theme);
      await inspectTopbar(page);
      const band = await page.evaluate(() => { const style = getComputedStyle(document.body, '::before'); return { height: parseFloat(style.height), background: style.backgroundImage, color: style.backgroundColor, bodyColor: getComputedStyle(document.body).backgroundColor, pointerEvents: style.pointerEvents }; });
      assert.ok(band.height >= 12, 'The bottom band should retain its visible height');
      assert.equal(band.background, 'none'); assert.equal(band.color, band.bodyColor);
      assert.equal(band.pointerEvents, 'none');
      const projectButton = page.locator('.project-header').getByRole('button', { name: locale === 'zh' ? '项目设置' : 'Project settings', exact: true });
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await inspectTopbar(page);
      await projectButton.click();
      await expect(page.locator('.project-settings-panel')).toBeVisible();
      await expectPanelBelowHeader(page, '.project-settings-panel');
      await page.getByRole('button', { name: locale === 'zh' ? '关闭项目设置' : 'Close project settings', exact: true }).click();
      assert.equal((await project(page)).id, fixture.id);
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await screenshot(`topbar-760-125-${locale}-${theme}.png`);
    }
  }
  if (await page.locator('html').getAttribute('data-locale') !== 'zh') await page.locator('#global-locale-toggle').click();
  passed('撤销恢复位于品牌旁首行，模型通道位于第二行，项目操作位于主标题下，760 窄窗 125% 深浅中英文无溢出且按钮可用，底部至少 12px 并与页面同色');
  await application.close(); application = null;
  page = await launch();
  const persisted = await storedSettings(page);
  assert.equal(persisted.provider, 'local');
  assert.equal(persisted.localEndpoint, localEndpoint);
  assert.equal(persisted.codexModel, 'subscription-fixture-no-real-call');
  assert.equal(await page.evaluate(() => window.bidDesktop.getApiKey()), '');
  assert.equal((await project(page)).id, fixture.id);
  assert.equal((await project(page)).bidFileChecklist[0].generatedFiles.length, 2);
  passed('重启保留模型参数、项目和已生成文件，API 密钥随会话清空');
  assert.deepEqual(report.errors, []);
  report.success = true;
})().catch(async error => {
  report.success = false; report.failure = error.stack || String(error); process.exitCode = 1;
  if (application) { const page = await application.firstWindow(); await page.screenshot({ path: path.join(run, 'failure.png'), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(run, 'failure.html'), await page.content()); }
  console.error(report.failure);
}).finally(async () => {
  if (application) await application.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify({ ...report, calls }, null, 2));
  console.log('Report: ' + path.join(run, 'report.json'));
});
