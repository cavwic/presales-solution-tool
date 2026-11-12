'use strict';

// Regression for clipped workspace identities and headings beneath the model
// toolbar. All changes belong to a fresh, isolated test profile.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('playwright/test');
const { sourceElectronExecutable, fieldThemeSettled } = require('./test-runtime.cjs');
const ROOT = path.resolve(__dirname, '../..');
const reproduce = process.argv.includes('--reproduce');
const actionsOnly = process.argv.includes('--actions-only');
const executablePath = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || sourceElectronExecutable();
const packaged = Boolean(process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE);
const runRoot = path.join(ROOT, '.cache', 'validation', 'workspace-clipping-' + Date.now());
const profile = path.join(runRoot, 'profile');
fs.mkdirSync(profile, { recursive: true });
if (reproduce) {
  const original = path.join(ROOT, 'preserved', 'original-before-linear-20261111', 'original-profile');
  fs.cpSync(original, profile, { recursive: true, filter: source => {
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Profile reproduction must not follow links');
    return !/^(?:Cache|Code Cache|GPUCache|Crashpad|blob_storage|Dawn.*|LOCK|Singleton.*|DevToolsActivePort)$/i.test(path.basename(source));
  } });
}
const report = { success: false, reproduce, runRoot, profile, executablePath, checks: [], observations: [], screenshots: [], pageErrors: [], externalRequests: [] };
let app, page;
const pass = name => { report.checks.push(name); console.log('PASS ' + name); };

function observe() {
  const box = element => {
    if (!element || !element.getClientRects().length) return null;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const r = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const s = getComputedStyle(parent), p = parent.getBoundingClientRect();
      if (/(?:auto|scroll|hidden|clip)/.test(s.overflowX)) { clip.left = Math.max(clip.left, p.left); clip.right = Math.min(clip.right, p.right); }
      if (/(?:auto|scroll|hidden|clip)/.test(s.overflowY)) { clip.top = Math.max(clip.top, p.top); clip.bottom = Math.min(clip.bottom, p.bottom); }
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      fullyVisible: r.width > 0 && r.height > 0 && r.left >= clip.left - 1 && r.right <= clip.right + 1 && r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1,
      hit: hit === element || element.contains(hit), clip, fontSize: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), paddingY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), borderY: parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) };
  };
  const frameSelectors = ['html', 'body', 'body > main', '.solution-app', '.linear-main-shell', '.linear-workspace', '.linear-content-scroll', '.linear-sidebar', '.linear-sidebar-scroll'];
  const frames = Object.fromEntries(frameSelectors.map(selector => { const e = document.querySelector(selector); return [selector, e ? { scrollTop: e.scrollTop, scrollLeft: e.scrollLeft, overflowY: getComputedStyle(e).overflowY, clientHeight: e.clientHeight, scrollHeight: e.scrollHeight, box: box(e) } : null]; }));
  return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth, frames,
    workspaceHidden: getComputedStyle(document.querySelector('.linear-workspace')).display === 'none',
    header: box(document.querySelector('.lab-header')), close: box(document.querySelector('#window-close')),
    modelToggle: box(document.querySelector('.model-expand-toggle')), modelPanel: box(document.querySelector('.model-controls:not([hidden])')),
    sidebar: box(document.querySelector('.linear-sidebar')), project: box(document.querySelector('.linear-project-switcher')),
    avatar: box(document.querySelector('.linear-workspace-avatar')), search: box(document.querySelector('.linear-material-search')),
    viewbar: box(document.querySelector('.linear-viewbar')), viewtabs: box(document.querySelector('.linear-view-tabs')),
    document: box(document.querySelector('.linear-document')), title: box(document.querySelector('.linear-document-title')),
    activeStage: box(document.querySelector('.linear-stage-nav > button[aria-current="page"]')) };
}

async function settle() {
  await page.evaluate(() => new Promise(resolve => {
    const start = performance.now(); let last = '', stable = 0;
    const frame = () => {
      const now = JSON.stringify([...document.querySelectorAll('html,body,body > main,.solution-app,.linear-main-shell,.linear-workspace,.linear-sidebar,.linear-document')].map(e => [e.scrollTop, e.getBoundingClientRect().top]));
      stable = now === last ? stable + 1 : 0; last = now;
      if ((performance.now() - start > 500 && stable > 5) || performance.now() - start > 1600) resolve(); else requestAnimationFrame(frame);
    }; requestAnimationFrame(frame);
  }));
}

