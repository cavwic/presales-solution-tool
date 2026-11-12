'use strict';

// End-to-end acceptance for independent project settings and the local project
// library. Only this run's profile and publicly fictional workspaces are used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const { _electron: electron, expect } = require('playwright/test');
const { sourceElectronExecutable } = require('./test-runtime.cjs');
const schema = require('../../src/lib/workspace-schema.ts');
const ROOT = path.resolve(__dirname, '../..');
const runRoot = path.join(ROOT, '.cache', 'validation', 'project-library-' + Date.now());
const profile = path.join(runRoot, 'profile');
const executablePath = process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE || sourceElectronExecutable();
const packaged = Boolean(process.env.PRESALES_SOLUTION_TOOL_EXECUTABLE);
fs.mkdirSync(profile, { recursive: true });
const report = { success: false, runRoot, profile, executablePath, packaged, checks: [], screenshots: [], pageErrors: [], externalRequests: [] };
let app, page;
const passed = (name, details) => { report.checks.push({ name, details }); console.log('PASS ' + name); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const time = '2026-11-11T12:00:00.000Z';
const stages = ['0_项目客户方资料', '1_售前准备', '2_招标要求', '3_技术标组包', '4_中标交底', '5_输出文件'];

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function fileHashes(directory) {
  assert.ok(inside(runRoot,directory),'Hash inspection must stay in this isolated run');
  const hashes={};
  function visit(current) {
    for(const entry of fs.readdirSync(current,{withFileTypes:true})) {
      const filename=path.join(current,entry.name);
      if(entry.isDirectory())visit(filename);
      else if(entry.isFile())hashes[path.relative(directory,filename)]=sha(fs.readFileSync(filename));
    }
  }
  visit(directory); return hashes;
}

function makeFixture(id, name, customer) {
  const sourceText = `# ${customer}\n\n公开虚构历史项目资料：${id}。\n`;
  const generatedText = `# 方案草稿\n\n仅验证生成文件在历史库中完整保存：${id}。\n`;
  const sourcePath = '0_项目客户方资料/客户需求.md', generatedPath = '5_输出文件/方案草稿.md';
  const source = (suffix, fileName, relativePath, content) => schema.sourceDocumentSchema.parse({
    id: `${id}-${suffix}`, name: fileName, fileType: 'md', version: '1.0', size: Buffer.byteLength(content), sha256: sha(content), importedAt: time,
    workspacePath: relativePath, requiresOcr: false, preprocessStatus: 'ready', preprocessedAt: time, preprocessMessage: '公开虚构验收文件',
    segments: [{ id: `${id}-${suffix}-line`, locatorKind: 'line', locator: '第 1 行', text: content }],
  });
  const project = schema.createEmptyProject('zh');
  Object.assign(project, { id, name, customerAlias: customer, objective: '验证历史查询、资料保存及项目隔离。', constraints: '所有内容均为公开虚构测试资料。', updatedAt: time });
  const original = source('source', '客户需求.md', sourcePath, sourceText), generated = source('generated', '方案草稿.md', generatedPath, generatedText);
  project.sources = [original, generated];
  const round = schema.createPresalesRound('zh', 1); round.id = `${id}-round`;
  round.requirementSourceIds = [original.id]; round.selectedRequirementSourceIds = [original.id];
  round.generatedFiles = [{ id: `${id}-output`, name: '方案草稿.md', format: 'md', createdAt: time, provider: 'local', model: 'fixture-no-inference', sourceId: generated.id, relativePath: generatedPath, actionId: '' }];
  project.presalesRounds = [round];
  return { project: schema.projectManifestSchema.parse(project), files: new Map([[sourcePath, sourceText], [generatedPath, generatedText]]), sourcePath, generatedPath };
}

function writeFixture(directory, fixture) {
  assert.ok(inside(runRoot, directory), 'Fixture directory must stay in this isolated run');
  for (const name of stages) fs.mkdirSync(path.join(directory, name), { recursive: true });
  const projectDirectory = path.join(directory, 'projects', fixture.project.id);
  fs.mkdirSync(path.join(projectDirectory, 'sources'), { recursive: true });
  fs.writeFileSync(path.join(projectDirectory, 'project.json'), JSON.stringify(fixture.project, null, 2));
  fs.writeFileSync(path.join(directory, 'workspace.json'), JSON.stringify({ schemaVersion: '1.0.0', activeProjectId: fixture.project.id, projects: [{ id: fixture.project.id, name: fixture.project.name, updatedAt: time }] }));
  for (const [relative, contents] of fixture.files) {
    const filename = path.resolve(directory, relative); assert.ok(inside(directory, filename));
    fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, contents);
  }
}

