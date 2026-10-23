'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createFilesystemService, attachFilesystem } = require('./filesystem.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'bid-filesystem-test-'));
  const root = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  const userData = path.join(base, 'app-data');
  await fs.mkdir(root); await fs.mkdir(outside);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const handle = { rootId: 'test-root', relativePath: '', kind: 'directory', name: 'workspace' };
  const service = createFilesystemService({ userData, grants: { 'test-root': root } });
  return { base, root, outside, userData, handle, service };
}

test('directory and binary file operations round trip, with original-content backups', async t => {
  const { service, handle, userData } = await fixture(t);
  const folder = await service.op({ handle, op: 'directory', name: '投标资料', create: true });
  const file = await service.op({ handle: folder, op: 'file', name: '附件.bin', create: true });
  const first = new Uint8Array([0, 1, 127, 128, 255]);
  await service.op({ handle: file, op: 'write', data: first });
  assert.deepEqual(await service.op({ handle: file, op: 'read' }), first);
  await service.op({ handle: file, op: 'write', data: new Uint8Array([42]) });
  const backups = path.join(userData, 'file-backups', 'test-root', '投标资料');
  const originals = await Promise.all((await fs.readdir(backups)).map(name => fs.readFile(path.join(backups, name))));
  assert.equal(originals.length, 1);
  assert(originals.some(value => value.equals(Buffer.from(first))));
  const entries = await service.op({ handle: folder, op: 'list' });
  assert.deepEqual(entries.map(([name]) => name), ['附件.bin']);
  assert.equal(await service.op({ handle: file, op: 'same', data: entries[0][1] }), true);
});

test('identical autosaves preserve the timestamp and do not add backups', async t => {
  const { service, handle, root, userData } = await fixture(t);
  const file = await service.op({ handle, op: 'file', name: 'autosave.json', create: true });
  const first = new Uint8Array(Buffer.from('{"version":1}'));
  await service.op({ handle: file, op: 'write', data: first });
  await assert.rejects(fs.stat(path.join(userData, 'file-backups')), { code: 'ENOENT' });
  const second = new Uint8Array(Buffer.from('{"version":2}'));
  await service.op({ handle: file, op: 'write', data: second });
  const backupDirectory = path.join(userData, 'file-backups', handle.rootId);
  assert.equal((await fs.readdir(backupDirectory)).length, 1);
  // An old, fixed timestamp makes an unnecessary atomic replacement observable.
  const timestamp = new Date('2020-01-02T03:04:05.000Z');
  await fs.utimes(path.join(root, 'autosave.json'), timestamp, timestamp);
  const before = await fs.stat(path.join(root, 'autosave.json'));
  await service.op({ handle: file, op: 'write', data: second });
  await service.op({ handle: file, op: 'write', data: second });
  assert.equal((await fs.readdir(backupDirectory)).length, 1);
  assert.equal((await fs.stat(path.join(root, 'autosave.json'))).mtimeMs, before.mtimeMs);
});

test('saved roots and all supported directory keys survive a fresh service', async t => {
  const { root, userData } = await fixture(t);
  const service = createFilesystemService({ userData, chooseDirectory: async () => root });
  assert.equal(await service.restore({ key: 'active-workspace' }), null);
  const handle = await service.pick({ purpose: 'active-workspace' });
  assert.equal(handle.relativePath, '');
  for (const key of ['active-workspace', 'task-output', 'project-output']) await service.persist({ key, handle });
  const restored = createFilesystemService({ userData });
  assert.deepEqual(await restored.restore({ key: 'active-workspace' }), handle);
  assert.deepEqual(await restored.restore({ key: 'task-output' }), handle);
  assert.deepEqual(await restored.restore({ key: 'project-output' }), handle);
  await restored.persist({ key: 'active-workspace', handle: null });
  assert.equal(await createFilesystemService({ userData }).restore({ key: 'active-workspace' }), null);
});

