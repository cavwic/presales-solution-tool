'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { _electron: electron, expect } = require('playwright/test');
const { sourceElectronExecutable } = require('./test-runtime.cjs');
const ROOT = path.resolve(__dirname, '../..');
const expectedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const packaged = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || process.env.SOLUTION_TOOL_EXECUTABLE || process.env.BID_EXECUTABLE;
const testRoot = path.join(ROOT, '.cache', 'validation', 'desktop-smoke-' + Date.now());
const profile = path.join(testRoot, 'profile');
const workspace = path.join(testRoot, '验证项目');
const output = path.join(testRoot, '导出');
fs.mkdirSync(workspace, { recursive: true }); fs.mkdirSync(output, { recursive: true });
const report = { packaged: Boolean(packaged), testRoot, checks: [], errors: [] };
let application;
const server = http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const payload = JSON.parse(body);
  assert.equal(payload.model, 'local-smoke-model');
  const data = { choices: [{ message: { content: '# 本地验证\n\n交付周期：60天。' } }] };
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
});
const passed = (name) => { report.checks.push(name); console.log('PASS ' + name); };

function executableMetadata(file) {
  const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Diagnostics.FileVersionInfo]::GetVersionInfo($env:PRESALES_SOLUTION_TOOL_TEST_BINARY) | Select-Object ProductName,FileDescription,OriginalFilename,InternalName,ProductVersion | ConvertTo-Json -Compress";
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, PRESALES_SOLUTION_TOOL_TEST_BINARY: file }, encoding: 'utf8' }).replace(/^\uFEFF/, ''));
}

