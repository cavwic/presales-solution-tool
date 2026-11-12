'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createFilesystemService } = require('./filesystem.cjs');
const { resolveProjectLibraryRoot, createProjectLibraryService, attachProjectLibrary } = require('./project-library.cjs');

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'project-library-test-')));
  const userData = path.join(base, 'app-data'), rootPath = path.join(base, '项目资料库');
  const filesystem = createFilesystemService({ userData });
  const opened = [], warnings = [];
  const options = { rootPath, filesystem, openPath: async filename => { opened.push(filename); return ''; }, now: () => '2026-11-11T13:00:00.000Z', onWarning: warning => warnings.push(warning) };
  t.after(async () => {
    assert.equal(path.dirname(base), await fs.realpath(os.tmpdir()));
    assert.ok(path.basename(base).startsWith('project-library-test-'));
    await fs.rm(base, { recursive: true, force: true });
  });
  return { base, userData, rootPath, filesystem, opened, warnings, options, service: createProjectLibraryService(options) };
}
async function writeSnapshot(prepared) {
  const { id, name, folderPath } = prepared.entry;
  const projectDirectory = path.join(folderPath, 'projects', id);
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.writeFile(path.join(projectDirectory, 'project.json'), JSON.stringify({ schemaVersion: '1.0.0', id, name }));
  await fs.writeFile(path.join(folderPath, 'workspace.json'), JSON.stringify({ schemaVersion: '1.0.0', activeProjectId: id, projects: [{ id, name }] }));
}
async function project(service, id = 'project-one', name = '园区项目') {
  const prepared = await service.prepare({ id, name });
  await writeSnapshot(prepared);
  return { ...prepared, entry: await service.commit({ id, name }) };
}
async function linkOrSkip(t, target, link, kind = 'directory') {
  try { await fs.symlink(target, link, process.platform === 'win32' ? kind === 'directory' ? 'junction' : 'file' : kind === 'directory' ? 'dir' : 'file'); return true; }
  catch (error) { if (['EPERM', 'ENOTSUP', 'EACCES'].includes(error.code)) { t.skip('Test links are unavailable.'); return false; } throw error; }
}

test('project library path resolves source, release candidates, portable EXEs and all isolated-test overrides', () => {
  const base = path.resolve(os.tmpdir(), 'project-library-root-resolution');
  const sourceRoot = path.join(base, 'tool');
  assert.equal(resolveProjectLibraryRoot({ sourceRoot, environment: {} }), path.join(sourceRoot, '项目资料库'));
  for (const directory of ['售前解决方案工具-win-x64', '.candidate']) {
    assert.equal(resolveProjectLibraryRoot({ sourceRoot: path.join(sourceRoot, 'release', directory, 'resources', 'app'), executablePath: path.join(sourceRoot, 'release', directory, '售前解决方案工具.exe'), packaged: true, environment: {} }), path.join(sourceRoot, '项目资料库'));
  }
  const portable = path.join(base, 'portable');
  assert.equal(resolveProjectLibraryRoot({ executablePath: path.join(portable, '售前解决方案工具.exe'), packaged: true, environment: {} }), path.join(portable, '项目资料库'));
  for (const key of ['PRESALES_SOLUTION_TOOL_TEST_DATA', 'SOLUTION_TOOL_TEST_DATA', 'BID_WORKBENCH_TEST_DATA']) {
    const userData = path.join(base, 'test-profile');
    assert.equal(resolveProjectLibraryRoot({ sourceRoot, executablePath: path.join(portable, 'app.exe'), packaged: true, userData, environment: { [key]: userData } }), path.join(userData, '项目资料库'));
  }
  assert.throws(() => resolveProjectLibraryRoot({ sourceRoot: 'relative', environment: {} }), { code: 'INVALID_STORAGE' });
});