test('cancelled directory selection does not authorize anything', async t => {
  const { userData } = await fixture(t);
  const service = createFilesystemService({ userData, chooseDirectory: async () => null });
  assert.equal(await service.pick({ purpose: 'active-workspace' }), null);
  assert.equal(await service.restore({ key: 'active-workspace' }), null);
  await assert.rejects(service.persist({ key: 'arbitrary', handle: null }), { name: 'NotAllowedError' });
});

test('missing entries and wrong file kinds preserve browser-compatible error names', async t => {
  const { service, handle } = await fixture(t);
  await assert.rejects(service.op({ handle, op: 'file', name: 'missing.txt' }), { name: 'NotFoundError' });
  await service.op({ handle, op: 'directory', name: 'existing', create: true });
  await assert.rejects(service.op({ handle, op: 'file', name: 'existing', create: true }), { name: 'TypeMismatchError' });
  const file = await service.op({ handle, op: 'file', name: 'existing.txt', create: true });
  await assert.rejects(service.op({ handle: file, op: 'list' }), { name: 'TypeMismatchError' });
  await assert.rejects(service.op({ handle: file, op: 'write', data: 'text' }), { name: 'TypeMismatchError' });
});

test('forged roots, relative traversal, device names and alternate data streams are denied', async t => {
  const { service, handle, outside } = await fixture(t);
  await fs.writeFile(path.join(outside, 'private.txt'), 'outside');
  for (const name of ['.', '..', '../outside', 'a/b', 'a\\b', 'NUL', 'CON.txt', 'COM1.log', 'a:stream', 'tail.', 'tail ']) {
    await assert.rejects(service.op({ handle, op: 'file', name, create: true }), { name: 'NotAllowedError' });
  }
  await assert.rejects(service.op({ handle: { ...handle, rootId: 'unapproved' }, op: 'list' }), { name: 'NotAllowedError' });
  await assert.rejects(service.op({ handle: { ...handle, relativePath: '../outside', name: 'outside' }, op: 'list' }), { name: 'NotAllowedError' });
  await assert.rejects(service.op({ handle: { ...handle, relativePath: 'a\\b', name: 'b' }, op: 'list' }), { name: 'NotAllowedError' });
  assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'outside');
});

test('junctions and symlinks cannot grant outside access or be recursively removed', async t => {
  const { service, handle, root, outside } = await fixture(t);
  await fs.writeFile(path.join(outside, 'private.txt'), 'outside');
  await fs.mkdir(path.join(root, 'project'));
  try { await fs.symlink(outside, path.join(root, 'project', 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip('This environment cannot create test directory links.'); return; } throw error; }
  const project = await service.op({ handle, op: 'directory', name: 'project' });
  await fs.writeFile(path.join(root, 'project', 'keep.txt'), 'keep');
  await assert.rejects(service.op({ handle: project, op: 'directory', name: 'escape' }), { name: 'NotAllowedError' });
  await assert.rejects(service.op({ handle, op: 'removeEntry', name: 'project', recursive: true }), { name: 'NotAllowedError' });
  assert.equal(await fs.readFile(path.join(root, 'project', 'keep.txt'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'outside');
});

test('replacing an approved root with a junction invalidates the grant', async t => {
  const { service, handle, root, outside, base } = await fixture(t);
  await service.op({ handle, op: 'list' });
  await fs.rename(root, path.join(base, 'old-workspace'));
  try { await fs.symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip('This environment cannot create test directory links.'); return; } throw error; }
  await assert.rejects(service.op({ handle, op: 'list' }), { name: 'NotAllowedError' });
});

test('deletion is scoped to the named child, and recursive deletion is explicit', async t => {
  const { service, handle, root } = await fixture(t);
  const project = await service.op({ handle, op: 'directory', name: 'delete-me', create: true });
  await service.op({ handle: project, op: 'file', name: 'child.txt', create: true });
  await fs.writeFile(path.join(root, 'keep.txt'), 'keep');
  await assert.rejects(service.op({ handle, op: 'removeEntry', name: 'delete-me' }));
  await assert.rejects(service.op({ handle, op: 'removeEntry', name: '', recursive: true }), { name: 'NotAllowedError' });
  await service.op({ handle, op: 'removeEntry', name: 'delete-me', recursive: true });
  await assert.rejects(fs.stat(path.join(root, 'delete-me')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'keep.txt'), 'utf8'), 'keep');
});

test('IPC envelopes preserve errors, require sender authorization and unregister cleanly', async t => {
  const { root, userData } = await fixture(t);
  const handlers = new Map();
  let allowed = true;
  const registration = attachFilesystem({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) },
    getWindow: () => null, userData,
    assertSender: () => { if (!allowed) throw Object.assign(new Error('Unauthorized renderer.'), { name: 'NotAllowedError' }); },
  });
  assert.equal(handlers.size, 4);
  const picked = await handlers.get('bid:fs:pick')({}, {});
  assert.equal(picked.ok, true);
  const missing = await handlers.get('bid:fs:op')({}, { handle: picked.value, op: 'file', name: 'missing.txt' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.name, 'NotFoundError');
  allowed = false;
  const blocked = await handlers.get('bid:fs:restore')({}, { key: 'active-workspace' });
  assert.equal(blocked.error.name, 'NotAllowedError');
  registration.dispose();
  assert.equal(handlers.size, 0);
});