async function capture(name) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const filename = path.join(runRoot, name + '.png');
  const bytes = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(filename, Buffer.from(bytes, 'base64')); report.screenshots.push(filename);
}

function clippingProblems(state, requireIdentity = true) {
  const problems = [];
  for (const selector of ['html', 'body', 'body > main', '.solution-app', '.linear-main-shell', '.linear-workspace', '.linear-sidebar', ...(state.width > 1000 ? ['.linear-content-scroll'] : [])]) {
    const frame = state.frames[selector];
    if (!frame || Math.abs(frame.scrollTop) > 1 || Math.abs(frame.scrollLeft) > 1) problems.push(selector + ' unexpectedly scrolled');
  }
  for (const name of ['header', 'close', 'modelToggle']) if (!state[name]?.fullyVisible || !state[name]?.hit) problems.push(name + ' is clipped or covered');
  const workspaceTop = state.frames['.linear-workspace']?.box?.top;
  if (workspaceTop < state.header.bottom - 1) problems.push('workspace moved under native toolbar');
  if (state.modelPanel && (!state.modelPanel.fullyVisible || state.modelPanel.top < state.header.bottom - 1 || state.modelPanel.bottom > workspaceTop + 1)) problems.push('settings panel overlaps or clips the workspace');
  if (state.width > 1000 || requireIdentity) {
    for (const name of ['viewbar', 'viewtabs']) if (state[name] && !state[name].fullyVisible) problems.push(name + ' is clipped');
  }
  if (requireIdentity && state.width > 760) for (const name of ['project', 'avatar', 'search']) if (state[name] && !state[name].fullyVisible) problems.push('sidebar ' + name + ' is clipped');
  if (requireIdentity && state.width > 760) for (const name of ['project','search']) if (state[name] && !state[name].hit) problems.push('sidebar ' + name + ' is covered');
  if (state.pageWidth > state.width + 1) problems.push('horizontal page overflow');
  return problems;
}

async function inspect(name, options = {}) {
  await settle();
  const state = await page.evaluate(observe); report.observations.push({ name, ...state });
  const problems = clippingProblems(state, options.identity !== false);
  assert.deepEqual(problems, [], name + ': ' + problems.join('; '));
  assert.equal(state.workspaceHidden, Boolean(state.modelPanel && state.height <= 760), name + ': short settings presentation did not switch or restore the workspace');
  if (options.title) {
    assert.equal(state.title?.fullyVisible, true, name + ': project title is clipped');
    assert.ok(state.title.height + 1 >= state.title.lineHeight + state.title.paddingY + state.title.borderY, name + ': input height clips title glyphs');
  }
  return state;
}

async function resize(width, height, zoom = 1) {
  await app.evaluate(({ BrowserWindow }, options) => { const win = BrowserWindow.getAllWindows()[0]; if (win.isMaximized()) win.unmaximize(); win.setContentSize(options.width, options.height); win.setPosition(0, 0); win.webContents.setZoomFactor(options.zoom); }, { width, height, zoom });
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentBounds());
  await expect.poll(async () => Math.abs(await page.evaluate(() => innerWidth) - bounds.width / zoom)).toBeLessThanOrEqual(1);
}

async function presentation(locale, theme) {
  if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#global-theme-toggle').click();
  await expect.poll(() => page.evaluate(fieldThemeSettled)).toBe(true);
}

async function collapseModels() {
  if (await page.locator('.model-expand-toggle').getAttribute('aria-expanded') === 'true') await page.locator('.model-expand-toggle').click();
  await expect(page.locator('.model-controls')).toBeHidden();
}

async function inspectProjectSettings(name) {
  const dialog=page.getByTestId('project-settings-dialog'); await expect(dialog).toBeVisible();
  const state=await dialog.evaluate(element=>{
    const r=element.getBoundingClientRect(), close=element.querySelector('.project-settings-heading > button'), c=close.getBoundingClientRect(), hit=document.elementFromPoint(c.left+c.width/2,c.top+c.height/2);
    return { modal:element.matches(':modal'),focused:element.contains(document.activeElement),inside:r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1,
      closeHit:c.top>=r.top-1&&c.bottom<=r.bottom+1&&(hit===close||close.contains(hit)),
      frameScrolls:[document.documentElement,document.body,document.querySelector('body > main'),document.querySelector('.solution-app'),document.querySelector('.linear-workspace'),document.querySelector('.linear-main-shell'),document.querySelector('.linear-sidebar')].map(frame=>[frame.scrollTop,frame.scrollLeft]) };
  });
  assert.equal(state.modal,true,name+': settings did not open in its own modal');
  assert.equal(state.focused,true,name+': settings did not receive focus');
  assert.equal(state.inside,true,name+': settings modal escapes the window');
  assert.equal(state.closeHit,true,name+': settings close button is covered');
  for(const offset of state.frameScrolls) assert.deepEqual(offset,[0,0],name+': settings scrolled a fixed ancestor');
  await expect(page.locator('.linear-document .project-settings-panel')).toHaveCount(0);
  report.observations.push({name,...state});
}