async function start() {
  const env = { ...process.env, PRESALES_SOLUTION_TOOL_TEST_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath, args: packaged ? [] : [ROOT], env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  await page.route(/^https?:/, route => { report.externalRequests.push(route.request().url()); return route.abort(); });
  await expect(page.locator('.solution-app')).toHaveAttribute('data-ready', 'true', { timeout: 20000 });
  const identity = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), version: app.getVersion() }));
  assert.equal(identity.userData, profile); report.version = identity.version;
  await app.evaluate(({ app, shell }) => { app.__projectLibraryOpened = []; shell.openPath = async filename => { app.__projectLibraryOpened.push(filename); return ''; }; });
  return identity;
}

async function resize(width, height, zoom = 1) {
  await app.evaluate(({ BrowserWindow }, size) => { const win=BrowserWindow.getAllWindows()[0]; if(win.isMaximized())win.unmaximize(); win.setContentSize(size.width,size.height); win.setPosition(0,0); win.webContents.setZoomFactor(size.zoom); }, { width,height,zoom });
  const bounds=await app.evaluate(({ BrowserWindow })=>BrowserWindow.getAllWindows()[0].getContentBounds());
  await expect.poll(async()=>Math.abs(await page.evaluate(()=>innerWidth)-bounds.width/zoom)).toBeLessThanOrEqual(1.5);
}

async function capture(name) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const filename=path.join(runRoot,name+'.png');
  const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
  fs.writeFileSync(filename,Buffer.from(data,'base64')); report.screenshots.push(filename);
}

async function assertModal(dialog, closeName) {
  await expect(dialog).toBeVisible();
  await expect.poll(()=>dialog.evaluate(element=>element.contains(document.activeElement)),{timeout:2000,message:'Modal focus did not settle inside the dialog'}).toBe(true);
  const state=await dialog.evaluate(element=>{const r=element.getBoundingClientRect(); return { modal:element.matches(':modal'),focus:element.contains(document.activeElement),inside:r.width>0&&r.height>0&&r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1, width:element.clientWidth,scrollWidth:element.scrollWidth };});
  assert.equal(state.modal,true); assert.equal(state.focus,true); assert.equal(state.inside,true); assert.ok(state.scrollWidth<=state.width+1,'Modal has horizontal overflow');
  const close=dialog.getByRole('button',{name:closeName,exact:true});
  if(await close.count()) assert.equal(await close.evaluate(element=>{const r=element.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight+1&&(hit===element||element.contains(hit));}),true,'Modal close button is unreachable');
}
async function assertTemplateRows(settings) {
  const rows=await settings.locator('.general-template-grid > article').evaluateAll(elements=>elements.map(element=>{const title=element.querySelector('strong'),button=element.querySelector('.file-command'),range=document.createRange();range.selectNodeContents(title);const a=range.getBoundingClientRect(),b=button.getBoundingClientRect();return {title:title.textContent,clear:a.right<=b.left+1||a.left>=b.right-1||a.bottom<=b.top+1||a.top>=b.bottom-1};}));
  assert.equal(rows.length,3); for(const row of rows)assert.equal(row.clear,true,`${row.title} overlaps its upload control`);
  const controls=settings.locator('.project-path-actions > button:enabled, .project-directory-utilities > button:enabled, .general-template-grid .file-command');
  for(let i=0;i<await controls.count();i++) {
    const control=controls.nth(i); await control.hover();
    await control.evaluate(async element=>{void getComputedStyle(element).color;await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>undefined)));});
    const color=await control.evaluate(element=>({text:element.textContent.trim(),color:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor}));
    assert.notEqual(color.color,color.background,`${color.text} has the same foreground and background when hovered`);
  }
}

