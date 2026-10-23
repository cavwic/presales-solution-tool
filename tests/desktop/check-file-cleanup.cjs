'use strict';

// Packaged cleanup acceptance uses only fictional files and this run's profile.
// The OS recycle-bin call is replaced with a move into a test-owned directory.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron: electron, expect } = require('playwright/test');
const { collectWorkbenchLayout, assertWorkbenchLayout } = require('./layout-contract.cjs');
const schema = require('../../src/lib/workspace-schema.ts');
const ROOT = path.resolve(__dirname, '../..');
const executablePath = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || path.join(ROOT, 'release', '售前解决方案工具-win-x64', '售前解决方案工具.exe');
const runRoot = path.join(ROOT, '.cache', 'validation', 'file-cleanup-' + Date.now());
const profile = path.join(runRoot, 'profile');
const workspace = path.join(runRoot, 'workspace');
const recycle = path.join(runRoot, 'test-recycle-bin');
const previews = path.join(profile, 'previews', 'fixture');
const externalDownload = path.join(runRoot, 'downloaded-copy', 'local-output.md');
const report = { runRoot, executablePath, profile, checks: [], layouts: [], screenshots: [], pageErrors: [], externalRequests: [] };
const hash = value => createHash('sha256').update(value).digest('hex');
const now = new Date().toISOString();
const fixture = schema.createEmptyProject('zh');
fixture.id = 'cleanup-fictional-project';
fixture.name = '公开虚构清理验收项目';
fixture.localPathHint = 'workspace';
const generatedDirectory = '1_售前准备/2_客户沟通与文件响应/第一轮沟通/生成文件';
const definitions = [
  { id: 'generated-remove', sourceId: 'source-remove', name: 'selected-output.md', relativePath: generatedDirectory + '/selected-output.md', text: '# 公开虚构待清文件\n仅用于清理验收。\n', scope: 'project' },
  { id: 'generated-keep', sourceId: 'source-keep', name: 'unselected-output.md', relativePath: generatedDirectory + '/unselected-output.md', text: '# 公开虚构保留文件\n未选择，必须保留。\n', scope: 'project' },
  { id: 'generated-local', sourceId: 'source-local', name: 'local-output.md', relativePath: 'downloads/local-output.md', text: '# 公开虚构下载副本\n清理本机记录时，外部下载副本保留。\n', scope: 'local' },
  { id: 'imported-material', sourceId: 'imported-material', name: 'imported-material.md', relativePath: '2_招标要求/1_招标文件/imported-material.md', text: '# 公开虚构导入原文\n所有清理操作均须保留。\n', scope: 'imported' },
];
fixture.sources = definitions.map(file => schema.sourceDocumentSchema.parse({ id: file.sourceId, name: file.name, fileType: 'md', version: '1.0', size: Buffer.byteLength(file.text), sha256: hash(file.text), importedAt: now, requiresOcr: false, preprocessStatus: 'ready', preprocessedAt: now, preprocessMessage: '', workspacePath: file.relativePath, segments: [] }));
const round = schema.createPresalesRound('zh', 1);
round.requirementSourceIds = ['imported-material'];
round.selectedRequirementSourceIds = ['imported-material'];
round.generatedFiles = definitions.filter(file => file.scope !== 'imported').map(file => ({ id: file.id, sourceId: file.sourceId, name: file.name, relativePath: file.relativePath, format: 'md', createdAt: now, provider: 'local', model: 'fictional-no-inference', actionId: '' }));
fixture.presalesRounds = [round];
fixture.tenderSourceIds = ['imported-material'];
fixture.selectedTenderSourceIds = ['imported-material'];
schema.projectManifestSchema.parse(fixture);
const settings = { schemaVersion: '3.0.0', provider: 'hybrid', localRuntime: 'openai', localProfiles: {}, localEndpoint: 'http://127.0.0.1:1/v1', localModel: 'fictional-no-inference', cloudEndpoint: 'https://fixture.invalid/v1', cloudModel: 'fictional-no-inference', codexModel: 'fictional-no-inference', enabledProviders: ['local', 'codex', 'cloud'], hybridRoutes: { analysis: 'local', draft: 'codex', ocr: 'cloud' } };
for (const folder of [workspace, recycle, previews, path.dirname(externalDownload)]) fs.mkdirSync(folder, { recursive: true });
for (const file of definitions.filter(file => file.scope !== 'local')) {
  const filename = path.join(workspace, file.relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, file.text);
}
fs.writeFileSync(externalDownload, definitions.find(file => file.scope === 'local').text);
fs.writeFileSync(path.join(previews, 'temporary-one.md'), '# 公开虚构临时预览一\n');
fs.writeFileSync(path.join(previews, 'temporary-two.txt'), '公开虚构临时预览二\n');
fs.mkdirSync(path.join(workspace, 'projects', fixture.id), { recursive: true });
fs.writeFileSync(path.join(workspace, 'workspace.json'), JSON.stringify({ schemaVersion: '1.0.0', activeProjectId: fixture.id, projects: [{ id: fixture.id, name: fixture.name, updatedAt: fixture.updatedAt }] }));
fs.writeFileSync(path.join(workspace, 'projects', fixture.id, 'project.json'), JSON.stringify(fixture));
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=31536000' });
  response.end('fictional runtime cache fixture\n'.repeat(8192));
});
let app, page;
const pass = (name, details) => { report.checks.push({ name, details }); console.log('PASS ' + name); };
const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const manifest = () => page.evaluate(() => JSON.parse(localStorage.getItem('cavwic-solution-workspace')));
const cleanManifest = value => ({ ...value, updatedAt: '<volatile>' });

