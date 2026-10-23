'use strict';

// Fictional Skills, a test-owned profile, and local HTTP model responses only.
// GitHub installation uses the packaged native service with injected DNS/fetch.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { _electron: electron, expect } = require('playwright/test');
const { collectWorkbenchLayout, assertWorkbenchLayout } = require('./layout-contract.cjs');
const ROOT = path.resolve(__dirname, '../..');
const executablePath = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || path.join(ROOT, 'release', '售前解决方案工具-win-x64', '售前解决方案工具.exe');
const expectedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const runRoot = path.join(ROOT, '.cache', 'validation', 'plans-skills-' + Date.now()), profile = path.join(runRoot, 'profile');
const sentinel = path.join(runRoot, 'bundled-script-must-not-run.txt');
const report = { runRoot, executablePath, profile, expectedVersion, checks: [], layouts: [], screenshots: [], pageErrors: [], externalRequests: [], modelCalls: [] };
fs.mkdirSync(profile, { recursive: true });
const skillText = (name, marker) => `---\nname: ${name}\ndescription: Fictional local acceptance guidance for ${name}.\n---\n# Fictional guidance\n${marker}\nUse only the supplied project facts.\n`;
const md = skillText('fixture-md', 'FICTIONAL_MD_SKILL_MARKER');
const zippedSkill = skillText('fixture-zip', 'FICTIONAL_ZIP_SKILL_MARKER');
const networkSkill = skillText('fixture-network', 'FICTIONAL_NETWORK_SKILL_MARKER');
const networkUrl = 'https://raw.githubusercontent.com/fictional-owner/fixture/main/SKILL.md';
const calls = [];
let app, page, endpoint;
const pass = (name, details) => { report.checks.push({ name, details }); console.log('PASS ' + name); };
const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const storedSettings = () => page.evaluate(() => JSON.parse(localStorage.getItem('cavwic-lab-model-settings')));
const skillsList = () => page.evaluate(() => window.bidDesktop.skills.list());
const server = http.createServer(async (request, response) => {
  const parts = []; for await (const part of request) parts.push(part);
  try {
    const body = JSON.parse(Buffer.concat(parts).toString('utf8')); calls.push({ path: request.url, body, headers: request.headers });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    if (request.url.includes('/anthropic/')) response.end(JSON.stringify({ model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: '# Fictional response' }] }));
    else response.end(JSON.stringify({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: '# Fictional response' } }] }));
  } catch { response.writeHead(400); response.end('{}'); }
});

async function launch() {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: [], env, timeout: 30000 }); page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
  await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true', { timeout: 20000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), expectedVersion);
}

async function installNetworkFixtureService() {
  await app.evaluate(({ app, BrowserWindow, ipcMain }, input) => {
    const path = process.getBuiltinModule('path');
    const require = process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(), 'package.json'));
    const { createSkillService, attachSkills, CHANNELS } = require('./desktop/skills.cjs');
    globalThis.__skillsAcceptanceNetwork = [];
    const service = createSkillService({ userData: app.getPath('userData'), resolve: async () => [{ address: '93.184.216.34', family: 4 }], fetcher: async url => {
      globalThis.__skillsAcceptanceNetwork.push(url);
      if (url !== input.url) return new Response('fixture not found', { status: 404 });
      return new Response(input.skill, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    } });
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    attachSkills({ ipcMain, service, assertSender(event) { const win = BrowserWindow.getAllWindows()[0]; if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith('bid://app/cavwic-solutions-lab/')) throw new Error('Invalid test sender'); }, getLocale: () => BrowserWindow.getAllWindows()[0].getTitle() === 'Presales Solution Tool' ? 'en' : 'zh' });
  }, { url: networkUrl, skill: networkSkill });
}

async function capture(name) {
  await page.mouse.move(2, 160); await settled();
  const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const filename = path.join(runRoot, name + '.png'); fs.writeFileSync(filename, Buffer.from(image, 'base64')); report.screenshots.push(filename);
}