async function historyEntry(id) { return page.evaluate(async key=>(await window.bidDesktop.projects.list()).find(entry=>entry.id===key),id); }
async function openHistory() { await page.locator('.project-history-command').click(); const dialog=page.getByTestId('project-history-dialog'); await expect(dialog).toBeVisible(); return dialog; }
async function chooseNativeFolder(directory) { await app.evaluate(({ dialog }, selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},directory); }
async function selectHistory(dialog,id) { await dialog.locator(`[data-project-id="${id}"]`).click(); }
async function closeHistoryWithEscape(dialog) {
  // Native search fields consume Escape to clear a non-empty search first.
  // Verify the dialog's own Escape behavior after moving focus off that field.
  await dialog.getByRole('button',{name:/^(关闭历史项目|Close project history)$/}).focus();
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
}
async function assertHistoryActionsReachable(dialog) {
  for(const id of ['history-open-folder','history-mark-submitted','history-load','history-open-library','history-import-existing']) {
    const button=dialog.getByTestId(id); await button.scrollIntoViewIfNeeded();
    assert.equal(await button.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1&&(hit===element||element.contains(hit));}),true,`${id} cannot be reached in a short history dialog`);
  }
  assert.deepEqual(await page.evaluate(()=>({top:document.documentElement.scrollTop,left:document.documentElement.scrollLeft,bodyTop:document.body.scrollTop})),{top:0,left:0,bodyTop:0});
}

