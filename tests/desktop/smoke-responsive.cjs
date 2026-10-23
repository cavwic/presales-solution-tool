'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('playwright/test');
const { sourceElectronExecutable } = require('./test-runtime.cjs');
const schema = require('../../src/lib/workspace-schema.ts');

const ROOT = path.resolve(__dirname, '../..');
const executable = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || process.env.SOLUTION_TOOL_EXECUTABLE || process.env.BID_EXECUTABLE;
const run = path.join(ROOT, '.cache', 'validation', 'responsive-smoke-' + Date.now());
const profile = path.join(run, 'profile'), workspace = path.join(run, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
const report = { run, packaged: Boolean(executable), checks: [], observations: [], screenshots: [], errors: [] };
let application, page;
const time = '2026-10-23T00:00:00.000Z';
const longName = 'ResponsiveFixture-' + 'UnbrokenCustomerSystemIdentifier'.repeat(5);
const files = new Map();

function source(id, directory, text = '公开虚构响应式验收资料，仅用于检查页面布局。') {
  const name = id + '-UnbrokenTechnicalReferenceIdentifier'.repeat(2) + '.md';
  const relativePath = directory + '/' + name;
  files.set(relativePath, '# ' + name + '\n\n' + text + '\n');
  return schema.sourceDocumentSchema.parse({ id, name, fileType: 'md', version: '1.0', size: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), importedAt: time, workspacePath: relativePath, requiresOcr: false, preprocessStatus: 'ready', preprocessedAt: time, preprocessMessage: '虚构验收资料', segments: [{ id: id + '-line', locatorKind: 'line', locator: '第 1 行', text }] });
}

