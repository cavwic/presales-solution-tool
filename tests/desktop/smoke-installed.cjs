'use strict';

// Candidate/install acceptance. This process owns only its isolated profile and
// ElectronApplication; it never closes a running production instance.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('playwright/test');
const { collectWorkbenchLayout, assertWorkbenchLayout } = require('./layout-contract.cjs');
const ROOT = path.resolve(__dirname, '../..');
const executablePath = path.resolve(process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || path.join(ROOT, 'release', '售前解决方案工具-win-x64', '售前解决方案工具.exe'));
const runRoot = path.join(ROOT, '.cache', 'validation', 'installed-smoke-' + Date.now());
const profile = path.join(runRoot, 'profile'), reportPath = path.join(runRoot, 'report.json');
fs.mkdirSync(profile, { recursive: true });
const report = { success: false, executablePath, profile, checks: [], pageErrors: [], externalRequests: [], reportPath };
let application, page;
const passed = name => report.checks.push(name);
const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const deadline = setTimeout(() => {
  report.timedOut = true;
  process.exitCode = 1;
  if (application) void application.close().catch(() => {});
}, 90000);

async function resize(width, height, zoom) {
  await application.evaluate(({ BrowserWindow }, input) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(input.width, input.height); win.setPosition(0, 0); win.webContents.setZoomFactor(input.zoom); }, { width, height, zoom });
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeCloseTo(bounds.width / zoom, 0);
  await settled();
}

async function switchPresentation(locale, theme) {
  if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#global-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-locale', locale);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect.poll(() => page.evaluate(theme => {
    const field = document.querySelector('.confirmable-textarea:not(.confirmed) textarea');
    return !field || getComputedStyle(field).backgroundColor === (theme === 'dark' ? 'rgb(26, 41, 57)' : 'rgb(255, 255, 255)');
  }, theme)).toBe(true);
  await settled();
}

async function checkLayout(name) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await settled();
  const layout = await page.evaluate(collectWorkbenchLayout); assertWorkbenchLayout(layout, name);
  for (const button of layout.actions.buttons) { assert.equal(button.inside, true, name + ': project action outside viewport'); assert.equal(button.hit, true, name + ': project action covered'); }
}

(async () => {
  assert.ok(fs.existsSync(executablePath), 'Candidate executable does not exist');
  const packagePath = path.join(path.dirname(executablePath), 'resources', 'app', 'package.json');
  const candidate = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  assert.equal(candidate.name, 'cavwic-presales-solution-tool');
  report.version = candidate.version;
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath, args: [], env, timeout: 30000 });
  page = await application.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
  await page.emulateMedia({ colorScheme: null });
  await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true', { timeout: 20000 });
  await expect(page.getByTestId('import-skills')).toBeEnabled();
  const native = await application.evaluate(({ app, BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; return { version: app.getVersion(), userData: app.getPath('userData'), appPath: app.getAppPath(), executablePath: process.execPath, title: win.getTitle(), menu: win.isMenuBarVisible() }; });
  assert.equal(native.version, candidate.version); assert.equal(native.userData, profile);
  assert.equal(path.resolve(native.executablePath), executablePath);
  assert.equal(native.appPath, path.dirname(packagePath)); assert.equal(native.title, '售前解决方案工具'); assert.equal(native.menu, false);
  assert.equal(page.url(), 'bid://app/cavwic-solutions-lab/'); assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  passed('candidate version, offline assets, native title, isolated profile and renderer separation');

  await resize(1480, 960, 1); await switchPresentation('zh', 'dark');
  await page.locator('.model-expand-toggle').click(); await expect(page.locator('#workbench-model-settings')).toBeVisible();
  await expect(page.getByTestId('subscription-connection')).toHaveValue('codex');
  await page.locator('.model-expand-toggle').click(); await expect(page.locator('#workbench-model-settings')).toHaveCount(0);
  await page.locator('.project-path-command').click(); await expect(page.locator('.project-settings-panel')).toBeVisible();
  await page.getByRole('button', { name: '关闭项目设置', exact: true }).click(); await expect(page.locator('.project-settings-panel')).toHaveCount(0);
  await page.getByTestId('import-skills').click();
  const modal = page.getByTestId('skill-manager-dialog'); await expect(modal).toBeVisible(); await expect(modal.locator('.skill-manager-body')).toHaveAttribute('aria-busy', 'false');
  assert.equal(await modal.evaluate(element => element.matches(':modal') && element.contains(document.activeElement)), true);
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0); await expect(page.getByTestId('import-skills')).toBeFocused();
  passed('model settings, project settings and Skills modal open and close without requests');

  const name = page.getByLabel('项目名称', { exact: true }), original = await name.inputValue();
  await name.fill('虚构安装检查项目'); await expect(page.locator('#global-history-undo')).toBeEnabled();
  await page.locator('#global-history-undo').click(); await expect(name).toHaveValue(original); await expect(page.locator('#global-history-redo')).toBeEnabled();
  await page.locator('#global-history-redo').click(); await expect(name).toHaveValue('虚构安装检查项目');
  passed('relocated undo and redo restore an actual fictional edit');

  for (const [width, height, zoom] of [[1480, 960, 1], [760, 900, 1.25]]) for (const locale of ['zh', 'en']) for (const theme of ['dark', 'light']) {
    await resize(width, height, zoom); await switchPresentation(locale, theme);
    await checkLayout(`${width}-${zoom}-${locale}-${theme}`);
    await expect(page).toHaveTitle(locale === 'zh' ? '售前解决方案工具' : 'Presales Solution Tool');
    passed(`${width}/${Math.round(zoom * 100)}% ${locale} ${theme}: reachable controls and no horizontal overflow`);
  }
  await page.locator('#window-maximize').click(); await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
  await checkLayout('maximized');
  await page.locator('#window-maximize').click(); await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  await page.locator('#window-minimize').click(); await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); win.focus(); });
  passed('native maximize, restore and minimize controls');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  await resize(1480, 960, 1); await switchPresentation('zh', 'dark');
  report.screenshotPath = path.join(runRoot, 'installed.zh.png');
  await page.screenshot({ path: report.screenshotPath });
  report.success = true;
})().catch(async error => {
  report.failure = error.stack; process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(runRoot, 'failure.png') }).catch(() => {});
}).finally(async () => {
  clearTimeout(deadline);
  if (application) await application.close().catch(() => {});
  if (report.timedOut) report.success = false;
  if (!report.success) process.exitCode = 1;
  if (report.success) {
    try {
      const validationRoot = path.join(ROOT, '.cache', 'validation');
      assert.equal(path.dirname(runRoot), validationRoot);
      assert.equal(path.dirname(profile), runRoot);
      assert.equal(fs.lstatSync(profile).isSymbolicLink(), false);
      fs.rmSync(profile, { recursive: true, force: false });
      report.profileRemoved = true;
    } catch (error) { report.profileCleanupWarning = error.message; }
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, version: report.version, checks: report.checks.length, reportPath, ...(report.success ? {} : { error: report.failure || 'Installed smoke test timed out' }) }));
});