const deadline=setTimeout(()=>{report.timedOut=true;process.exitCode=1;if(app)void app.close().catch(()=>{});},180000);
(async()=>{
  const a=makeFixture('library-fixture-a','公开虚构历史项目甲 / History fixture A','虚构客户甲');
  const c=makeFixture('library-fixture-c','公开虚构旧目录项目丙 / Existing fixture C','虚构客户丙');
  const externalA=path.join(runRoot,'external-original-a'), externalC=path.join(runRoot,'external-existing-c');
  writeFixture(externalA,a); writeFixture(externalC,c);
  const originalHashes=new Map([...a.files].map(([relative])=>[relative,sha(fs.readFileSync(path.join(externalA,relative)))]));
  await start(); await resize(1480,960);
  const info=await page.evaluate(()=>window.bidDesktop.projects.info());
  assert.equal(path.resolve(info.rootPath),path.join(profile,'项目资料库'),'TEST_DATA must isolate the library under its own profile');
  report.libraryRoot=info.rootPath;
  passed('Native project library is available only in this run’s isolated profile',info);

  await chooseNativeFolder(externalA);
  await page.evaluate(async fixture=>{
    const picked=await window.bidDesktop.fs.pick({purpose:'active-workspace'}); if(!picked.ok||!picked.value)throw new Error('Test folder grant failed');
    const persisted=await window.bidDesktop.fs.persist({key:'active-workspace',handle:picked.value}); if(!persisted.ok)throw new Error('Test folder persistence failed');
    localStorage.setItem('cavwic-solution-workspace',JSON.stringify(fixture));
  },a.project);
  await page.reload(); await expect(page.locator('.solution-app')).toHaveAttribute('data-ready','true');
  await expect(page.locator('.linear-document-title')).toHaveValue(a.project.name);
  await expect.poll(async()=>(await historyEntry(a.project.id))?.sourceCount||0).toBeGreaterThanOrEqual(1);
  const archivedA=await historyEntry(a.project.id); assert.ok(inside(info.rootPath,archivedA.folderPath)); assert.notEqual(archivedA.folderPath,externalA);
  for(const [relative,contents]of a.files){const file=path.join(archivedA.folderPath,relative);await expect.poll(()=>fs.existsSync(file)).toBe(true);assert.equal(fs.readFileSync(file,'utf8'),contents);}
  assert.ok(fs.existsSync(path.join(archivedA.folderPath,'projects',a.project.id,'project.json')));
  passed('Existing external project records, source material and generated bytes are mirrored into separate visible stage folders',{folder:archivedA.folderPath});

  const documentPosition=await page.locator('.linear-document').evaluate(element=>element.getBoundingClientRect().top);
  await page.locator('.project-path-command').click(); let settings=page.getByTestId('project-settings-dialog');
  await assertModal(settings,'关闭项目设置'); await expect(page.locator('.linear-document .project-settings-panel')).toHaveCount(0);
  assert.equal(await page.locator('.linear-document').evaluate(element=>element.getBoundingClientRect().top),documentPosition,'Settings must not insert a new page section');
  await settings.getByRole('button',{name:'重新扫描',exact:true}).click();
  await expect(settings.getByRole('button',{name:'重新扫描',exact:true})).toBeEnabled();
  await assertModal(settings,'关闭项目设置');
  await expect(page.locator('.linear-document-title')).toHaveValue(a.project.name);
  await assertTemplateRows(settings);
  await capture('project-settings-zh'); await page.keyboard.press('Escape'); await expect(settings).toBeHidden(); await expect(page.locator('.project-path-command')).toBeFocused();
  await page.locator('#global-locale-toggle').click(); await page.locator('.project-path-command').click();
  await assertModal(settings,'Close project settings'); await assertTemplateRows(settings); await capture('project-settings-en');
  await page.keyboard.press('Escape'); await expect(settings).toBeHidden();
  const initialTheme=await page.locator('html').getAttribute('data-theme');
  if(initialTheme!=='dark')await page.locator('#global-theme-toggle').click();
  await page.locator('.project-path-command').click(); await assertModal(settings,'Close project settings'); await assertTemplateRows(settings); await capture('project-settings-en-dark');
  await page.keyboard.press('Escape'); await expect(settings).toBeHidden();
  if(initialTheme!=='dark')await page.locator('#global-theme-toggle').click();
  await page.locator('#global-locale-toggle').click();
  passed('Project settings opens as a focused independent modal, keeps document geometry and stays open through Rescan before closing with Escape');

  let history=await openHistory(); await assertModal(history,'关闭历史项目'); await selectHistory(history,a.project.id);
  await history.getByTestId('history-mark-submitted').click();
  await expect.poll(async()=>Boolean((await historyEntry(a.project.id))?.submittedAt)).toBe(true);
  await history.getByTestId('history-search').fill('虚构客户甲');
  await expect(history.locator(`[data-project-id="${a.project.id}"]`)).toBeVisible();
  await history.getByTestId('history-status-filter').selectOption('draft');
  await expect(history.locator(`[data-project-id="${a.project.id}"]`)).toHaveCount(0);
  await history.getByTestId('history-status-filter').selectOption('submitted');
  await expect(history.locator(`[data-project-id="${a.project.id}"]`)).toBeVisible();
  await closeHistoryWithEscape(history);
  await page.locator('.linear-document-title').fill(a.project.name+'（已核对）');
  await expect.poll(async()=>(await historyEntry(a.project.id))?.name).toBe(a.project.name+'（已核对）');
  assert.ok((await historyEntry(a.project.id)).submittedAt,'Normal autosave erased manual submitted status');
  passed('Manual submitted status survives ordinary project autosave');

  await page.locator('.linear-sidebar-footer > button').first().click(); const create=page.getByTestId('new-project-dialog'); await expect(create).toBeVisible();
  const createButton=create.getByRole('button',{name:'创建项目',exact:true}); await expect(createButton).toBeDisabled();
  let projectBName='公开虚构历史项目乙 / History fixture B';
  await create.getByRole('textbox',{name:'项目名称',exact:true}).fill(projectBName); await createButton.click();
  await expect(create).toBeHidden(); await expect(page.locator('.linear-document-title')).toHaveValue(projectBName);
  const b=await page.evaluate(()=>JSON.parse(localStorage.getItem('cavwic-solution-workspace'))); assert.notEqual(b.id,a.project.id); assert.equal(b.sources.length,0);
  await expect.poll(async()=>Boolean(await historyEntry(b.id))).toBe(true); const archivedB=await historyEntry(b.id);
  assert.notEqual(archivedB.folderPath,archivedA.folderPath); assert.ok(inside(info.rootPath,archivedB.folderPath));
  for(const [relative,contents]of a.files)assert.equal(fs.readFileSync(path.join(archivedA.folderPath,relative),'utf8'),contents);
  passed('Named new project archives the current project before switching and uses a distinct working folder',{a:archivedA.folderPath,b:archivedB.folderPath});

  const bSnapshotPath=path.join(archivedB.folderPath,'projects',b.id,'project.json');
  const bDiskSnapshot=JSON.parse(fs.readFileSync(bSnapshotPath,'utf8'));
  assert.equal(bDiskSnapshot.id,b.id); projectBName+='（磁盘更新）';
  bDiskSnapshot.name=projectBName; bDiskSnapshot.updatedAt=new Date().toISOString();
  fs.writeFileSync(bSnapshotPath,JSON.stringify(bDiskSnapshot,null,2));
  await page.locator('.project-path-command').click(); settings=page.getByTestId('project-settings-dialog');
  await settings.getByRole('button',{name:'重新扫描',exact:true}).click();
  await expect(page.locator('.linear-document-title')).toHaveValue(projectBName);
  await expect(settings.getByRole('button',{name:'重新扫描',exact:true})).toBeEnabled();
  await assertModal(settings,'关闭项目设置');
  await expect.poll(async()=>(await historyEntry(b.id))?.name).toBe(projectBName);
  assert.equal(JSON.parse(fs.readFileSync(bSnapshotPath,'utf8')).name,projectBName,'Rescan overwrote the disk edit with stale cached state');
  await page.keyboard.press('Escape'); await expect(settings).toBeHidden();
  passed('Rescan loads an immediate disk edit from the managed folder, keeps the dialog open and preserves that edit in the archived snapshot');

  const bBeforeSecondNew=fileHashes(archivedB.folderPath);
  const secondProjectName='公开虚构同日项目乙二 / Same-day fixture B2';
  await page.locator('.linear-sidebar-footer > button').first().click();
  const createAgain=page.getByTestId('new-project-dialog');
  await createAgain.getByRole('textbox',{name:'项目名称',exact:true}).fill(secondProjectName);
  await createAgain.getByRole('button',{name:'创建项目',exact:true}).click();
  await expect(createAgain).toBeHidden(); await expect(page.locator('.linear-document-title')).toHaveValue(secondProjectName);
  const secondProject=await page.evaluate(()=>JSON.parse(localStorage.getItem('cavwic-solution-workspace')));
  assert.notEqual(secondProject.id,b.id); assert.notEqual(secondProject.id,a.project.id);
  await expect.poll(async()=>Boolean(await historyEntry(secondProject.id))).toBe(true);
  assert.notEqual((await historyEntry(secondProject.id)).folderPath,archivedB.folderPath);
  assert.deepEqual(fileHashes(archivedB.folderPath),bBeforeSecondNew,'Creating another project on the same day changed the previous project archive');
  passed('Consecutive same-day projects receive different ids and folders while retaining the previous project archive byte-for-byte');

  await app.close(); app=null; await start(); await expect(page.locator('.linear-document-title')).toHaveValue(secondProjectName);
  assert.ok((await historyEntry(a.project.id)).submittedAt,'Submitted status did not survive an application restart');
  history=await openHistory(); await selectHistory(history,a.project.id); await history.getByTestId('history-load').click();
  await expect(history).toBeHidden(); await expect(page.locator('.linear-document-title')).toHaveValue(a.project.name+'（已核对）');
  await expect(page.locator('.linear-sidebar-materials')).toContainText('客户需求.md');
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('cavwic-solution-workspace'))); assert.equal(restored.id,a.project.id); assert.equal(restored.sources.length,2); assert.equal(restored.presalesRounds[0].generatedFiles.length,1);
  for(const [relative,contents]of a.files)assert.equal(fs.readFileSync(path.join(archivedA.folderPath,relative),'utf8'),contents);
  passed('Application restart retains history and loading a submitted project restores source and generated-file records with actual files');

  // A project may only copy into an empty folder or a folder carrying its own
  // manifest. A different historical project's files must never be overwritten.
  const bMarker=path.join(archivedB.folderPath,'5_输出文件','隔离验证.txt');
  fs.writeFileSync(bMarker,'公开虚构项目乙的文件，项目甲不得覆盖。\n');
  const bBefore=fileHashes(archivedB.folderPath);
  await page.locator('.project-path-command').click();
  settings=page.getByTestId('project-settings-dialog');
  await chooseNativeFolder(archivedB.folderPath);
  await settings.getByRole('button',{name:'修改',exact:true}).click();
  const location=page.getByTestId('directory-change-dialog'); await expect(location).toBeVisible();
  await location.getByRole('button',{name:'是，继续',exact:true}).click();
  await expect(location).toBeHidden();
  await expect(settings.getByRole('alert').first()).toBeVisible();
  await expect(settings.getByRole('button',{name:'修改',exact:true})).toBeEnabled();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cavwic-solution-workspace')).id),a.project.id);
  await expect(settings.getByLabel('项目路径',{exact:true})).toHaveValue(archivedA.folderName);
  assert.deepEqual(fileHashes(archivedB.folderPath),bBefore,'Selecting another history folder changed that project’s files');
  for(const[relative,contents]of a.files)assert.equal(sha(fs.readFileSync(path.join(archivedA.folderPath,relative))),sha(contents));
  await page.keyboard.press('Escape');
  passed('Changing location to a different historical project is rejected, preserving both projects’ file bytes and active binding');

  history=await openHistory(); await chooseNativeFolder(externalC); await history.getByTestId('history-import-existing').click();
  await expect.poll(async()=>Boolean(await historyEntry(c.project.id))).toBe(true); const archivedC=await historyEntry(c.project.id);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('cavwic-solution-workspace')).id),a.project.id,'Collecting an old project must not silently replace the active project');
  assert.ok(inside(info.rootPath,archivedC.folderPath)); assert.notEqual(archivedC.folderPath,externalC);
  for(const [relative,contents]of c.files){assert.equal(fs.readFileSync(path.join(externalC,relative),'utf8'),contents);assert.equal(fs.readFileSync(path.join(archivedC.folderPath,relative),'utf8'),contents);}
  if(await history.isHidden())history=await openHistory();
  await history.getByTestId('history-search').fill(''); await history.getByTestId('history-status-filter').selectOption('all');
  await selectHistory(history,c.project.id); await history.getByTestId('history-open-folder').click();
  await expect.poll(()=>app.evaluate(({app},directory)=>app.__projectLibraryOpened.includes(directory),archivedC.folderPath)).toBe(true);
  const opened=await app.evaluate(({ app })=>app.__projectLibraryOpened); assert.ok(opened.includes(archivedC.folderPath));
  for(const target of opened)assert.ok(inside(info.rootPath,target),'History opened a path outside its isolated library');
  await capture('project-history-zh'); await closeHistoryWithEscape(history);
  for(const [relative,hash]of originalHashes)assert.equal(sha(fs.readFileSync(path.join(externalA,relative))),hash,'External source was changed by archival or switching');
  passed('Explicit old-project collection copies files without moving or deleting originals, and folder opening resolves to the managed archive');

  for(const locale of ['zh','en']){
    await resize(760,540,1.25); if(await page.locator('html').getAttribute('data-locale')!==locale)await page.locator('#global-locale-toggle').click();
    await page.locator('.project-path-command').click(); await assertModal(page.getByTestId('project-settings-dialog'),locale==='zh'?'关闭项目设置':'Close project settings');
    await page.keyboard.press('Escape'); history=await openHistory(); await assertModal(history,locale==='zh'?'关闭历史项目':'Close project history');
    await assertHistoryActionsReachable(history); await capture('project-history-short-'+locale); await closeHistoryWithEscape(history);
  }
  passed('Independent settings and searchable history remain within a 760×540 window at 125% in Chinese and English');

  await resize(1480,960); if(await page.locator('html').getAttribute('data-locale')!=='zh')await page.locator('#global-locale-toggle').click();
  const older=makeFixture(c.project.id,'公开虚构项目丙旧备份','虚构客户丙旧备份');
  const zip=new JSZip(); zip.file('outputs/older-project-c.json',JSON.stringify(older.project,null,2));
  for(const source of older.project.sources)zip.file('sources/'+source.name,older.files.get(source.workspacePath));
  const zipPath=path.join(runRoot,'fictional-older-project-c.zip'); fs.writeFileSync(zipPath,await zip.generateAsync({type:'nodebuffer'}));
  const cBeforeImport=fileHashes(archivedC.folderPath);
  await page.locator('.project-path-command').click(); settings=page.getByTestId('project-settings-dialog');
  await settings.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles(zipPath);
  await expect(settings).toBeHidden();
  await expect(page.locator('.linear-document-title')).toHaveValue(older.project.name+'（导入副本）');
  const importedCopy=await page.evaluate(()=>JSON.parse(localStorage.getItem('cavwic-solution-workspace')));
  assert.notEqual(importedCopy.id,c.project.id,'An older ZIP must not overwrite a historical project carrying the same id');
  await expect.poll(async()=>Boolean(await historyEntry(importedCopy.id))).toBe(true);
  const copiedEntry=await historyEntry(importedCopy.id); assert.ok(inside(info.rootPath,copiedEntry.folderPath)); assert.notEqual(copiedEntry.folderPath,archivedC.folderPath);
  assert.deepEqual(fileHashes(archivedC.folderPath),cBeforeImport,'Importing an older ZIP changed the existing historical project');
  for(const[relative,contents]of older.files)assert.equal(fs.readFileSync(path.join(copiedEntry.folderPath,relative),'utf8'),contents);
  await page.locator('.project-path-command').click(); settings=page.getByTestId('project-settings-dialog');
  await settings.locator('input[type="file"][accept=".zip,application/zip"]').setInputFiles(zipPath);
  await expect(settings).toBeHidden();
  const secondImportedCopy=await page.evaluate(()=>JSON.parse(localStorage.getItem('cavwic-solution-workspace')));
  assert.notEqual(secondImportedCopy.id,importedCopy.id,'Consecutive imports must receive unique ids even on the same day');
  assert.notEqual(secondImportedCopy.id,c.project.id);
  await expect.poll(async()=>Boolean(await historyEntry(secondImportedCopy.id))).toBe(true);
  assert.notEqual((await historyEntry(secondImportedCopy.id)).folderPath,copiedEntry.folderPath);
  assert.deepEqual(fileHashes(archivedC.folderPath),cBeforeImport,'A second import changed the original historical project');
  passed('Consecutive imports of an older ZIP receive different ids and folders, preserve its files and keep the original history tree byte-for-byte');
  assert.deepEqual(report.pageErrors,[]); assert.deepEqual(report.externalRequests,[]); report.success=true;
})().catch(async error=>{report.failure=error.stack;process.exitCode=1;console.error(error.stack);if(page&&!page.isClosed())await capture('failure').catch(()=>{});}).finally(async()=>{
  clearTimeout(deadline);if(app)await app.close().catch(()=>{});if(report.timedOut)report.success=false;
  fs.writeFileSync(path.join(runRoot,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({success:report.success,checks:report.checks.length,reportPath:path.join(runRoot,'report.json'),error:report.failure}));
});