function fixtureProject() {
  const project = schema.projectManifestSchema.parse(JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'skill-workspace', 'projects', 'fixture-project', 'project.json'), 'utf8')));
  project.id = 'responsive-fixture'; project.name = longName;
  project.customerAlias = '公开虚构客户 / Fictional customer'; project.objective = '验证多阶段复杂数据在不同窗口、缩放、语言和主题下完整可读。';
  const customer = source('customer', '0_项目客户方资料');
  const enterprise = source('enterprise', '1_售前准备/1_企业资料');
  const tender = source('tender', '2_招标要求/1_招标文件');
  const clarification = source('clarification', '2_招标要求/2_澄清与补遗');
  const award = source('award', '4_中标交底/1_中标补充内容');
  const analysis = source('analysis', '2_招标要求/3_招标文件分析/1_招标要求分析');
  project.sources = [customer, enterprise, tender, clarification, award, analysis];
  project.enterpriseContext = { companyName: '虚构解决方案实验室', platform: '虚构系统平台', importedAt: time, notes: '仅作为响应式测试数据。', sourceIds: [enterprise.id] };
  project.presalesRounds = Array.from({ length: 3 }, (_, i) => ({ ...schema.createPresalesRound('zh', i + 1), id: 'round-' + i, meetingAt: '2026-10-23T10:00', participants: [{ id: 'participant-' + i, name: '虚构客户项目经理', category: 'customer' }], customerNeeds: '现场部署、系统接口与验收条件，需要保留完整来源和待确认事项。', requirementSourceIds: [customer.id], selectedRequirementSourceIds: [customer.id], referenceSourceIds: [enterprise.id], keywords: ['技术参数', '接口范围', '验收计划'], analysisRequirements: '核实技术范围、交付节奏、接口边界与证据位置。', analysisOutputFormat: 'md', analysisResults: [{ id: 'presales-result-' + i, name: '虚构客户需求分析', fileName: analysis.name, format: 'md', createdAt: time, provider: 'local', model: 'fixture-no-inference', sourceId: analysis.id, relativePath: analysis.workspacePath, prompt: '虚构验收', keywords: ['接口'], sourceIds: [customer.id], templateSourceIds: [] }], actions: Array.from({ length: 3 }, (_, a) => ({ id: `action-${i}-${a}`, title: '虚构响应事项', owner: '方案负责人', dueDate: '2026-11-01', status: 'working', responseFileName: '现场接口及验收实施说明-' + a, responseFileFormat: 'md', fileRequirements: '说明系统接口、现场实施步骤和可追溯验收条件。', templateSourceIds: [], selectedTemplateSourceIds: [] })) }));
  project.tenderSourceIds = [tender.id]; project.selectedTenderSourceIds = [tender.id];
  project.tenderClarificationRounds = Array.from({ length: 3 }, (_, i) => ({ id: 'clarification-' + i, title: '第' + (i + 1) + '次澄清与补遗 / Technical clarification', occurredAt: '2026-10-23T10:00', sourceIds: [clarification.id], selectedSourceIds: [clarification.id] }));
  const result = { id: 'tender-result', kind: 'requirements', name: '虚构招标技术要求分析', fileName: analysis.name, format: 'md', createdAt: time, provider: 'local', model: 'fixture-no-inference', sourceId: analysis.id, relativePath: analysis.workspacePath, prompt: '仅检查布局', keywords: ['接口', '交付'], sourceIds: [tender.id], templateSourceIds: [], differences: [] };
  project.tenderAnalysis = { keywords: ['技术参数', '交付时间'], analysisRequirements: '完整提取招标要求、引用位置、验收标准与待确认事项。', templateSourceIds: [], selectedTemplateSourceIds: [], outputFormat: 'md', results: [result] };
  project.tenderComparison = { selectedPresalesSourceIds: [customer.id], templateSourceIds: [], selectedTemplateSourceIds: [], outputFormat: 'md', results: [{ ...result, id: 'comparison-result', kind: 'comparison', differences: [{ title: '接口范围及交付节奏', presales: '原约定分批实施。', tender: '按最终澄清统一组织验收。', relation: 'changed', notes: '公开虚构差异说明。' }] }] };
  project.bidFileChecklist = ['技术方案与实施计划', '验收测试与交付清单', '运行维护及培训方案'].map((title, i) => {
    const generated = source('bid-generated-' + i, '3_技术标组包/1_投标文件输出/' + title + '/生成文件'); project.sources.push(generated);
    return schema.bidFileChecklistItemSchema.parse({ id: 'bid-' + i, title, category: 'technical', status: 'confirmed', notes: '来源为招标文件第三章及最终澄清，需保留完整证据。', referenceSourceIds: [tender.id, enterprise.id], selectedReferenceSourceIds: [tender.id, enterprise.id], outputFormat: 'md', detailRequirements: '按招标章节说明系统架构、接口、部署、培训、验收和待确认事项。', generatedFiles: [{ id: 'generated-' + i, name: generated.name, format: 'md', createdAt: time, provider: 'local', model: 'fixture-no-inference', sourceId: generated.id, relativePath: generated.workspacePath, referenceSourceIds: [tender.id], templateSourceIds: [], detailRequirements: '公开虚构文件' }] });
  });
  project.handover = { ...project.handover, awardSourceIds: [award.id], selectedAwardSourceIds: [award.id], awardNotes: '虚构中标资料；最终技术边界仍需人工复核。', temporaryChanges: '按最终澄清要求组织交付。', projectNumber: 'FICTIONAL-RESPONSIVE-001', checklistNumber: 'HANDOVER-001', departments: ['实施与交付部门', '软件研发与接口部门', '质量与验收部门'].map((name, i) => ({ id: 'department-' + i, name, responsibility: '承担本部门系统接口、实施配合、问题关闭和证据记录。', owner: '虚构负责人', defaultDeliverableType: 'document', defaultResponseMethod: 'mixed' })), tasks: Array.from({ length: 4 }, (_, i) => ({ id: 'handover-' + i, title: '现场接口联调、部署与验收资料准备-' + i, departmentId: 'department-' + i % 3, scope: '依据最终投标文件和中标补充说明完成部门交付。', deliverableType: 'document', responseMethod: 'mixed', deliverableName: '技术说明与验收记录', owner: '虚构负责人', dueDate: '2026-11-01', status: 'working', dependencyNotes: '依赖现场接口和部署环境确认。', acceptanceCriteria: '资料完整、接口可追溯、遗留项有负责人。', sourceIds: [award.id, tender.id], responseText: '虚构部门响应记录。', responsePath: 'fictional://controlled/repository', responseSourceIds: [analysis.id] })) };
  return schema.projectManifestSchema.parse(project);
}