async function persistedState() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('cavwic-solutions-lab', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const records = await new Promise((resolve, reject) => { const request = db.transaction('source-files', 'readonly').objectStore('source-files').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close();
    return { model: localStorage.getItem('cavwic-lab-model-settings'), memory: localStorage.getItem('cavwic-lab-cleanup-memory-fixture'), apiKey: window.bidDesktop.getApiKey(), localKey: window.bidDesktop.getLocalApiKey(), records: await Promise.all(records.map(async record => ({ projectId: record.projectId, sourceId: record.sourceId, name: record.file.name, text: await record.file.text() }))) };
  });
}

async function capture(name) {
  await page.mouse.move(2, 150); await settled();
  const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const filename = path.join(runRoot, name + '.png'); fs.writeFileSync(filename, Buffer.from(bytes, 'base64')); report.screenshots.push(filename);
}

async function launch() {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: [], env, timeout: 30000 });
  page = await app.firstWindow(); page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
  await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true', { timeout: 20000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await app.evaluate(async ({ BrowserWindow, shell }, input) => {
    const fs = process.getBuiltinModule('fs/promises'), path = process.getBuiltinModule('path');
    globalThis.__cleanupAcceptance = { cacheCalls: 0, recycled: [] };
    shell.trashItem = async filename => {
      const absolute = path.resolve(filename), relative = path.relative(input.workspace, absolute);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Test recycle request escaped fixture workspace');
      const target = path.join(input.recycle, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(absolute, target);
      globalThis.__cleanupAcceptance.recycled.push({ filename: absolute, target });
    };
    const session = BrowserWindow.getAllWindows()[0].webContents.session;
    const original = session.clearCache.bind(session);
    session.clearCache = async () => { globalThis.__cleanupAcceptance.cacheCalls++; await original(); };
  }, { workspace, recycle });
}

async function resize(width, height, zoom) {
  await app.evaluate(({ BrowserWindow }, input) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(input.width, input.height); win.setPosition(0, 0); win.webContents.setZoomFactor(input.zoom); }, { width, height, zoom });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(width / zoom, 0); await settled();
}

async function themeLocale(locale, theme) {
  if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#global-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-locale', locale); await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await settled();
}

async function openCleanup() {
  await page.locator('.file-cleanup-command').click();
  const modal = page.getByTestId('file-cleanup-dialog');
  await expect(modal).toBeVisible(); await expect(modal.locator('.file-cleanup-body')).toHaveAttribute('aria-busy', 'false');
  return modal;
}