test('native picker and IPC errors follow the current interface language', async t => {
  const { root, userData } = await fixture(t);
  const handlers = new Map();
  const options = [];
  let locale = 'en';
  const registration = attachFilesystem({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
    dialog: { showOpenDialog: async input => { options.push(input); return { canceled: false, filePaths: [root] }; } },
    getWindow: () => null, userData, assertSender: () => {}, getLocale: () => locale,
  });
  const picked = await handlers.get('bid:fs:pick')({}, { purpose: 'task-output' });
  assert.equal(options[0].title, 'Select task output folder');
  assert.equal(options[0].buttonLabel, 'Select folder');
  const missing = await handlers.get('bid:fs:op')({}, { handle: picked.value, op: 'file', name: 'missing.txt' });
  assert.equal(missing.error.name, 'NotFoundError');
  assert.match(missing.error.message, /no longer exists/);
  const invalid = await handlers.get('bid:fs:op')({}, { handle: picked.value, op: 'file', name: '../escape' });
  assert.equal(invalid.error.code, 'INVALID_NAME');
  assert.match(invalid.error.message, /file name/);
  assert.doesNotMatch(invalid.error.message, /[\u3400-\u9fff]/);
  locale = 'zh';
  await handlers.get('bid:fs:pick')({}, { purpose: 'project-output' });
  assert.equal(options[1].title, '选择项目输出文件夹');
  const chinese = await handlers.get('bid:fs:op')({}, { handle: picked.value, op: 'file', name: 'missing.txt' });
  assert.match(chinese.error.message, /不存在/);
  registration.dispose();
});