test('info creates a readable library index, and prepare isolates same-name projects with stable native handles', async t => {
  const { service, rootPath, filesystem } = await fixture(t);
  assert.deepEqual(await service.info(), { rootPath });
  const first = await project(service), second = await project(service, 'project-two');
  assert.notEqual(first.entry.folderName, second.entry.folderName);
  assert.equal(first.directory.kind, 'directory');
  assert.ok(first.directory.rootId.startsWith('managed_'));
  const file = await filesystem.op({ handle: first.directory, op: 'file', name: '原始资料.txt', create: true });
  await filesystem.op({ handle: file, op: 'write', data: new Uint8Array(Buffer.from('original')) });
  assert.equal(await fs.readFile(path.join(first.entry.folderPath, '原始资料.txt'), 'utf8'), 'original');
  await assert.rejects(filesystem.op({ handle: second.directory, op: 'file', name: '原始资料.txt' }), { name: 'NotFoundError' });
  assert.equal((await service.list()).length, 2);
  assert.match(await fs.readFile(path.join(rootPath, '资料库说明.txt'), 'utf8'), /更新程序时请保留/);
  assert.match(await fs.readFile(path.join(rootPath, '历史项目索引.csv'), 'utf8'), /园区项目/);
});

test('renaming updates human-readable metadata but retains the folder and preserves submission on autosave', async t => {
  const { service } = await fixture(t);
  const first = await project(service);
  const submitted = await service.setSubmitted({ id: first.entry.id, submitted: true });
  const updated = await service.commit({ id: first.entry.id, name: '更新后的名称', customerAlias: '客户A', industry: '软件', owner: '负责人', stage: 'tender', updatedAt: '2026-11-11T14:00:00.000Z', sourceCount: 3, generatedCount: 2, missingFiles: ['缺失.pdf'], originLabel: '原项目目录', submittedAt: null });
  assert.equal(updated.submittedAt, submitted.submittedAt);
  assert.equal(updated.createdAt, first.entry.createdAt);
  assert.equal(updated.folderName, first.entry.folderName);
  assert.equal(updated.sourceCount, 3); assert.equal(updated.generatedCount, 2);
  assert.deepEqual(updated.missingFiles, ['缺失.pdf']);
  assert.match(await fs.readFile(path.join(updated.folderPath, '项目说明.txt'), 'utf8'), /更新后的名称/);
  assert.match(await fs.readFile(path.join(updated.folderPath, '项目说明.txt'), 'utf8'), /已投递/);
  assert.equal((await service.prepare({ id: updated.id, name: '又一个名称' })).entry.folderName, first.entry.folderName);
  assert.equal((await service.setSubmitted({ id: updated.id, submitted: false })).submittedAt, null);
});

test('a fresh service restores archived metadata, submission and filesystem directory access', async t => {
  const { options, service, userData } = await fixture(t);
  const saved = await project(service);
  await service.commit({ id: saved.entry.id, customerAlias: '历史客户', sourceCount: 7, generatedCount: 5 });
  await service.setSubmitted({ id: saved.entry.id, submitted: true });
  const second = createProjectLibraryService({ ...options, filesystem: createFilesystemService({ userData }) });
  const reopened = await second.get({ id: saved.entry.id });
  assert.equal(reopened.entry.customerAlias, '历史客户'); assert.equal(reopened.entry.sourceCount, 7);
  assert.equal(reopened.entry.submittedAt, '2026-11-11T13:00:00.000Z');
  assert.deepEqual(reopened.directory, saved.directory);
});

test('concurrent saves serialize, preserve all projects and never remove stored files on smaller counts', async t => {
  const { service, filesystem } = await fixture(t);
  const projects = await Promise.all(Array.from({ length: 8 }, (_, index) => project(service, 'project-' + index, '同名项目')));
  assert.equal((await service.list()).length, 8);
  const first = projects[0], file = await filesystem.op({ handle: first.directory, op: 'file', name: '已生成.docx', create: true });
  await filesystem.op({ handle: file, op: 'write', data: new Uint8Array([1, 2, 3]) });
  await Promise.all([service.commit({ id: first.entry.id, customerAlias: '客户' }), service.setSubmitted({ id: first.entry.id, submitted: true }), service.commit({ id: first.entry.id, owner: '负责人', sourceCount: 0, generatedCount: 0 })]);
  const final = (await service.get({ id: first.entry.id })).entry;
  assert.equal(final.customerAlias, '客户'); assert.equal(final.owner, '负责人'); assert.ok(final.submittedAt);
  assert.deepEqual(new Uint8Array(await fs.readFile(path.join(first.entry.folderPath, '已生成.docx'))), new Uint8Array([1, 2, 3]));
});