const fixture = fixtureProject();
for (const [relative, content] of files) { const file = path.join(workspace, ...relative.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
fs.mkdirSync(path.join(workspace, 'projects', fixture.id), { recursive: true });
fs.writeFileSync(path.join(workspace, 'workspace.json'), JSON.stringify({ schemaVersion: '1.0.0', activeProjectId: fixture.id, projects: [{ id: fixture.id, name: fixture.name, updatedAt: fixture.updatedAt }] }));
fs.writeFileSync(path.join(workspace, 'projects', fixture.id, 'project.json'), JSON.stringify(fixture));
const stages = ['presales', 'tender', 'bid', 'handover', 'outputs'];
const passed = (name, details) => { report.checks.push({ name, details }); console.log('PASS ' + name); };

async function capture(name) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const data = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  const file = path.join(run, name + '.png'); fs.writeFileSync(file, Buffer.from(data, 'base64')); report.screenshots.push(file);
}

async function resize(width, zoom, maximized = false) {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.clearDeviceMetricsOverride'); await session.detach();
  await application.evaluate(({ BrowserWindow }, input) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(input.width, 960); win.setPosition(0, 0); win.webContents.setZoomFactor(input.zoom);
  }, { width, zoom });
  if (maximized) { await page.locator('#window-maximize').click(); await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true); }
  const native = await application.evaluate(({ BrowserWindow, screen }) => { const win = BrowserWindow.getAllWindows()[0]; return { bounds: win.getBounds(), content: win.getContentBounds(), workArea: screen.getPrimaryDisplay().workArea, scaleFactor: screen.getPrimaryDisplay().scaleFactor }; });
  await expect.poll(() => page.evaluate(({ width, height, zoom }) => Math.abs(innerWidth - width / zoom) <= 1.5 && Math.abs(innerHeight - height / zoom) <= 1.5, { ...native.content, zoom }), { timeout: 5000 }).toBe(true);
  let emulated = false;
  if (!maximized && Math.abs(native.content.width - width) > 8) {
    await page.setViewportSize({ width: Math.round(width / zoom), height: Math.round(960 / zoom) }); emulated = true;
  }
  return { requestedNativeWidth: width, zoom, maximized, emulated, native };
}

async function setLocaleTheme(locale, theme) {
  if (await page.locator('html').getAttribute('data-locale') !== locale) await page.locator('#global-locale-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-locale', locale);
  if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#global-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function inspect(context, section) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  const observation = await page.evaluate(() => {
    const root = document.documentElement, app = document.querySelector('.solution-app'), appBox = app.getBoundingClientRect();
    const shown = element => { const s = getComputedStyle(element), r = element.getBoundingClientRect(); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && parseFloat(s.opacity) > .1; };
    const controls = [...document.querySelectorAll('.lab-header button')].filter(shown).map(element => { const r = element.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { id: element.id || element.getAttribute('aria-label') || element.textContent.trim(), inside: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight, hit: hit === element || element.contains(hit) }; });
    const fields = [...document.querySelectorAll('.field input:not([type="checkbox"]),.field select,.field textarea,.model-control-field input,.model-control-field select,.project-path-settings input')].filter(shown).map(element => ({ height: element.getBoundingClientRect().height, font: parseFloat(getComputedStyle(element).fontSize) }));
    const labels = [...document.querySelectorAll('.field > span')].filter(shown).map(element => parseFloat(getComputedStyle(element).fontSize));
    const hasLocalScroll = element => { for (let node = element.parentElement; node && node !== app; node = node.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth + 1) return true; return false; };
    const longText = [...document.querySelectorAll('.project-header > div > span,.open-analysis-file,.handover-task-basis > span')].filter(element => shown(element) && !hasLocalScroll(element)).map(element => { const r = element.getBoundingClientRect(); return { selector: element.className || element.tagName, fits: r.left >= appBox.left - 1 && r.right <= appBox.right + 1 }; });
    return { viewport: { width: innerWidth, height: innerHeight, clientWidth: root.clientWidth, scrollWidth: root.scrollWidth, devicePixelRatio }, appWidth: appBox.width, bodyFont: parseFloat(getComputedStyle(document.body).fontSize), labelFont: labels[0] ?? null, compactLabelMinFont: labels.length ? Math.min(...labels) : null, fields: { count: fields.length, minHeight: fields.length ? Math.min(...fields.map(item => item.height)) : null, minFont: fields.length ? Math.min(...fields.map(item => item.font)) : null }, controls, longText, localHorizontalScroll: [...document.querySelectorAll('.presales-rounds,.source-review-grid,.tender-analysis-grid')].filter(element => element.scrollWidth > element.clientWidth + 1).length };
  });
  const prefix = `${context.name}/${section}`;
  report.observations.push({ context, section, ...observation });
  assert.ok(observation.viewport.scrollWidth <= observation.viewport.clientWidth + 1, `${prefix}: root horizontal overflow ${observation.viewport.scrollWidth}/${observation.viewport.clientWidth}`);
  if (observation.viewport.width >= 1800) assert.ok(observation.appWidth / observation.viewport.clientWidth >= .9, `${prefix}: content remains capped (${observation.appWidth}/${observation.viewport.clientWidth})`);
  assert.ok(observation.bodyFont >= 16.9 && observation.bodyFont <= 22.2, `${prefix}: body font outside readable bounded range`);
  if (observation.labelFont !== null) assert.ok(observation.labelFont >= 13.9 * .95 && observation.labelFont <= 20, `${prefix}: field label ${observation.labelFont} outside readable bounded range`);
  if (observation.compactLabelMinFont !== null) assert.ok(observation.compactLabelMinFont >= 11.9 * .95, `${prefix}: compact label shrank beyond the requested five-percent reduction`);
  if (observation.fields.count) { assert.ok(observation.fields.minHeight >= 38 * .95, `${prefix}: small form height ${observation.fields.minHeight}`); assert.ok(observation.fields.minFont >= 12.9 * .95, `${prefix}: small form text ${observation.fields.minFont}`); }
  assert.ok(observation.controls.length >= 14, `${prefix}: topbar controls disappeared`);
  for (const control of observation.controls) { assert.ok(control.inside, `${prefix}: ${control.id} outside viewport`); assert.ok(control.hit, `${prefix}: ${control.id} covered`); }
  for (const text of observation.longText) assert.equal(text.fits, true, `${prefix}: long text outside content (${text.selector})`);
  return observation;
}