test('trashEntry recycles only the named ordinary file inside an authorized root', async t => {
  const { base, root, userData, handle, outside } = await fixture(t);
  const recycled = path.join(base, 'fake-recycle-bin');
  await fs.mkdir(recycled);
  await fs.writeFile(path.join(root, 'result.txt'), 'generated');
  await fs.writeFile(path.join(root, 'keep.txt'), 'keep');
  await fs.writeFile(path.join(outside, 'private.txt'), 'outside');
  await fs.mkdir(path.join(root, 'folder'));
  const called = [];
  const service = createFilesystemService({ userData, grants: { 'test-root': root }, trashItem: async filename => {
    called.push(filename); await fs.rename(filename, path.join(recycled, path.basename(filename)));
  } });
  for (const name of ['..', '.', '../outside/private.txt', 'a/b', 'a\\b', 'NUL', 'a:stream', 'tail.', 'tail ']) {
    await assert.rejects(service.op({ handle, op: 'trashEntry', name }), { name: 'NotAllowedError' });
  }
  await assert.rejects(service.op({ handle: { ...handle, rootId: 'forged' }, op: 'trashEntry', name: 'result.txt' }), { name: 'NotAllowedError' });
  await assert.rejects(service.op({ handle, op: 'trashEntry', name: 'folder' }), { name: 'TypeMismatchError' });
  await assert.rejects(service.op({ handle, op: 'trashEntry', name: 'result.txt', recursive: true }), { name: 'NotAllowedError' });
  assert.deepEqual(called, []);
  assert.equal(await service.op({ handle, op: 'trashEntry', name: 'result.txt' }), true);
  assert.deepEqual(called, [path.join(root, 'result.txt')]);
  assert.equal(await fs.readFile(path.join(recycled, 'result.txt'), 'utf8'), 'generated');
  assert.equal(await fs.readFile(path.join(root, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'outside');
});

test('trashEntry has no permanent-delete fallback when unavailable or denied', async t => {
  const { root, userData, handle, service: unsupported } = await fixture(t);
  await fs.writeFile(path.join(root, 'result.txt'), 'keep');
  await assert.rejects(unsupported.op({ handle, op: 'trashEntry', name: 'result.txt' }), { code: 'TRASH_UNAVAILABLE' });
  const denied = createFilesystemService({ userData, grants: { 'test-root': root }, trashItem: async () => { throw Object.assign(new Error('Denied'), { code: 'EACCES' }); } });
  await assert.rejects(denied.op({ handle, op: 'trashEntry', name: 'result.txt' }), { name: 'NotAllowedError' });
  assert.equal(await fs.readFile(path.join(root, 'result.txt'), 'utf8'), 'keep');
});

test('trashEntry rejects junction traversal and runs in the existing mutation queue', async t => {
  const { root, outside, userData, handle } = await fixture(t);
  await fs.writeFile(path.join(outside, 'private.txt'), 'outside');
  try { await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip('Test links unavailable.'); return; } throw error; }
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const calls = [];
  const service = createFilesystemService({ userData, grants: { 'test-root': root }, trashItem: async filename => { calls.push(filename); entered(); await gate; await fs.unlink(filename); } });
  const linked = { ...handle, relativePath: 'linked', name: 'linked' };
  await assert.rejects(service.op({ handle: linked, op: 'trashEntry', name: 'private.txt' }), { name: 'NotAllowedError' });
  await assert.rejects(service.op({ handle, op: 'trashEntry', name: 'linked' }), { name: 'NotAllowedError' });
  assert.equal(calls.length, 0);
  await fs.writeFile(path.join(root, 'result.txt'), 'generated');
  const recycling = service.op({ handle, op: 'trashEntry', name: 'result.txt' });
  await started;
  let created = false;
  const creating = service.op({ handle, op: 'file', name: 'next.txt', create: true }).then(() => { created = true; });
  await Promise.resolve();
  assert.equal(created, false);
  await assert.rejects(fs.stat(path.join(root, 'next.txt')), { code: 'ENOENT' });
  release(); await recycling; await creating;
  assert.equal(created, true);
  assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'outside');
});

