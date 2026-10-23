'use strict';

// Layout-only acceptance: an isolated Electron profile, no model calls, no cleanup.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('playwright/test');
const { collectWorkbenchLayout, assertWorkbenchLayout } = require('./layout-contract.cjs');
const ROOT = path.resolve(__dirname, '../..');
const runRoot = path.join(ROOT, '.cache', 'validation', 'workbench-layout-' + Date.now());
const profile = path.join(runRoot, 'profile');
const executablePath = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || path.join(ROOT, 'release', '售前解决方案工具-win-x64', '售前解决方案工具.exe');
const expectedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
fs.mkdirSync(profile, { recursive: true });
const report = { runRoot, profile, executablePath, expectedVersion, checks: [], layouts: [], screenshots: [], pageErrors: [], externalRequests: [] };
let app, page;
const pass = (name, details) => { report.checks.push({ name, details }); console.log('PASS ' + name); };
const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function screenshot(name) {
  await page.mouse.move(3, 300); await settled();
  const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const filename = path.join(runRoot, name + '.png'); fs.writeFileSync(filename, Buffer.from(image, 'base64')); report.screenshots.push(filename);
}

async function resize(width, height, zoom, maximized = false) {
  await app.evaluate(({ BrowserWindow }, input) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(input.width, input.height); win.setPosition(0, 0); win.webContents.setZoomFactor(input.zoom); if (input.maximized) win.maximize(); }, { width, height, zoom, maximized });
  const native = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return { bounds: win.getContentBounds(), zoom: win.webContents.getZoomFactor(), maximized: win.isMaximized() }; });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(native.bounds.width / zoom, 0);
  await settled(); return native;
}

async function themeLocale(locale, theme) {
  if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#global-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-locale', locale); await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await settled();
  // Textareas animate their background for 140ms. Capture the finished theme,
  // not a gray intermediate frame while switching between dark and light.
  await expect.poll(() => page.evaluate(theme => {
    const field = document.querySelector('.confirmable-textarea:not(.confirmed) textarea');
    return !field || getComputedStyle(field).backgroundColor === (theme === 'dark' ? 'rgb(26, 41, 57)' : 'rgb(255, 255, 255)');
  }, theme)).toBe(true);
}

async function inspect(name, locale, capture = true) {
  const layout = await page.evaluate(collectWorkbenchLayout); report.layouts.push({ name, layout }); assertWorkbenchLayout(layout, name);
  const fields = await page.evaluate(() => [...document.querySelectorAll('.confirmable-textarea textarea')].slice(0, 2).map(field => ({ background: getComputedStyle(field).backgroundColor, disabled: field.disabled, readOnly: field.readOnly, focused: field === document.activeElement, hovered: field.matches(':hover'), transition: getComputedStyle(field).transition, classes: field.closest('.confirmable-textarea').className })));
  report.layouts[report.layouts.length - 1].textareaStyles = fields;
  const labels = await page.locator('.project-header .workspace-toolbar button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  assert.deepEqual(labels, locale === 'zh' ? ['新建项目', '项目设置', '文件清理'] : ['New project', 'Project settings', 'File cleanup']);
  assert.deepEqual(await page.locator('.header-metrics > div > span').allTextContents(), locale === 'zh' ? ['招标要求', '已绑定证据', '已批准', '待批准'] : ['Tender requirements', 'With evidence', 'Approved', 'Pending approval']);
  assert.equal(await page.locator('.project-header > div:first-child').evaluate(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).every(node => !node.textContent.trim())), true);
  for (const button of layout.actions.buttons) { assert.equal(button.inside, true, name + ': main action outside viewport: ' + button.label); assert.equal(button.hit, true, name + ': main action covered: ' + button.label); }
  if (capture) await screenshot(name);
  return layout;
}

