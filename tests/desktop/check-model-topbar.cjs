'use strict';

// Regression for the frameless chrome being scrolled away while model settings
// open. This owns one isolated profile and never calls a model or cleans files.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('playwright/test');
const { sourceElectronExecutable, fieldThemeSettled } = require('./test-runtime.cjs');
const ROOT = path.resolve(__dirname, '../..');
const reproduce = process.argv.includes('--reproduce');
const packaged = Boolean(process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE);
const executablePath = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || sourceElectronExecutable();
const runRoot = path.join(ROOT, '.cache', 'validation', 'model-topbar-' + Date.now());
const profile = path.join(runRoot, 'profile');
fs.mkdirSync(profile, { recursive: true });
const profileSource = process.env.PRESALES_TOPBAR_PROFILE_SOURCE;
if (profileSource) {
  const allowed = path.join(ROOT, 'preserved', 'original-before-linear-20261111', 'original-profile');
  assert.equal(path.resolve(profileSource), allowed, 'Only the retained independent original profile may seed this reproduction');
  fs.cpSync(allowed, profile, { recursive: true, filter: source => {
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Profile reproduction must not follow links');
    return !/^(?:Cache|Code Cache|GPUCache|Crashpad|blob_storage|Dawn.*|LOCK|Singleton.*|DevToolsActivePort)$/i.test(path.basename(source));
  } });
}
const report = { success: false, reproduce, runRoot, profile, executablePath, checks: [], observations: [], screenshots: [], pageErrors: [], externalRequests: [] };
let application, page;
const passed = name => { report.checks.push(name); console.log('PASS ' + name); };

function observe() {
  const box = element => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, inside: r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1, hit: hit === element || element.contains(hit) };
  };
  const panel = document.querySelector('.model-controls');
  return {
    width: innerWidth, height: innerHeight,
    scrolls: { html: document.documentElement.scrollTop, body: document.body.scrollTop, scrolling: document.scrollingElement?.scrollTop || 0, outerMain: document.querySelector('body > main')?.scrollTop || 0 },
    header: box(document.querySelector('.lab-header')),
    close: box(document.getElementById('window-close')),
    collapse: box(document.querySelector('.model-expand-toggle')),
    controls: [...document.querySelectorAll('.lab-header button')].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden').map(element => ({ label: element.getAttribute('aria-label') || element.textContent.trim(), ...box(element) })),
    panel: panel && { ...box(panel), hidden: panel.hidden, scrollTop: panel.scrollTop, clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight },
  };
}