async function scenario(context, locale = 'zh', theme = 'light') {
  context = { ...context, locale, theme, name: `${context.maximized ? 'max' : context.requestedNativeWidth}-${context.zoom}-${locale}-${theme}` };
  await setLocaleTheme(locale, theme);
  for (let index = 0; index < stages.length; index++) {
    await page.locator('.stage-rail > button').nth(index).click();
    if (index === 0) { await expect(page.locator('.presales-round')).toHaveCount(3); await expect(page.locator('.round-action-row')).toHaveCount(9); }
    if (index === 1) { await expect(page.locator('.clarification-row')).toHaveCount(3); await expect(page.locator('.bid-file-checklist > div')).toHaveCount(3); }
    if (index === 2) { const first = page.locator('.bid-output-summary').first(); if (await first.getAttribute('aria-expanded') !== 'true') await first.click(); await expect(page.locator('.bid-output-editor')).toBeVisible(); }
    if (index === 3) { await expect(page.locator('.department-list > article')).toHaveCount(3); await expect(page.locator('.handover-task-list > article')).toHaveCount(4); if (await page.locator('.handover-task-editor').count() === 0) await page.locator('.handover-task-list > article > header > button').first().click(); await expect(page.locator('.handover-task-editor')).toBeVisible(); }
    if (index === 4) await expect.poll(() => page.locator('.output-file-list > label').count()).toBeGreaterThan(0);
    await inspect(context, stages[index]);
    if ((!context.maximized && context.requestedNativeWidth === 1480 && context.zoom === 1 && locale === 'zh' && index === 0) || (context.maximized && context.zoom === 1 && locale === 'zh' && theme === 'dark' && index === 2) || (!context.maximized && context.requestedNativeWidth === 760 && context.zoom === 1.25 && locale === 'en' && theme === 'light' && index === 1)) await capture(context.name + '-' + stages[index]);
  }
  await page.locator('.model-expand-toggle').click(); await expect(page.locator('#workbench-model-settings')).toBeVisible(); await expect(page.locator('.model-channel-card')).toHaveCount(3); await inspect(context, 'models');
  await page.locator('.project-path-command').click(); await expect(page.locator('.project-settings-panel')).toBeVisible(); await inspect(context, 'project-settings');
  await page.locator('.project-settings-heading > button').click(); await page.locator('.model-expand-toggle').click();
  passed(context.name + ': five populated stages, model/project panels, readable controls and reachable topbar');
}