async function openSkills() {
  await page.getByTestId('import-skills').click(); const modal = page.getByTestId('skill-manager-dialog');
  await expect(modal).toBeVisible(); await expect(modal.locator('.skill-manager-body')).toHaveAttribute('aria-busy', 'false'); return modal;
}
async function closeSkills(modal) { await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(page.getByTestId('import-skills')).toBeFocused(); }
async function upload(modal, file) { await modal.getByTestId('skill-upload-input').setInputFiles(file); await modal.getByTestId('skill-import-file').click(); await expect(modal.locator('.skill-manager-body')).toHaveAttribute('aria-busy', 'false'); }
function skillRow(modal, id) { return modal.locator(`[data-skill-id="${id}"]`); }
async function saveModels() { await page.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.model-settings-notice')).toHaveText('配置已保存。'); }
async function openModels() { if (await page.locator('.model-expand-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('.model-expand-toggle').click(); await expect(page.locator('#workbench-model-settings')).toBeVisible(); }
async function closeModels() { if (await page.locator('.model-expand-toggle').getAttribute('aria-expanded') === 'true') await page.locator('.model-expand-toggle').click(); }
async function chat(provider, expectedMarkers, overrides = {}) {
  const settings = { ...await storedSettings(), ...overrides, provider };
  const before = calls.length;
  const result = await page.evaluate(input => window.bidDesktop.modelChat({ settings: input.settings, apiKey: 'fictional-api-key', localApiKey: 'fictional-local-key', subscriptionApiKey: 'fictional-plan-key', prompt: 'A fictional task. Do not run scripts.', task: 'draft' }), { settings });
  assert.equal(calls.length, before + 1); assert.equal(result.content, '# Fictional response');
  const call = calls.at(-1), bodyText = JSON.stringify(call.body);
  for (const marker of expectedMarkers) assert.ok(bodyText.includes(marker), provider + ': enabled Skill missing: ' + marker);
  assert.equal(bodyText.includes('BUNDLED_SCRIPT_EXECUTION_MARKER'), false); assert.equal(bodyText.includes('FICTIONAL_NETWORK_SKILL_MARKER'), false);
  assert.equal(fs.existsSync(sentinel), false);
  report.modelCalls.push({ provider, path: call.path, model: call.body.model, markers: expectedMarkers, actualProvider: result.provider });
  return bodyText;
}

async function resize(width, height, zoom, maximize = false) {
  await app.evaluate(({ BrowserWindow }, input) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(input.width, input.height); win.setPosition(0, 0); win.webContents.setZoomFactor(input.zoom); if (input.maximize) win.maximize(); }, { width, height, zoom, maximize });
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(bounds.width / zoom, 0); await settled();
}
async function themeLocale(locale, theme) {
  if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#global-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-locale', locale); await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect.poll(() => page.evaluate(theme => { const field = document.querySelector('.confirmable-textarea:not(.confirmed) textarea'); return !field || getComputedStyle(field).backgroundColor === (theme === 'dark' ? 'rgb(26, 41, 57)' : 'rgb(255, 255, 255)'); }, theme)).toBe(true); await settled();
}
async function inspectModal(name, modal) {
  const layout = await modal.evaluate(element => {
    const r = element.getBoundingClientRect();
    return { modal: element.matches(':modal'), focusInside: element.contains(document.activeElement), width: innerWidth, height: innerHeight, left: r.left, right: r.right, top: r.top, bottom: r.bottom, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, actions: [...element.querySelectorAll('.skill-manager-header button,.skill-manager-footer button')].map(button => { const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, hit: hit === button || button.contains(hit) }; }) };
  });
  report.layouts.push({ name, modal: layout });
  assert.equal(layout.modal, true); assert.equal(layout.focusInside, true); assert.ok(layout.left >= -1 && layout.top >= -1 && layout.right <= layout.width + 1 && layout.bottom <= layout.height + 1); assert.ok(layout.scrollWidth <= layout.clientWidth + 1, name + ': modal overflow');
  for (const action of layout.actions) { assert.equal(action.inside, true); assert.equal(action.hit, true); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); endpoint = `http://127.0.0.1:${server.address().port}`;
  await launch();
  await page.evaluate(base => {
    localStorage.setItem('cavwic-lab-model-settings', JSON.stringify({ schemaVersion: '3.0.0', provider: 'local', localRuntime: 'openai', localProfiles: {}, localEndpoint: base + '/local/v1', localModel: 'fixture-local', cloudEndpoint: base + '/api/v1/chat/completions', cloudModel: 'fixture-api', codexModel: 'original-codex-fixture', enabledProviders: ['local', 'codex', 'cloud'], hybridRoutes: { analysis: 'local', draft: 'cloud', ocr: 'local' } }));
    localStorage.setItem('cavwic-plans-skills-memory-fixture', 'keep-existing-project-memory');
  }, endpoint);
  await page.reload(); await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true'); await installNetworkFixtureService();
  pass('Packaged app uses an isolated profile, preserves old model settings and exposes Skills through a test-controlled native service');

  let modal = await openSkills(); await expect(modal.locator('.skill-manager-list > li')).toHaveCount(0);
  await modal.getByTestId('skill-upload-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a skill') }); await expect(modal.getByRole('alert')).toContainText('SKILL.md');
  await upload(modal, { name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(md) });
  await expect(skillRow(modal, 'fixture-md')).toBeVisible(); await expect(skillRow(modal, 'fixture-md').getByRole('switch')).toHaveAttribute('aria-checked', 'false'); await expect(modal.getByTestId('skill-content-preview')).toContainText('FICTIONAL_MD_SKILL_MARKER');
  const help = await modal.locator('.skill-manager-info').getAttribute('title'); for (const budget of ['16,000', '4,000', '32,000']) assert.ok(help.includes(budget));
  await closeSkills(modal);
  const disabledPrompt = await chat('local', []); assert.equal(disabledPrompt.includes('FICTIONAL_MD_SKILL_MARKER'), false);
  modal = await openSkills(); await skillRow(modal, 'fixture-md').getByRole('switch').click(); await expect(skillRow(modal, 'fixture-md').getByRole('switch')).toHaveAttribute('aria-checked', 'true'); await closeSkills(modal); await chat('local', ['FICTIONAL_MD_SKILL_MARKER']);
  pass('Single SKILL.md import is disabled by default, previews content and budgets, and enters the real local model prompt only after explicit enablement');

  const zip = new JSZip(); zip.file('fixture-zip/SKILL.md', zippedSkill); zip.file('fixture-zip/references/guide.md', 'FICTIONAL_REFERENCE_MARKER\nUse source-backed acceptance evidence.'); zip.file('fixture-zip/scripts/side-effect.cjs', `// BUNDLED_SCRIPT_EXECUTION_MARKER\nrequire('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'must never run');`); zip.file('fixture-zip/assets/ignored.bin', Buffer.from([0, 1, 2, 255]));
  modal = await openSkills(); await upload(modal, { name: 'fixture-zip.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) });
  await expect(skillRow(modal, 'fixture-zip').getByRole('switch')).toHaveAttribute('aria-checked', 'false'); await modal.locator('.skill-manager-content-select select').selectOption('references/guide.md'); await expect(modal.getByTestId('skill-content-preview')).toContainText('FICTIONAL_REFERENCE_MARKER');
  await skillRow(modal, 'fixture-zip').getByRole('switch').click(); await expect(skillRow(modal, 'fixture-zip').getByRole('switch')).toHaveAttribute('aria-checked', 'true'); await capture('skills-upload-preview'); await closeSkills(modal);
  assert.equal(fs.existsSync(sentinel), false); const zipDetail = await page.evaluate(() => window.bidDesktop.skills.read({ id: 'fixture-zip' })); assert.equal(zipDetail.referenceCount, 1); assert.ok(zipDetail.ignoredFileCount >= 1); assert.equal(zipDetail.references.some(reference => reference.path.includes('scripts/')), false);
  await chat('cloud', ['FICTIONAL_MD_SKILL_MARKER', 'FICTIONAL_ZIP_SKILL_MARKER', 'FICTIONAL_REFERENCE_MARKER']);
  await chat('hybrid', ['FICTIONAL_MD_SKILL_MARKER', 'FICTIONAL_ZIP_SKILL_MARKER', 'FICTIONAL_REFERENCE_MARKER']);
  pass('ZIP import previews supported references, ignores unsupported attachments, never runs scripts, and shares enabled guidance across API and hybrid model requests');

  modal = await openSkills(); await modal.getByRole('tab', { name: '联网安装', exact: true }).click(); await modal.getByTestId('skill-github-url').fill('http://127.0.0.1/private'); await modal.getByTestId('skill-install-url').click(); await expect(modal.getByRole('alert')).toContainText('公开 GitHub');
  await modal.getByTestId('skill-github-url').fill(networkUrl); await modal.getByTestId('skill-install-url').click(); await expect(skillRow(modal, 'fixture-network')).toBeVisible(); await expect(skillRow(modal, 'fixture-network').getByRole('switch')).toHaveAttribute('aria-checked', 'false'); await expect(modal.getByTestId('skill-content-preview')).toContainText('FICTIONAL_NETWORK_SKILL_MARKER'); await expect(modal.locator('.skill-manager-source')).toContainText(networkUrl);
  await modal.getByTestId('skill-github-url').fill('https://raw.githubusercontent.com/fictional-owner/missing/main/SKILL.md'); await modal.getByTestId('skill-install-url').click(); await expect(modal.getByRole('alert')).toContainText('下载失败'); await closeSkills(modal);
  assert.deepEqual(await app.evaluate(() => globalThis.__skillsAcceptanceNetwork), [networkUrl, 'https://raw.githubusercontent.com/fictional-owner/missing/main/SKILL.md']);
  const installed = await skillsList(); assert.equal(installed.length, 3); assert.equal(installed.find(skill => skill.id === 'fixture-network').source.kind, 'github');
  pass('GitHub URL installation uses the packaged parser and injected native DNS/fetch, writes exact source provenance, defaults to disabled, rejects local URLs and shows a controlled download error without real network access');

  await page.getByTestId('model-mode-codex').click(); await openModels();
  await expect(page.getByTestId('subscription-connection')).toHaveValue('codex'); await expect(page.getByTestId('subscription-model')).toHaveValue('original-codex-fixture');
  await page.getByTestId('subscription-connection').selectOption('minimax'); await expect(page.getByTestId('model-channel-codex')).toContainText('M Plan'); await expect(page.getByTestId('model-channel-codex')).toContainText('按量');
  await page.getByTestId('subscription-connection').selectOption('compatible');
  const vendorOptions = await page.getByTestId('subscription-vendor').locator('option').allTextContents(); for (const name of ['Claude', 'Grok', 'Gemini', 'DeepSeek']) assert.ok(vendorOptions.includes(name));
  await expect(page.getByTestId('model-channel-codex')).toContainText('网页会员不能直接导入为接口额度');
  for (const [vendor, protocol, domain] of [['claude', 'anthropic', 'api.anthropic.com'], ['grok', 'openai', 'api.x.ai'], ['gemini', 'gemini', 'generativelanguage.googleapis.com'], ['deepseek', 'openai', 'api.deepseek.com']]) {
    await page.getByTestId('subscription-key').fill('fictional-key-to-clear'); await page.getByTestId('subscription-vendor').selectOption(vendor); await expect(page.getByTestId('subscription-protocol')).toHaveValue(protocol); await expect(page.getByTestId('subscription-endpoint')).toHaveValue(new RegExp(domain.replaceAll('.', '\\.'))); await expect(page.getByTestId('subscription-key')).toHaveValue('');
  }
  const config = { connection: 'compatible', vendor: 'other', protocol: 'openai', endpoint: endpoint + '/plans/v1', model: 'fixture-plan', apiKey: 'fictional-imported-plan-key' };
  await page.locator('.subscription-config-actions input[type="file"]').setInputFiles({ name: 'fixture-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)) }); await expect(page.getByTestId('subscription-model')).toHaveValue('fixture-plan'); await expect(page.getByTestId('subscription-key')).toHaveValue(config.apiKey); await saveModels();
  assert.equal(await page.evaluate(() => window.bidDesktop.getSubscriptionApiKey()), config.apiKey); assert.equal(await page.evaluate(key => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(key), config.apiKey), false);
  assert.equal((await storedSettings()).codexModel, 'original-codex-fixture');
  await chat('codex', ['FICTIONAL_MD_SKILL_MARKER', 'FICTIONAL_ZIP_SKILL_MARKER', 'FICTIONAL_REFERENCE_MARKER']);
  await capture('compatible-plan-config');
  await page.getByTestId('subscription-connection').selectOption('codex'); await expect(page.getByTestId('subscription-key')).toHaveCount(0); await expect(page.getByTestId('subscription-model')).toHaveValue('original-codex-fixture'); await saveModels(); assert.equal(await page.evaluate(() => window.bidDesktop.getSubscriptionApiKey()), '');
  await page.locator('.subscription-config-actions input[type="file"]').setInputFiles({ name: 'unsupported-session.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...config, cookie: 'fictional-session-cookie' })) }); await expect(page.locator('.model-settings-notice')).toContainText('不支持导入账号 Cookie');
  await closeModels(); pass('Model plans lists MiniMax and authorized providers, preserves Codex settings, imports JSON connection data, clears keys when switching connections, stores no key in browser storage, and supplies the same Skills to a real compatible-plan HTTP request');

  for (const [width, height, zoom] of [[1480, 960, 1], [760, 900, 1.25]]) for (const locale of ['zh', 'en']) for (const theme of ['dark', 'light']) {
    const name = `${width}-${Math.round(zoom * 100)}-${locale}-${theme}`; await resize(width, height, zoom); await themeLocale(locale, theme); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await settled();
    const layout = await page.evaluate(collectWorkbenchLayout); report.layouts.push({ name, layout }); assertWorkbenchLayout(layout, name); await expect(page.getByTestId('model-mode-codex')).toHaveText(locale === 'zh' ? '模型套餐' : 'Model plans');
    modal = await openSkills(); await inspectModal(name, modal); await expect(modal.locator('.skill-manager-list > li')).toHaveCount(3);
    if (locale === 'en') {
      await expect(skillRow(modal, 'fixture-md').locator('.skill-manager-list-state > span')).toHaveText('1 file');
      await expect(skillRow(modal, 'fixture-zip').locator('.skill-manager-list-state > span')).toHaveText('3 files');
      await skillRow(modal, 'fixture-zip').locator('.skill-manager-view').click(); await expect(modal.getByTestId('skill-content-preview')).toContainText('FICTIONAL_ZIP_SKILL_MARKER');
      await expect(modal.locator('.skill-manager-attachment-summary')).toContainText('1 reference'); await expect(modal.locator('.skill-manager-attachment-summary')).toContainText('1 unused attachment');
      if (width === 760) await modal.locator('.skill-manager-preview').scrollIntoViewIfNeeded();
      await inspectModal(name + '-preview', modal);
    }
    await capture(name + '-skills'); await closeSkills(modal);
    pass(name + ': localized two-row model bar and Skills manager fit the window with reachable controls and focus restoration');
  }
  await resize(1480, 960, 1, true); await themeLocale('zh', 'dark'); modal = await openSkills(); await inspectModal('maximized', modal); await capture('maximized-skills'); await closeSkills(modal); pass('Maximized window preserves the model-row Skills button and readable manager layout');
  const beforeRestart = await skillsList(); await app.close(); app = null; await launch();
  assert.deepEqual(await skillsList(), beforeRestart); assert.equal(await page.evaluate(() => window.bidDesktop.getSubscriptionApiKey()), ''); assert.equal(await page.evaluate(() => localStorage.getItem('cavwic-plans-skills-memory-fixture')), 'keep-existing-project-memory'); assert.equal((await storedSettings()).codexModel, 'original-codex-fixture'); assert.equal(fs.existsSync(sentinel), false);
  pass('Restart restores imported Skills, enabled states, source metadata and old Codex configuration; session-only plan keys clear and bundled scripts remain unexecuted');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []); report.success = true;
})().catch(async error => { report.success = false; report.failure = error.stack; process.exitCode = 1; console.error(error.stack); if (page && !page.isClosed()) await capture('failure').catch(() => {}); }).finally(async () => {
  if (app) await app.close().catch(() => {}); server.close(); fs.writeFileSync(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2)); console.log('Report: ' + path.join(runRoot, 'report.json'));
});