async function modalLayout(name) {
  const data = await page.evaluate(() => {
    const modal = document.querySelector('.file-cleanup-dialog'), bounds = modal.getBoundingClientRect();
    const buttons = [...modal.querySelectorAll('button')].filter(element => element.getClientRects().length).map(element => { const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { label: element.textContent || element.getAttribute('aria-label'), inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, hit: hit === element || element.contains(hit) }; });
    return { width: innerWidth, height: innerHeight, dialog: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, clientWidth: modal.clientWidth, scrollWidth: modal.scrollWidth }, focusInside: modal.contains(document.activeElement), modal: modal.matches(':modal'), checked: modal.querySelectorAll('input:checked').length, buttons };
  });
  report.layouts.push({ name, modal: data });
  assert.equal(data.modal, true); assert.equal(data.focusInside, true); assert.equal(data.checked, 0);
  assert.ok(data.dialog.left >= -1 && data.dialog.right <= data.width + 1 && data.dialog.top >= -1 && data.dialog.bottom <= data.height + 1, name + ': modal outside viewport');
  assert.ok(data.dialog.scrollWidth <= data.dialog.clientWidth + 1, name + ': modal horizontal overflow');
  for (const button of data.buttons) { assert.equal(button.inside, true, name + ': modal button outside viewport'); assert.equal(button.hit, true, name + ': modal button covered'); }
}

async function headerLayout(name) {
  const data = await page.evaluate(collectWorkbenchLayout);
  report.layouts.push({ name, header: data });
  assertWorkbenchLayout(data, name);
}