test('trashEntry validates the preview fingerprint and preserves mismatched files before calling the Recycle Bin', async t => {
  const { root, userData, handle } = await fixture(t);
  const filename = path.join(root, 'result.txt');
  const content = 'generated';
  await fs.writeFile(filename, content);
  const expectedFingerprint = { size: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') };
  const called = [];
  const service = createFilesystemService({ userData, grants: { 'test-root': root }, trashItem: async target => { called.push(target); await fs.rename(target, path.join(root, 'recycled-result.txt')); } });
  for (const invalid of [null, {}, { size: -1, sha256: expectedFingerprint.sha256 }, { size: 1.5, sha256: expectedFingerprint.sha256 }, { ...expectedFingerprint, sha256: 'not-a-hash' }, { ...expectedFingerprint, path: filename }]) {
    await assert.rejects(service.op({ handle, op: 'trashEntry', name: 'result.txt', expectedFingerprint: invalid }), { code: 'INVALID_FINGERPRINT' });
  }
  for (const invalid of [{ ...expectedFingerprint, size: expectedFingerprint.size + 1 }, { ...expectedFingerprint, sha256: '0'.repeat(64) }]) {
    await assert.rejects(service.op({ handle, op: 'trashEntry', name: 'result.txt', expectedFingerprint: invalid }), { code: 'FILE_CHANGED' });
  }
  assert.deepEqual(called, []);
  assert.equal(await fs.readFile(filename, 'utf8'), content);
  assert.equal(await service.op({ handle, op: 'trashEntry', name: 'result.txt', expectedFingerprint }), true);
  assert.deepEqual(called, [filename]);
  assert.equal(await fs.readFile(path.join(root, 'recycled-result.txt'), 'utf8'), content);
});

test('trashEntry retains a file changed after the fingerprint read and never calls the Recycle Bin', async t => {
  const { root, userData, handle } = await fixture(t);
  const filename = path.join(root, 'result.txt');
  await fs.writeFile(filename, 'original');
  const expectedFingerprint = { size: 8, sha256: createHash('sha256').update('original').digest('hex') };
  const originalOpen = fs.open;
  t.after(() => { fs.open = originalOpen; });
  fs.open = async function (target, ...args) {
    const opened = await originalOpen.call(fs, target, ...args);
    if (target === filename) {
      const originalRead = opened.read.bind(opened);
      let changed = false;
      opened.read = async (...readArgs) => {
        const result = await originalRead(...readArgs);
        if (!result.bytesRead && !changed) { changed = true; await fs.writeFile(filename, 'modified'); }
        return result;
      };
    }
    return opened;
  };
  let called = false;
  const service = createFilesystemService({ userData, grants: { 'test-root': root }, trashItem: async () => { called = true; } });
  await assert.rejects(service.op({ handle, op: 'trashEntry', name: 'result.txt', expectedFingerprint }), { code: 'FILE_CHANGED' });
  assert.equal(called, false);
  assert.equal(await fs.readFile(filename, 'utf8'), 'modified');
});

test('trashEntry rejects a parent switched to a junction after hashing before calling the Recycle Bin', async t => {
  const { base, root, outside, userData, handle } = await fixture(t);
  const folder = path.join(root, 'generated');
  await fs.mkdir(folder);
  const filename = path.join(folder, 'result.txt');
  await fs.writeFile(filename, 'original');
  await fs.writeFile(path.join(outside, 'result.txt'), 'outside');
  const testLink = path.join(base, 'test-link');
  try { await fs.symlink(outside, testLink, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip('Test links unavailable.'); return; } throw error; }
  await fs.unlink(testLink);
  const originalOpen = fs.open;
  t.after(() => { fs.open = originalOpen; });
  fs.open = async function (target, ...args) {
    const opened = await originalOpen.call(fs, target, ...args);
    if (target === filename) {
      const originalClose = opened.close.bind(opened);
      opened.close = async () => {
        await originalClose();
        await fs.rename(folder, path.join(root, 'original-generated'));
        await fs.symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
      };
    }
    return opened;
  };
  let called = false;
  const service = createFilesystemService({ userData, grants: { 'test-root': root }, trashItem: async () => { called = true; } });
  const parent = { ...handle, relativePath: 'generated', name: 'generated' };
  const expectedFingerprint = { size: 8, sha256: createHash('sha256').update('original').digest('hex') };
  await assert.rejects(service.op({ handle: parent, op: 'trashEntry', name: 'result.txt', expectedFingerprint }), { code: 'PATH_ESCAPE' });
  assert.equal(called, false);
  assert.equal(await fs.readFile(path.join(root, 'original-generated', 'result.txt'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(outside, 'result.txt'), 'utf8'), 'outside');
});