test('identical metadata saves do not rewrite index or per-project metadata', async t => {
  const { service, rootPath } = await fixture(t);
  const saved = await project(service), index = path.join(rootPath, '历史项目索引.json'), meta = path.join(saved.entry.folderPath, '项目档案.json');
  const old = new Date('2020-01-02T03:04:05Z');
  await fs.utimes(index, old, old); await fs.utimes(meta, old, old);
  const beforeIndex = (await fs.stat(index)).mtimeMs, beforeMeta = (await fs.stat(meta)).mtimeMs;
  await service.commit({ id: saved.entry.id, name: saved.entry.name });
  assert.equal((await fs.stat(index)).mtimeMs, beforeIndex); assert.equal((await fs.stat(meta)).mtimeMs, beforeMeta);
});

test('project IDs, metadata and unsafe folder names cannot escape storage or clear existing records', async t => {
  const { service, rootPath } = await fixture(t);
  for (const id of ['../outside', 'C:\\outside', 'a/b', 'a..b', '中文', 'x'.repeat(129), '']) await assert.rejects(project(service, id), { code: 'INVALID_PROJECT_ID' });
  const saved = await project(service, 'valid', 'CON: 设备/目录?');
  assert.ok(!/[<>:"/\\|?*]/.test(saved.entry.folderName));
  const before = await fs.readFile(path.join(rootPath, '历史项目索引.json'), 'utf8');
  for (const patch of [{ sourceCount: -1 }, { generatedCount: 1.2 }, { updatedAt: 'not a date' }, { missingFiles: 'file' }, { owner: {} }]) {
    await assert.rejects(service.commit({ id: saved.entry.id, ...patch }), { code: 'INVALID_METADATA' });
  }
  assert.equal(await fs.readFile(path.join(rootPath, '历史项目索引.json'), 'utf8'), before);
  assert.equal((await service.list()).length, 1);
});

test('invalid whole index is reported and never replaced, while invalid individual records are preserved', async t => {
  const { service, rootPath, warnings } = await fixture(t);
  const saved = await project(service), index = path.join(rootPath, '历史项目索引.json');
  const valid = JSON.parse(await fs.readFile(index, 'utf8'));
  const malformed = '{this is not JSON'; await fs.writeFile(index, malformed);
  await assert.rejects(service.list(), { code: 'LIBRARY_INDEX_INVALID' });
  await assert.rejects(service.prepare({ id: 'new', name: 'new' }), { code: 'LIBRARY_INDEX_INVALID' });
  assert.equal(await fs.readFile(index, 'utf8'), malformed);
  const badRecord = { id: 'malformed', folderName: '../outside' };
  valid.projects.push(badRecord); await fs.writeFile(index, JSON.stringify(valid));
  assert.equal((await service.list()).length, 1);
  await service.commit({ id: saved.entry.id, owner: '仍可保存' });
  assert.deepEqual(JSON.parse(await fs.readFile(index, 'utf8')).projects[1], badRecord);
  assert.ok(warnings.some(warning => warning.code === 'INVALID_METADATA'));
});

test('damaged per-project metadata is skipped without erasing the index or other projects', async t => {
  const { service, rootPath, warnings } = await fixture(t);
  const first = await project(service), second = await project(service, 'second');
  await fs.writeFile(path.join(first.entry.folderPath, '项目档案.json'), '{broken');
  const index = path.join(rootPath, '历史项目索引.json'), before = await fs.readFile(index, 'utf8');
  assert.deepEqual((await service.list()).map(entry => entry.id), [second.entry.id]);
  assert.equal(await fs.readFile(index, 'utf8'), before);
  assert.ok(warnings.length);
});

test('missing index with existing project folders fails instead of silently creating an empty library', async t => {
  const { service, rootPath } = await fixture(t);
  await project(service);
  await fs.unlink(path.join(rootPath, '历史项目索引.json'));
  await assert.rejects(service.info(), { code: 'LIBRARY_INDEX_MISSING' });
  await assert.rejects(fs.stat(path.join(rootPath, '历史项目索引.json')), { code: 'ENOENT' });
});

test('a prepared archive is not listed or loadable until a matching snapshot is committed', async t => {
  const { service, rootPath } = await fixture(t);
  const prepared = await service.prepare({ id: 'incomplete', name: '尚未写完' });
  assert.deepEqual(await service.list(), []);
  await assert.rejects(service.get({ id: 'incomplete' }), { code: 'PROJECT_NOT_READY' });
  await assert.rejects(service.setSubmitted({ id: 'incomplete', submitted: true }), { code: 'PROJECT_NOT_READY' });
  await assert.rejects(service.commit({ id: 'incomplete' }), { code: 'PROJECT_NOT_READY' });
  assert.equal(JSON.parse(await fs.readFile(path.join(rootPath, '历史项目索引.json'), 'utf8')).projects[0].committed, false);
  assert.doesNotMatch(await fs.readFile(path.join(rootPath, '历史项目索引.csv'), 'utf8'), /尚未写完/);
  assert.equal((await service.prepare({ id: 'incomplete', name: '重试同一项目' })).entry.folderName, prepared.entry.folderName);
  await writeSnapshot(prepared);
  assert.deepEqual(await service.list(), []);
  await service.commit({ id: 'incomplete', name: '已经保存' });
  assert.equal((await service.list())[0].name, '已经保存');
  assert.equal((await service.get({ id: 'incomplete' })).entry.id, 'incomplete');
});

test('legacy records without a commit flag require an existing matching snapshot', async t => {
  const { service, rootPath } = await fixture(t);
  const saved = await project(service);
  const indexPath = path.join(rootPath, '历史项目索引.json'), index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  delete index.projects[0].committed;
  await fs.writeFile(indexPath, JSON.stringify(index));
  assert.equal((await service.list()).length, 1);
  await fs.unlink(path.join(saved.entry.folderPath, 'projects', saved.entry.id, 'project.json'));
  assert.deepEqual(await service.list(), []);
  await assert.rejects(service.get({ id: saved.entry.id }), { code: 'PROJECT_NOT_READY' });
  assert.equal(JSON.parse(await fs.readFile(indexPath, 'utf8')).projects.length, 1);
});

test('a mismatched active-project record cannot be committed as a complete archive', async t => {
  const { service } = await fixture(t);
  const prepared = await service.prepare({ id: 'current', name: '项目' });
  await writeSnapshot(prepared);
  await fs.writeFile(path.join(prepared.entry.folderPath, 'workspace.json'), JSON.stringify({ schemaVersion: '1.0.0', activeProjectId: 'different' }));
  await assert.rejects(service.commit({ id: 'current' }), { code: 'PROJECT_NOT_READY' });
  assert.deepEqual(await service.list(), []);
});

test('a tampered index cannot map one project ID onto a different project folder', async t => {
  const { service, rootPath } = await fixture(t);
  const first = await project(service), second = await project(service, 'second');
  const indexPath = path.join(rootPath, '历史项目索引.json');
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  const secondMetadata = await fs.readFile(path.join(second.entry.folderPath, '项目档案.json'), 'utf8');
  index.projects = [{ ...index.projects[0], folderName: second.entry.folderName }];
  await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(service.get({ id: first.entry.id }), { code: 'INVALID_METADATA' });
  await assert.rejects(service.commit({ id: first.entry.id, owner: 'wrong project' }), { code: 'INVALID_METADATA' });
  await assert.rejects(service.prepare({ id: first.entry.id, name: 'wrong project' }), { code: 'INVALID_METADATA' });
  assert.equal(await fs.readFile(path.join(second.entry.folderPath, '项目档案.json'), 'utf8'), secondMetadata);
});

test('project junctions cannot expose, overwrite or open an external folder', async t => {
  const { service, base, rootPath, opened } = await fixture(t);
  const saved = await project(service), outside = path.join(base, 'outside');
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private.txt'), 'outside');
  await fs.rename(saved.entry.folderPath, path.join(rootPath, 'saved-original'));
  if (!await linkOrSkip(t, outside, saved.entry.folderPath)) return;
  for (const call of [() => service.get({ id: saved.entry.id }), () => service.commit({ id: saved.entry.id, name: 'new' }), () => service.setSubmitted({ id: saved.entry.id, submitted: true }), () => service.openFolder({ id: saved.entry.id })]) await assert.rejects(call(), { code: 'UNSAFE_LIBRARY_PATH' });
  assert.deepEqual(await service.list(), []); assert.deepEqual(opened, []);
  assert.deepEqual(await fs.readdir(outside), ['private.txt']);
});

test('replaced library root and index links are rejected before writes', async t => {
  const { service, base, rootPath } = await fixture(t);
  await service.info();
  const outside = path.join(base, 'outside'); await fs.mkdir(outside);
  await fs.rename(rootPath, path.join(base, 'old-library'));
  if (!await linkOrSkip(t, outside, rootPath)) return;
  await assert.rejects(service.info(), { code: 'UNSAFE_LIBRARY_PATH' });
  assert.deepEqual(await fs.readdir(outside), []);
});

test('openFolder only opens validated library or known project directories', async t => {
  const { service, rootPath, opened, base } = await fixture(t);
  const saved = await project(service);
  await service.openFolder(); await service.openFolder({ id: saved.entry.id });
  await service.openFolder({ path: path.join(base, 'outside') });
  assert.deepEqual(opened, [rootPath, saved.entry.folderPath, rootPath]);
  await assert.rejects(service.openFolder({ id: '../outside' }), { code: 'INVALID_PROJECT_ID' });
  await assert.rejects(service.openFolder({ id: 'not-found' }), { code: 'PROJECT_NOT_FOUND' });
});

test('CSV escapes formulas while preserving original project metadata', async t => {
  const { service, rootPath } = await fixture(t);
  const saved = await project(service, 'formula', '=HYPERLINK("https://example.invalid")');
  await service.commit({ id: saved.entry.id, customerAlias: '+danger' });
  const csv = await fs.readFile(path.join(rootPath, '历史项目索引.csv'), 'utf8');
  assert.match(csv, /'=HYPERLINK/); assert.match(csv, /'\+danger/);
  assert.equal((await service.get({ id: saved.entry.id })).entry.customerAlias, '+danger');
});

test('project IPC validates every sender, localizes errors and exposes only the seven contracted operations', async () => {
  const handlers = new Map(), called = [];
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel) };
  let locale = 'en';
  const service = Object.fromEntries(['info', 'prepare', 'commit', 'list', 'get', 'setSubmitted', 'openFolder'].map(method => [method, async input => { called.push([method, input]); if (method === 'get') throw Object.assign(new Error('中文错误'), { code: 'PROJECT_NOT_FOUND' }); return method; }]));
  const attached = attachProjectLibrary({ ipcMain, service, assertSender: event => { if (!event.trusted) throw new Error('forbidden'); }, getLocale: () => locale });
  assert.equal(handlers.size, 7);
  for (const handler of handlers.values()) assert.equal((await handler({ trusted: false })).ok, false);
  assert.deepEqual(called, []);
  assert.deepEqual(await handlers.get('bid:projects:info')({ trusted: true }), { ok: true, value: 'info' });
  assert.match((await handlers.get('bid:projects:get')({ trusted: true }, { id: 'missing' })).error.message, /not found/);
  locale = 'zh'; assert.match((await handlers.get('bid:projects:get')({ trusted: true })).error.message, /中文错误/);
  assert.equal(handlers.has('bid:projects:registerManagedDirectory'), false);
  attached.dispose(); assert.equal(handlers.size, 0);
});