// ModelControls historically initiated smooth scrollIntoView, so checking on
// the click's first frame misses the regression. Wait for the animation to end.
async function settleScroll() {
  await page.evaluate(() => new Promise(resolve => {
    const started = performance.now();
    let last = '', stable = 0;
    const frame = () => {
      const panel = document.querySelector('.model-controls');
      const current = JSON.stringify([document.documentElement.scrollTop, document.body.scrollTop, document.querySelector('body > main')?.scrollTop || 0, panel?.scrollTop || 0, document.querySelector('.lab-header')?.getBoundingClientRect().top]);
      stable = current === last ? stable + 1 : 0; last = current;
      if ((performance.now() - started >= 650 && stable >= 6) || performance.now() - started > 1800) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
}

async function screenshot(name) {
  const filename = path.join(runRoot, name + '.png');
  const bytes = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(filename, Buffer.from(bytes, 'base64')); report.screenshots.push(filename);
}

async function inspect(name, maySmoothScroll = true) {
  if (maySmoothScroll) await settleScroll();
  else await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const state = await page.evaluate(observe);
  report.observations.push({ name, ...state });
  assert.equal(state.header.inside, true, name + ': the full topbar escaped the viewport');
  assert.ok(Math.abs(state.header.top) <= 1, name + ': topbar moved from the window edge');
  for (const [label, control] of [['native close', state.close], ['model collapse', state.collapse]]) {
    assert.equal(control.inside, true, name + ': ' + label + ' is outside the viewport');
    assert.equal(control.hit, true, name + ': ' + label + ' is covered');
  }
  for (const control of state.controls) {
    assert.equal(control.inside, true, name + ': topbar button is outside the viewport: ' + control.label);
    assert.equal(control.hit, true, name + ': topbar button is covered: ' + control.label);
  }
  for (const [element, offset] of Object.entries(state.scrolls)) assert.equal(offset, 0, name + ': outer chrome ancestor scrolled: ' + element);
  return state;
}

async function resize(width, height, zoom) {
  await application.evaluate(({ BrowserWindow }, options) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(options.width, options.height); win.setPosition(0, 0); win.webContents.setZoomFactor(options.zoom);
  }, { width, height, zoom });
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  await expect.poll(async () => Math.abs(await page.evaluate(() => innerWidth) - bounds.width / zoom)).toBeLessThanOrEqual(1);
}

async function present(locale, theme) {
  if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#global-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-locale', locale);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect.poll(() => page.evaluate(fieldThemeSettled)).toBe(true);
}

async function collapse() {
  if (await page.locator('.model-expand-toggle').getAttribute('aria-expanded') === 'true') await page.locator('.model-expand-toggle').click();
  await expect(page.locator('.model-controls')).toBeHidden();
}

async function scrollPanelToEnd(name) {
  await page.locator('.model-controls').evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
  const state = await inspect(name, false);
  if (state.panel.scrollHeight > state.panel.clientHeight + 1) assert.ok(state.panel.scrollTop > 0, name + ': settings panel itself cannot scroll');
}

const timeout = setTimeout(() => {
  report.timedOut = true; process.exitCode = 1;
  if (application) void application.close().catch(() => {});
}, 150000);

(async () => {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath, args: packaged ? [] : [ROOT], env, timeout: 30000 });
  page = await application.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
  await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true', { timeout: 20000 });
  const identity = await application.evaluate(({ app }) => ({ userData: app.getPath('userData'), version: app.getVersion() }));
  assert.equal(identity.userData, profile); report.version = identity.version;
  await resize(1480, 960, 1); await present('zh', 'dark');

  if (reproduce) {
    report.before = await page.evaluate(observe);
    report.reproduced = false;
    for (const [width,height,zoom] of (profileSource ? [[2382,1631,1.25]] : [[1480,960,1],[760,540,1.25],[2382,1631,1.25]])) {
      await resize(width,height,zoom);
      for (const mode of ['local','hybrid','codex','cloud']) {
        await page.getByTestId('model-mode-' + mode).click(); await settleScroll();
        report.after = await page.evaluate(observe);
        report.observations.push({ name: `${width}-${height}-${zoom}-${mode}`, ...report.after });
        if (!report.after.close.inside || !report.after.header.inside || Object.values(report.after.scrolls).some(offset => offset !== 0)) { report.reproduced = true; break; }
      }
      if (report.reproduced) break;
    }
    await screenshot('unfixed-open-local');
    assert.equal(report.reproduced, true, 'The original topbar regression was not reproduced');
    report.success = true; return;
  }

  for (const [width, height, zoom] of [[1480, 960, 1], [760, 540, 1.25]]) for (const locale of ['zh', 'en']) for (const theme of ['light', 'dark']) {
    const context = `${width}x${height}-${Math.round(zoom * 100)}-${locale}-${theme}`;
    await resize(width, height, zoom); await collapse(); await present(locale, theme); await inspect(context + '-collapsed', false);
    for (const mode of ['local', 'codex', 'cloud', 'hybrid']) {
      await page.getByTestId('model-mode-' + mode).click();
      await expect(page.locator('#workbench-model-settings')).toBeVisible();
      await inspect(context + '-' + mode + '-opened');
      await page.getByTestId('model-mode-' + mode).click();
      await inspect(context + '-' + mode + '-same-mode');
      await scrollPanelToEnd(context + '-' + mode + '-scrolled');
      await collapse(); await inspect(context + '-' + mode + '-collapsed', false);
    }
    await page.locator('.model-expand-toggle').click(); await inspect(context + '-arrow-open'); await collapse();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('bid-model-settings-open', { detail: { task: 'presales' } })));
    await expect(page.locator('#workbench-model-settings')).toBeVisible();
    await inspect(context + '-task-event-open'); await scrollPanelToEnd(context + '-task-event-scroll');
    await page.locator('.model-routing select').last().focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.model-save-button')).toBeFocused();
    await inspect(context + '-keyboard-focus-save');
    await screenshot(context + '-settings'); await collapse();
    passed(context + ': all modes, repeated selection, panel scrolling, arrow and task event preserve reachable chrome');
  }

  await resize(1480, 960, 1); await present('zh', 'dark');
  await page.getByTestId('model-mode-hybrid').click(); await inspect('native-before-maximize');
  await page.locator('#window-maximize').click(); await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true); await inspect('native-maximized');
  await page.locator('#window-maximize').click(); await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false); await inspect('native-restored');
  await page.locator('#window-minimize').click(); await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
  await application.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); win.focus(); });
  await inspect('native-restored-from-minimize');
  passed('Native maximize, restore and minimize remain operable with model settings open');
  await page.getByTestId('model-mode-local').click(); await inspect('final-local-open'); await screenshot('fixed-local-topbar');
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  const closed = application.waitForEvent('close', { timeout: 10000 });
  await page.locator('#window-close').click(); await closed;
  passed('Native close button closes the app while local model settings are open');
  report.success = true;
})().catch(async error => {
  report.failure = error.stack; process.exitCode = 1;
  if (page && !page.isClosed()) await screenshot('failure').catch(() => {});
}).finally(async () => {
  clearTimeout(timeout);
  if (application) await application.close().catch(() => {});
  const reportPath = path.join(runRoot, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ success: report.success, reproduced: report.reproduced, checks: report.checks.length, reportPath, ...(report.failure ? { failure: report.failure } : {}) }));
});