async function documentStart() {
  await page.evaluate(() => { for (const selector of ['.linear-content-scroll', '.linear-document']) document.querySelector(selector)?.scrollTo({ top: 0, behavior: 'instant' }); });
}

const timer = setTimeout(() => { report.timedOut = true; process.exitCode = 1; if (app) void app.close().catch(() => {}); }, 180000);
(async () => {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: packaged ? [] : [ROOT], env, timeout: 30000 }); page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
  await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true', { timeout: 20000 });
  const identity = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), version: app.getVersion() }));
  assert.equal(identity.userData, profile); report.version = identity.version;

  if (reproduce) {
    report.reproduced = false;
    for (const [width, height, zoom] of [[2382,1631,1.25], [1480,960,1], [1480,540,1.25], [760,540,1.25]]) {
      await resize(width,height,zoom); await presentation('zh','dark');
      for (const mode of ['local','hybrid']) {
        await page.getByTestId('model-mode-' + mode).click(); await settle();
        await page.locator('.linear-viewbar .icon-command').click(); await settle();
        report.after = await page.evaluate(observe);
        report.afterProblems = clippingProblems(report.after); report.observations.push({ name: `${width}-${height}-${zoom}-${mode}-settings`, ...report.after });
        if (report.afterProblems.length) { report.reproduced = true; break; }
        const closeSettings = page.getByRole('button', { name: '关闭项目设置', exact: true }); if (await closeSettings.count()) await closeSettings.click();
        await collapseModels();
        await page.locator('.linear-sidebar-footer .project-path-command').click(); await settle();
        report.after = await page.evaluate(observe); report.afterProblems = clippingProblems(report.after);
        if (report.afterProblems.length) { report.reproduced = true; break; }
        if (await closeSettings.count()) await closeSettings.click();
      }
      if (report.reproduced) break;
    }
    await capture('unfixed-workspace-clipping');
    assert.equal(report.reproduced, true, 'No workspace clipping was reproduced in the requested original contexts');
    report.success = true; return;
  }

  // Public fixture has no native directory grant, so '+' only writes this test's local cache.
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT,'tests','fixtures','skill-workspace','projects','fixture-project','project.json'),'utf8'));
  fixture.name = '公开虚构窗口自适应验收项目 / Fictional responsive workspace';
  fixture.localPathHint = '';
  await page.evaluate(project => localStorage.setItem('cavwic-solution-workspace', JSON.stringify(project)), fixture);
  await page.reload(); await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.linear-content-scroll')).toHaveCount(1);
  await expect(page.locator('.linear-sidebar-scroll')).toHaveCount(1);

  const scenes = [[1480,960,1,'zh','dark'],[1480,960,1,'en','light'],[2382,1631,1.25,'zh','dark'],[1480,540,1.25,'zh','dark'],[760,680,1,'en','light'],[760,540,1.25,'zh','dark']];
  for (const [width,height,zoom,locale,theme] of (actionsOnly ? [] : scenes)) {
    const context = `${width}x${height}-${Math.round(zoom*100)}-${locale}-${theme}`;
    await resize(width,height,zoom); await collapseModels(); await presentation(locale,theme); await documentStart();
    await inspect(context+'-entry',{title:true});
    assert.equal(await page.locator('.linear-view-actions button').filter({ hasText: /新增沟通|Add communication/ }).count(),0,'Duplicate top communication action remains');
    for (const mode of ['local','codex','cloud','hybrid']) {
      await page.getByTestId('model-mode-'+mode).click();
      if (await page.locator('.model-controls').isHidden()) await page.locator('.model-expand-toggle').click();
      await inspect(context+'-'+mode+'-open');
      if (mode==='local' && (await page.evaluate(()=>innerHeight))<=760) await capture(context+'-model-focus');
      if (mode==='local' && (await page.evaluate(()=>innerHeight))>760) {
        await page.locator('.linear-viewbar .icon-command').click();
        await expect(page.locator('.project-settings-panel')).toBeVisible();
        await inspectProjectSettings(context+'-model-and-project-settings-modal');
        await page.getByRole('button',{name:locale==='zh'?'关闭项目设置':'Close project settings',exact:true}).click();
        await documentStart();
      }
      await page.locator('.model-controls').evaluate(element=>element.scrollTo({top:element.scrollHeight,behavior:'instant'}));
      await inspect(context+'-'+mode+'-panel-end');
      const save = page.locator('.model-save-button');
      await save.focus(); await inspect(context+'-'+mode+'-save-focused');
      const footerReachable = await save.evaluate(element => {
        const r = element.getBoundingClientRect(), panel = element.closest('.model-controls').getBoundingClientRect();
        const hit = document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        return r.top >= panel.top-1 && r.bottom <= panel.bottom+1 && r.left >= panel.left-1 && r.right <= panel.right+1 && (hit===element || element.contains(hit));
      });
      assert.equal(footerReachable,true,context+'-'+mode+': settings save button cannot be reached within the panel');
      await collapseModels(); await inspect(context+'-'+mode+'-closed',{title:true});
    }
    await page.locator('.linear-viewbar .icon-command').click(); await expect(page.locator('.project-settings-panel')).toBeVisible();
    await inspectProjectSettings(context+'-project-settings-modal');
    await page.getByRole('button',{name:locale==='zh'?'关闭项目设置':'Close project settings',exact:true}).click();
    await documentStart(); await inspect(context+'-settings-closed',{title:true});
    for (const button of await page.locator('.linear-stage-nav > button').all()) { await button.click(); await inspect(context+'-stage-switch'); }
    await page.locator('.linear-stage-nav > button').first().click(); await documentStart();
    await expect(page.locator('.linear-stage-nav > button').first()).toHaveAttribute('aria-current','page');
    await expect(page.locator('.linear-view-tab-label strong')).toHaveText(locale==='zh'?'售前准备':'Presales');
    await capture(context+'-workspace');
    if (width===760 && height===540 && zoom===1.25) await capture('fixed-short-workspace-restored');
    pass(context+': fixed frame boundaries, complete identities and model/settings/resize interactions');
  }

  await resize(1480,960,1); await presentation('zh','dark'); await collapseModels();
  await page.locator('.linear-stage-nav > button').first().click(); await documentStart();
  const plus = page.locator('#project-communications > .section-heading > button');
  assert.equal(await plus.count(),1);
  const beforeRounds = await page.locator('.presales-round').count(); await plus.click();
  await expect(page.locator('.presales-round')).toHaveCount(beforeRounds+1);
  await page.locator('.presales-round').last().getByRole('button',{name:'新增执行项',exact:true}).click();
  const responseName = page.locator('.presales-round').last().getByRole('textbox',{name:'响应文件名称',exact:true});
  await responseName.fill('公开虚构窗口检查响应文件');
  await expect(page.locator('.linear-pending-list')).toContainText('公开虚构窗口检查响应文件');
  await page.locator('.linear-pending-list > button').filter({hasText:'公开虚构窗口检查响应文件'}).click();
  await inspect('pending-item-jump');
  await documentStart(); await inspect('pending-jump-reset',{title:true});
  const title = page.locator('.linear-document-title'), longName='自适应项目名称 / '+ 'LongWorkspaceName'.repeat(14);
  await title.fill(longName); await inspect('long-project-title',{title:true});
  await resize(760,680,1.25); await inspect('long-project-resized'); await resize(1480,960,1); await documentStart(); await inspect('long-project-restored',{title:true});
  await title.fill(fixture.name); await documentStart();
  await expect(page.locator('.linear-stage-nav > button').first()).toHaveAttribute('aria-current','page');
  await expect(page.locator('.linear-view-tab-label strong')).toHaveText('售前准备');
  await capture('fixed-workspace-responsive');
  pass('Only the communication + remains, creates a node, and pending links and long titles preserve frame boundaries');
  assert.deepEqual(report.pageErrors,[]); assert.deepEqual(report.externalRequests,[]); report.success=true;
})().catch(async error=>{ report.failure=error.stack; process.exitCode=1; if(page&&!page.isClosed()) await capture('failure').catch(()=>{}); }).finally(async()=>{
  clearTimeout(timer); if(app) await app.close().catch(()=>{});
  const reportPath=path.join(runRoot,'report.json'); fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({success:report.success,reproduced:report.reproduced,checks:report.checks.length,reportPath,...(report.failure?{failure:report.failure}:{})}));
});