async function launch({ profileVariable = 'PRESALES_SOLUTION_TOOL_TEST_DATA' } = {}) {
  const env = { ...process.env };
  delete env.PRESALES_SOLUTION_TOOL_TEST_DATA;
  delete env.SOLUTION_TOOL_TEST_DATA;
  delete env.BID_WORKBENCH_TEST_DATA;
  if (profileVariable === 'PRESALES_SOLUTION_TOOL_TEST_DATA') {
    env.SOLUTION_TOOL_TEST_DATA = path.join(testRoot, 'unused-solution-profile');
    env.BID_WORKBENCH_TEST_DATA = path.join(testRoot, 'unused-bid-profile');
  } else if (profileVariable === 'SOLUTION_TOOL_TEST_DATA') env.BID_WORKBENCH_TEST_DATA = path.join(testRoot, 'unused-bid-profile');
  env[profileVariable] = profile;
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ executablePath: packaged || sourceElectronExecutable(), args: packaged ? [] : [ROOT], env, timeout: 30000 });
  application = instance;
  const page = await instance.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  try { await page.getByRole('button', { name: '项目设置', exact: true }).waitFor({ timeout: 20000 }); }
  catch (error) { await page.screenshot({ path: path.join(testRoot, 'startup-failure.png') }); fs.writeFileSync(path.join(testRoot, 'startup-failure.html'), await page.content()); throw error; }
  return { instance, page };
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
  let result = await launch(); application = result.instance; let page = result.page;
  assert.equal(await page.title(), '售前解决方案工具');
  assert.equal(page.url(), 'bid://app/cavwic-solutions-lab/');
  assert.equal(await page.locator('html').getAttribute('data-locale'), 'zh');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  passed('打包界面离线加载、中文默认、隔离渲染进程');
  const state = await application.evaluate(({ BrowserWindow, app }) => { const win = BrowserWindow.getAllWindows()[0]; return { frame: win.getTitle(), menu: win.isMenuBarVisible(), userData: app.getPath('userData'), name: app.getName(), version: app.getVersion(), appPath: app.getAppPath(), executable: process.execPath }; });
  assert.equal(state.frame, '售前解决方案工具'); assert.equal(state.name, '售前解决方案工具'); assert.equal(state.version, expectedVersion);
  assert.equal(state.menu, false); assert.equal(state.userData, profile);
  assert.equal(state.appPath, packaged ? path.join(path.dirname(packaged), 'resources', 'app') : ROOT);
  await page.locator('#global-locale-toggle').click();
  await expect(page).toHaveTitle('Presales Solution Tool');
  await expect(page.getByRole('heading', { name: 'Presales Solution Tool', exact: true })).toBeVisible();
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Presales Solution Tool');
  await page.locator('#global-locale-toggle').click();
  await expect(page).toHaveTitle('售前解决方案工具');
  await page.evaluate(() => localStorage.setItem('cavwic-lab-memory-fixture', JSON.stringify({ marker: 'preserve-old-namespace', version: 1 })));
  if (packaged) {
    assert.equal(path.basename(state.executable), '售前解决方案工具.exe');
    assert.equal(path.resolve(state.executable), path.resolve(packaged));
    const packageInfo = JSON.parse(fs.readFileSync(path.join(state.appPath, 'package.json'), 'utf8'));
    assert.equal(packageInfo.name, 'cavwic-presales-solution-tool'); assert.equal(packageInfo.productName, '售前解决方案工具'); assert.equal(packageInfo.version, expectedVersion);
    const metadata = executableMetadata(packaged);
    assert.equal(metadata.ProductName, '售前解决方案工具'); assert.equal(metadata.FileDescription, '售前解决方案工具'); assert.equal(metadata.OriginalFilename, '售前解决方案工具.exe');
    const launcher = path.join(ROOT, '售前解决方案工具.exe'); assert.ok(fs.existsSync(launcher));
    const launcherInfo = executableMetadata(launcher);
    assert.equal(launcherInfo.ProductName, '售前解决方案工具');
    const launcherBytes = fs.readFileSync(launcher);
    assert.ok(launcherBytes.includes(Buffer.from('售前解决方案工具-win-x64', 'utf16le')));
    assert.ok(launcherBytes.includes(Buffer.from('售前解决方案工具.exe', 'utf16le')));
    const buildInfo = JSON.parse(fs.readFileSync(path.join(path.dirname(packaged), 'build-info.json'), 'utf8'));
    assert.equal(buildInfo.dataDirectory, '%APPDATA%\\CavwicBidWorkbench');
    report.branding = { packageInfo, metadata, launcherInfo, appPath: state.appPath, dataDirectory: buildInfo.dataDirectory };
  }
  passed('新目录、中文及英文页面和原生标题一致，新测试变量优先，旧数据 origin 保持');
  await page.getByRole('radio', { name: '本地模型', exact: true }).click();
  await page.getByTestId('local-runtime').selectOption('openai');
  await page.getByTestId('local-endpoint').fill(endpoint);
  await page.locator('[data-testid="model-channel-local"]').getByLabel('模型名称', { exact: true }).fill('local-smoke-model');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('radio', { name: 'API', exact: true }).click();
  await page.locator('[data-testid="model-channel-cloud"]').getByLabel('接口地址', { exact: true }).fill(endpoint);
  await page.locator('[data-testid="model-channel-cloud"]').getByLabel('模型名称', { exact: true }).fill('local-smoke-model');
  await page.locator('[data-testid="model-channel-cloud"] input[type="password"]').fill('smoke-session-secret');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('radio', { name: '本地模型', exact: true }).click();
  await page.getByRole('button', { name: '收起模型设置', exact: true }).click();
  assert.equal(await page.evaluate(() => window.bidDesktop.getApiKey()), 'smoke-session-secret');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('cavwic-lab-api-key')), null);
  const nativeReply = await page.evaluate(async (endpoint) => window.bidDesktop.modelRequest({ endpoint, authorization: 'Bearer ' + window.bidDesktop.getApiKey(), body: JSON.stringify({ model: 'local-smoke-model', messages: [{ role: 'user', content: '验证接口' }], stream: false }) }), endpoint);
  assert.equal(nativeReply.status, 200); assert.match(nativeReply.body, /60天/);
  passed('内联模型配置切换保留参数，主进程调用无CORS的本地HTTP接口，API密钥仅在内存');
  await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, workspace);
  await page.getByRole('button', { name: '项目设置', exact: true }).click();
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '是，继续', exact: true }).click();
  await expect(page.getByLabel('项目路径', { exact: true })).toHaveValue('验证项目');
  await page.getByRole('button', { name: '关闭项目设置', exact: true }).click();
  await page.getByRole('button', { name: '招标', exact: true }).click();
  await page.locator('#tender-files input[type="file"]').setInputFiles({ name: '招标书.txt', mimeType: 'text/plain', buffer: Buffer.from('本项目交付周期为60天，须提交技术方案与验收方案。') });
  await expect(page.getByText('招标书.txt', { exact: true })).toBeVisible();
  await expect.poll(() => fs.existsSync(path.join(workspace, 'workspace.json'))).toBe(true);
  passed('原生目录选择、真实招标文件导入与本地项目清单写入');
  await page.screenshot({ path: path.join(testRoot, 'desktop.png') });
  const selected = await page.evaluate(async () => window.bidDesktop.fs.restore({ key: 'active-workspace' }));
  assert.equal(selected.ok, true); assert.ok(selected.value);
  const list = await page.evaluate(async handle => window.bidDesktop.fs.op({ handle, op: 'list' }), selected.value);
  assert.equal(list.ok, true); assert.ok(list.value.some(([name]) => name === '2_招标要求'));
  passed('目录授权及文件句柄通过IPC恢复');
  const legacyState = await page.evaluate(() => ({ settings: JSON.parse(localStorage.getItem('cavwic-lab-model-settings')), projectId: JSON.parse(localStorage.getItem('cavwic-solution-workspace')).id, memory: localStorage.getItem('cavwic-lab-memory-fixture'), locale: localStorage.getItem('cavwic-lab-locale'), theme: localStorage.getItem('cavwic-lab-theme') }));
  await application.close(); application = null;
  for (const profileVariable of ['SOLUTION_TOOL_TEST_DATA', 'BID_WORKBENCH_TEST_DATA']) {
    result = await launch({ profileVariable }); application = result.instance; page = result.page;
    assert.equal(await page.evaluate(() => window.bidDesktop.getApiKey()), '');
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
    assert.equal(await page.title(), '售前解决方案工具');
    assert.equal(page.url(), 'bid://app/cavwic-solutions-lab/');
    const restoredState = await page.evaluate(() => ({ settings: JSON.parse(localStorage.getItem('cavwic-lab-model-settings')), projectId: JSON.parse(localStorage.getItem('cavwic-solution-workspace')).id, memory: localStorage.getItem('cavwic-lab-memory-fixture'), locale: localStorage.getItem('cavwic-lab-locale'), theme: localStorage.getItem('cavwic-lab-theme') }));
    assert.deepEqual(restoredState, legacyState);
    const restoredDirectory = await page.evaluate(() => window.bidDesktop.fs.restore({ key: 'active-workspace' }));
    assert.equal(restoredDirectory.ok, true); assert.deepEqual(restoredDirectory.value, selected.value);
    await page.getByRole('button', { name: '招标', exact: true }).click();
    await expect(page.getByText('招标书.txt', { exact: true })).toBeVisible();
    if (profileVariable === 'SOLUTION_TOOL_TEST_DATA') { await application.close(); application = null; }
  }
  assert.equal(fs.existsSync(path.join(testRoot, 'unused-solution-profile')), false);
  assert.equal(fs.existsSync(path.join(testRoot, 'unused-bid-profile')), false);
  passed('两代旧测试变量兼容，重启后旧命名空间的模型配置、项目、记忆项及目录授权恢复，密钥清空');
  await page.getByRole('button', { name: '展开模型设置', exact: true }).click();
  await expect(page.locator('[data-testid="model-channel-local"]').getByLabel('模型名称', { exact: true })).toHaveValue('local-smoke-model');
  await page.getByRole('button', { name: '收起模型设置', exact: true }).click();
  await page.evaluate(async () => { await window.bidDesktop.windowControl('maximize'); });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
  await page.evaluate(async () => { await window.bidDesktop.windowControl('maximize'); });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  passed('窗口最大化与还原');
  assert.deepEqual(report.errors, []);
  report.success = true;
})().catch(error => { report.success = false; report.failure = error.stack; process.exitCode = 1; console.error(error.stack); }).finally(async () => {
  if (application) await application.close().catch(() => {});
  server.close();
  fs.writeFileSync(path.join(testRoot, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + path.join(testRoot, 'report.json'));
});