(async () => {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ executablePath: executable || sourceElectronExecutable(), args: executable ? [] : [ROOT], env, timeout: 30000 });
  page = await application.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await expect(page.locator('[data-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.evaluate(fixture => { localStorage.setItem('cavwic-solution-workspace', JSON.stringify(fixture)); localStorage.setItem('cavwic-lab-model-settings', JSON.stringify({ schemaVersion: '3.0.0', provider: 'hybrid', localRuntime: 'openai', localProfiles: {}, localEndpoint: 'http://127.0.0.1:1/v1', localModel: 'fixture-no-inference', cloudEndpoint: 'https://fixture.invalid/v1/chat/completions', cloudModel: 'fixture-no-inference', codexModel: 'fixture-no-inference', enabledProviders: ['local', 'codex', 'cloud'], hybridRoutes: { analysis: 'local', draft: 'codex', ocr: 'cloud' } })); }, fixture);
  await page.reload(); await expect(page.locator('[data-ready="true"]')).toBeVisible();
  await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, workspace);
  await page.locator('.project-path-command').click(); await page.getByRole('button', { name: '选择', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: '是，继续', exact: true }).click();
  await expect(page.getByLabel('项目路径', { exact: true })).toHaveValue('workspace'); await page.locator('.project-settings-heading > button').click();
  passed('Complex fictional fixture loaded with real stage files; no model inference requested', { presalesRounds: fixture.presalesRounds.length, presalesActions: 9, clarifications: 3, bidFiles: 3, departments: 3, handoverTasks: 4, sourceFiles: files.size });
  for (const width of [760, 1024, 1480, 1920, 2560]) for (const zoom of [1, 1.25]) {
    const context = await resize(width, zoom); await scenario(context);
    if (width === 760 && zoom === 1.25) for (const [locale, theme] of [['zh', 'dark'], ['en', 'light'], ['en', 'dark']]) await scenario(context, locale, theme);
    if (width === 1480 && zoom === 1) await scenario(context, 'en', 'dark');
  }
  for (const zoom of [1, 1.25]) {
    const context = await resize(1480, zoom, true);
    context.native = await application.evaluate(({ BrowserWindow, screen }) => ({ bounds: BrowserWindow.getAllWindows()[0].getBounds(), content: BrowserWindow.getAllWindows()[0].getContentBounds(), workArea: screen.getPrimaryDisplay().workArea, scaleFactor: screen.getPrimaryDisplay().scaleFactor }));
    for (const [locale, theme] of [['zh', 'light'], ['zh', 'dark'], ['en', 'light'], ['en', 'dark']]) await scenario(context, locale, theme);
    await page.locator('#window-maximize').click(); await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
  }
  const at = width => report.observations.find(item => !item.context.maximized && item.context.requestedNativeWidth === width && item.context.zoom === 1 && item.context.locale === 'zh' && item.section === 'presales');
  const normal = at(1480), wide = at(2560), narrow = at(760);
  assert.ok(wide.bodyFont > normal.bodyFont + .5 && wide.bodyFont <= normal.bodyFont * 1.4);
  assert.ok(wide.labelFont > normal.labelFont + .3 && wide.labelFont <= normal.labelFont * 1.4);
  assert.ok(narrow.bodyFont >= normal.bodyFont - .25 && narrow.labelFont >= normal.labelFont - .25);
  passed('Wide content fills at least 90% of viewport; bounded body/label font growth preserves normal and narrow readability', { narrow: { body: narrow.bodyFont, label: narrow.labelFont }, normal: { body: normal.bodyFont, label: normal.labelFont }, wide: { body: wide.bodyFont, label: wide.labelFont, contentRatio: wide.appWidth / wide.viewport.clientWidth } });
  assert.deepEqual(report.errors, []); report.success = true;
})().catch(async error => { report.success = false; report.failure = error.stack || String(error); process.exitCode = 1; console.error(report.failure); if (application && page) await capture('failure').catch(() => {}); }).finally(async () => {
  if (application) await application.close().catch(() => {});
  fs.writeFileSync(path.join(run, 'report.json'), JSON.stringify(report, null, 2)); console.log('Report: ' + path.join(run, 'report.json'));
});