async function ensureKept() {
  for (const file of definitions.filter(file => file.scope === 'imported' || file.id === 'generated-keep')) assert.equal(hash(fs.readFileSync(path.join(workspace, file.relativePath))), hash(file.text));
  assert.equal(fs.readFileSync(externalDownload, 'utf8'), definitions.find(file => file.scope === 'local').text);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await launch();
  await page.evaluate(async ({ fixture, definitions, settings }) => {
    localStorage.setItem('cavwic-solution-workspace', JSON.stringify(fixture));
    localStorage.setItem('cavwic-lab-model-settings', JSON.stringify(settings));
    localStorage.setItem('cavwic-lab-cleanup-memory-fixture', 'retained-memory-marker');
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('cavwic-solutions-lab', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('source-files', 'readwrite'), store = tx.objectStore('source-files'); for (const item of definitions) store.put({ projectId: fixture.id, sourceId: item.sourceId, file: new File([item.text], item.name, { type: 'text/markdown' }) }, `${fixture.id}:${item.sourceId}`); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
  }, { fixture, definitions, settings });
  await page.reload(); await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, workspace);
  await page.locator('.project-path-command').click(); await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '是，继续', exact: true }).click();
  await expect(page.getByLabel('项目路径', { exact: true })).toHaveValue('workspace'); await page.locator('.project-settings-heading > button').click();
  await expect.poll(async () => (await persistedState()).records.length).toBe(4);
  await page.evaluate(() => { window.bidDesktop.setApiKey('fictional-session-key'); window.bidDesktop.setLocalApiKey('fictional-local-key'); });
  pass('Isolated packaged app loads a fictional authorized project, three generated records, imported source and test-only session keys');

  for (const [width, height, zoom] of [[1480, 960, 1], [1280, 900, 1], [760, 900, 1.25]]) for (const locale of ['zh', 'en']) for (const theme of ['dark', 'light']) {
    const name = `${width}-${Math.round(zoom * 100)}-${locale}-${theme}`;
    await resize(width, height, zoom); await themeLocale(locale, theme); await headerLayout(name);
    const before = cleanManifest(await manifest()), localBefore = await persistedState();
    const modal = await openCleanup(); await expect(modal.locator('.file-cleanup-file')).toHaveCount(3); await modalLayout(name); await expect(page.getByTestId('cleanup-review')).toBeDisabled();
    await capture(name + '-cleanup'); await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
    assert.equal(await page.locator('.file-cleanup-command').evaluate(element => element === document.activeElement), true);
    assert.deepEqual(cleanManifest(await manifest()), before); assert.deepEqual(await persistedState(), localBefore);
    assert.equal(await app.evaluate(() => globalThis.__cleanupAcceptance.recycled.length), 0); await ensureKept();
    pass(name + ': project controls below page title, unique history controls beside brand, two-row topbar, readable modal, no default selection and cancel leaves data intact');
  }
  await resize(1480, 960, 1); await themeLocale('zh', 'dark');
  const beforeCacheManifest = cleanManifest(await manifest()), beforeCacheLocal = await persistedState();
  const cacheUrl = `http://127.0.0.1:${server.address().port}/cache-fixture`;
  await app.evaluate(async ({ BrowserWindow }, url) => { const response = await BrowserWindow.getAllWindows()[0].webContents.session.fetch(url); await response.text(); }, cacheUrl);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.session.getCacheSize())).toBeGreaterThan(0);
  let modal = await openCleanup();
  await modal.getByTestId('cleanup-category-runtime-cache').check(); await modal.getByTestId('cleanup-category-previews').check(); await modal.getByTestId('cleanup-review').click();
  await expect(modal.getByTestId('cleanup-confirm')).toBeFocused(); await page.keyboard.press('Escape'); await expect(modal.getByTestId('cleanup-review')).toBeFocused();
  assert.equal(fs.readdirSync(previews).length, 2); assert.equal(await app.evaluate(() => globalThis.__cleanupAcceptance.cacheCalls), 0);
  await modal.getByTestId('cleanup-review').click(); await modal.getByTestId('cleanup-confirm').click(); await expect(modal.getByTestId('cleanup-review')).toBeVisible(); await expect(modal.locator('.file-cleanup-body')).toHaveAttribute('aria-busy', 'false');
  assert.equal(fs.readdirSync(previews).length, 0); assert.equal(await app.evaluate(() => globalThis.__cleanupAcceptance.cacheCalls), 1);
  assert.equal(await app.evaluate(() => globalThis.__cleanupAcceptance.recycled.length), 0);
  assert.deepEqual(cleanManifest(await manifest()), beforeCacheManifest); assert.deepEqual(await persistedState(), beforeCacheLocal); await ensureKept();
  await capture('cache-cleaned'); await modal.getByRole('button', { name: '关闭文件清理', exact: true }).click();
  pass('Canceling cache confirmation changes nothing; confirmed runtime cache uses only the isolated app session, previews are removed, project sources/settings/keys/IDB stay intact');

  await page.getByLabel('项目名称', { exact: true }).fill('公开虚构清理验收项目（撤销基线）');
  await expect(page.locator('#global-history-undo')).toBeEnabled();
  const beforeGeneratedLocal = await persistedState();
  modal = await openCleanup(); await modal.locator('.file-cleanup-file').filter({ hasText: 'selected-output.md' }).first().locator('input').check();
  await modal.getByTestId('cleanup-review').click(); await expect(modal.getByText('清理生成文件后将重置当前撤销记录。', { exact: true })).toBeVisible();
  await expect(modal.getByText('选中的现存项目文件将移入回收站。', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: '返回选择', exact: true }).click(); assert.equal(fs.existsSync(path.join(workspace, definitions[0].relativePath)), true);
  await modal.getByTestId('cleanup-review').click(); await modal.getByTestId('cleanup-confirm').click(); await expect(modal.getByTestId('cleanup-review')).toBeVisible(); await expect(modal.locator('.file-cleanup-body')).toHaveAttribute('aria-busy', 'false');
  assert.equal(fs.existsSync(path.join(workspace, definitions[0].relativePath)), false); assert.equal(fs.readFileSync(path.join(recycle, definitions[0].relativePath), 'utf8'), definitions[0].text);
  const cleaned = await manifest(); assert.deepEqual(cleaned.presalesRounds[0].generatedFiles.map(file => file.id), ['generated-keep', 'generated-local']); assert.equal(cleaned.sources.some(source => source.id === 'source-remove'), false);
  await expect.poll(async () => (await persistedState()).records.map(record => record.sourceId).sort()).toEqual(['imported-material', 'source-keep', 'source-local']);
  const afterGeneratedLocal = await persistedState(); assert.equal(afterGeneratedLocal.model, beforeGeneratedLocal.model); assert.equal(afterGeneratedLocal.memory, beforeGeneratedLocal.memory); assert.equal(afterGeneratedLocal.apiKey, beforeGeneratedLocal.apiKey); assert.equal(afterGeneratedLocal.localKey, beforeGeneratedLocal.localKey);
  const diskProject = JSON.parse(fs.readFileSync(path.join(workspace, 'projects', fixture.id, 'project.json'), 'utf8')); assert.deepEqual(diskProject.presalesRounds[0].generatedFiles.map(file => file.id), ['generated-keep', 'generated-local']);
  await expect(modal.locator('.file-cleanup-file')).toHaveCount(2); await ensureKept(); await capture('single-generated-cleaned');
  await modal.getByRole('button', { name: '关闭文件清理', exact: true }).click(); await expect(page.locator('#global-history-undo')).toBeDisabled(); await expect(page.locator('#global-history-redo')).toBeDisabled();
  await page.evaluate(() => { window.dispatchEvent(new Event('cavwic-history-undo')); }); await settled(); assert.equal(fs.existsSync(path.join(workspace, definitions[0].relativePath)), false); assert.deepEqual((await manifest()).presalesRounds[0].generatedFiles.map(file => file.id), ['generated-keep', 'generated-local']);
  pass('Single selected generated file moves to test recycle bin, its manifest/IDB owners are pruned, unselected generated/imported files and model settings/keys survive, undo cannot resurrect the file');

  modal = await openCleanup(); await modal.locator('.file-cleanup-file').filter({ hasText: 'local-output.md' }).first().locator('input').check(); await modal.getByTestId('cleanup-review').click(); await expect(modal.getByText('仅清理本机记录，下载副本保留。', { exact: true })).toBeVisible(); await modal.getByTestId('cleanup-confirm').click(); await expect(modal.getByTestId('cleanup-review')).toBeVisible(); await expect(modal.locator('.file-cleanup-body')).toHaveAttribute('aria-busy', 'false');
  assert.equal(await app.evaluate(() => globalThis.__cleanupAcceptance.recycled.length), 1); await ensureKept();
  await expect.poll(async () => (await persistedState()).records.map(record => record.sourceId).sort()).toEqual(['imported-material', 'source-keep']);
  assert.deepEqual((await manifest()).presalesRounds[0].generatedFiles.map(file => file.id), ['generated-keep']);
  await modal.getByRole('button', { name: '关闭文件清理', exact: true }).click(); pass('Local generated record cleanup removes its manifest/IDB record while the separate downloaded copy survives without any recycle-bin call');
  const preRestart = await persistedState(), preRestartManifest = cleanManifest(await manifest());
  await app.close(); app = null; await launch();
  await expect(page.getByLabel('项目名称', { exact: true })).toHaveValue('公开虚构清理验收项目（撤销基线）');
  assert.deepEqual(cleanManifest(await manifest()), preRestartManifest);
  const restarted = await persistedState(); assert.deepEqual(restarted.records, preRestart.records); assert.equal(restarted.model, preRestart.model); assert.equal(restarted.memory, preRestart.memory); assert.equal(restarted.apiKey, ''); assert.equal(restarted.localKey, '');
  const authorization = await page.evaluate(() => window.bidDesktop.fs.restore({ key: 'active-workspace' })); assert.equal(authorization.ok, true); assert.ok(authorization.value);
  await expect(page.locator('#global-history-undo')).toBeDisabled(); await expect(page.locator('#global-history-redo')).toBeDisabled();
  modal = await openCleanup(); await expect(modal.locator('.file-cleanup-file')).toHaveCount(1); await expect(modal.locator('.file-cleanup-file')).toContainText('unselected-output.md'); await expect(modal.locator('input:checked')).toHaveCount(0); await capture('restart-retained-output'); await page.keyboard.press('Escape'); await ensureKept();
  pass('Restart restores the cleaned project, surviving records, model settings and folder authorization; session-only keys clear normally, removed records stay removed and undo remains disabled');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []); report.success = true;
})().catch(async error => { report.success = false; report.failure = error.stack; process.exitCode = 1; console.error(error.stack); if (page && !page.isClosed()) await capture('failure').catch(() => {}); }).finally(async () => {
  if (app) await app.close().catch(() => {}); server.close(); fs.writeFileSync(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2)); console.log('Report: ' + path.join(runRoot, 'report.json'));
});