async function checkPanels(locale) {
  const project = page.locator('.project-header .project-path-command'); await project.click(); await expect(page.locator('.project-settings-panel')).toBeVisible();
  await page.getByRole('button', { name: locale === 'zh' ? '关闭项目设置' : 'Close project settings', exact: true }).click(); await expect(page.locator('.project-settings-panel')).toHaveCount(0);
  await page.locator('.project-header .file-cleanup-command').click();
  const modal = page.getByTestId('file-cleanup-dialog'); await expect(modal).toBeVisible(); await expect(modal.locator('.file-cleanup-body')).toHaveAttribute('aria-busy', 'false');
  await expect(modal.locator('input:checked')).toHaveCount(0); await expect(modal.getByTestId('cleanup-review')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(page.locator('.file-cleanup-command')).toBeFocused();
}

(async () => {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: [], env, timeout: 30000 }); page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
  await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true', { timeout: 20000 });
  await expect(page.locator('.file-cleanup-command')).toBeEnabled();
  const identity = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), version: app.getVersion() }));
  assert.equal(identity.userData, profile); assert.equal(identity.version, expectedVersion);
  pass('Packaged app uses only the dedicated layout-test profile', identity);

  for (const [width, height, zoom] of [[1480, 960, 1], [1280, 900, 1], [760, 900, 1.25]]) for (const locale of ['zh', 'en']) for (const theme of ['dark', 'light']) {
    const name = `${width}-${Math.round(zoom * 100)}-${locale}-${theme}`;
    await resize(width, height, zoom); await themeLocale(locale, theme); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await settled();
    const initial = await inspect(name, locale);
    await checkPanels(locale);
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await settled();
    const scrolled = await inspect(name + '-scrolled', locale, false);
    for (const item of ['header', 'brand', 'undo', 'redo', 'models', 'windowControls', 'actions']) assert.ok(Math.abs(initial[item].top - scrolled[item].top) <= 1, name + ': sticky control moved with document scroll: ' + item);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    pass(name + ': two-row topbar, one history pair beside brand, ordered right window controls, three main-title actions, removed subtitle without a gap, retained statistics and working panel buttons');
  }

  await resize(1480, 960, 1); await themeLocale('zh', 'dark');
  const nameField = page.getByLabel('项目名称', { exact: true }), originalName = await nameField.inputValue();
  await nameField.fill('公开虚构布局验收项目'); await expect(page.locator('#global-history-undo')).toBeEnabled();
  await page.locator('#global-history-undo').click(); await expect(nameField).toHaveValue(originalName); await expect(page.locator('#global-history-redo')).toBeEnabled();
  await page.locator('#global-history-redo').click(); await expect(nameField).toHaveValue('公开虚构布局验收项目');
  await expect(page.locator('.project-header')).not.toContainText('公开虚构布局验收项目');
  await screenshot('history-restored');
  pass('Relocated history buttons undo and redo an actual project-name edit, while the name remains absent from the title area');

  await page.locator('.project-header .workspace-toolbar button').first().click(); await expect(nameField).toHaveValue(originalName);
  await page.locator('.model-expand-toggle').click(); await expect(page.locator('#workbench-model-settings')).toBeVisible(); await page.locator('.model-expand-toggle').click(); await expect(page.locator('#workbench-model-settings')).toHaveCount(0);
  pass('New project works from below the page title and model settings still expand from the second topbar row');

  for (const [name, width, height, zoom, maximized] of [['short-540', 1480, 540, 1, false], ['maximized', 1480, 960, 1, true]]) {
    const native = await resize(width, height, zoom, maximized); await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await settled(); await inspect(name, 'zh'); pass(name + ': responsive layout remains usable', native);
  }
  await page.locator('#window-maximize').click(); await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  await page.locator('#window-minimize').click(); await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); win.focus(); });
  pass('Right-side maximize/restore and minimize buttons still control the isolated native window');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []); report.success = true;
})().catch(async error => { report.success = false; report.failure = error.stack; process.exitCode = 1; console.error(error.stack); if (page && !page.isClosed()) await screenshot('failure').catch(() => {}); }).finally(async () => {
  if (app) await app.close().catch(() => {});
  fs.writeFileSync(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2)); console.log('Report: ' + path.join(runRoot, 'report.json'));
});
